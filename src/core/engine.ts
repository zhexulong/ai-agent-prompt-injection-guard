import { appendAlertRing } from "./alerts";
import { createCandidateTracker, extractCandidatePatterns, observeCandidatePattern, type CandidateTracker } from "./candidates";
import { detectFingerprints } from "./detectors/fingerprint";
import { detectZeroWidth } from "./detectors/zero-width";
import { shouldNotify } from "./notify";
import { stripText } from "./strip";
import { writePendingSuggestion } from "./suggest";
import { rememberUsage, takePreviousUsage, type StoredUsage } from "./usage";
import { buildVerdict } from "./verdict";
import { judgeUnknownPattern, type JudgeConfig } from "../llm/judge";
import { Action, Confidence, Threat, type Detection, type FingerprintFile, type GuardDecision, type GuardRequest } from "./types";

export interface EngineContext {
  fingerprints: FingerprintFile;
  alertsPath: string;
  alertLimit: number;
  pendingSuggestionsPath: string;
  notifySeen: Set<string>;
  candidateTracker?: CandidateTracker;
  judge?: JudgeConfig;
  usageStore?: Map<string, StoredUsage>;
  deferUsageCheck?: boolean;
}

function threatFor(channel: GuardRequest["channel"]): Threat {
  return channel === "usage_only"
    ? Threat.Padding
    : channel === "tool_result"
      ? Threat.ToolInjection
      : Threat.ResponseInjection;
}

function usageLooksPadded(req: GuardRequest): boolean {
  return req.channel === "usage_only" && (req.usage?.outputTokens ?? 0) >= 4000 && req.text.length <= 200;
}

function storedUsageLooksPadded(usage: StoredUsage | undefined): boolean {
  return (usage?.outputTokens ?? 0) >= 4000 && (usage?.visibleTextLength ?? Infinity) <= 200;
}

function alertFor(req: GuardRequest, detection: Detection, action: Action) {
  return {
    ts: new Date().toISOString(),
    host: req.host,
    sessionId: req.sessionId,
    threat: detection.threat,
    confidence: detection.confidence,
    action,
    fingerprintId: detection.fingerprintId,
    snippet: req.text.slice(detection.start, detection.end).slice(0, 200),
  };
}

export async function runGuard(req: GuardRequest, ctx: EngineContext): Promise<GuardDecision> {
  try {
    const threat = threatFor(req.channel);
    if (req.channel === "usage_only" && ctx.deferUsageCheck && ctx.usageStore) {
      rememberUsage(ctx.usageStore, req.sessionId, {
        outputTokens: req.usage?.outputTokens,
        visibleTextLength: req.text.length,
      });
      return { sanitizedText: req.text, detections: [], action: Action.Clean, notifications: [] };
    }

    const previousUsage = req.channel === "user_prompt" && ctx.usageStore
      ? takePreviousUsage(ctx.usageStore, req.sessionId)
      : undefined;

    const detections: Detection[] = [
      ...detectZeroWidth(req.text, threat),
      ...detectFingerprints(req.text, ctx.fingerprints.positives, ctx.fingerprints.negatives, threat),
    ];

    if (usageLooksPadded(req) || storedUsageLooksPadded(previousUsage)) {
      detections.push({
        start: 0,
        end: 0,
        confidence: Confidence.Low,
        threat: Threat.Padding,
        note: "usage-only suspicion",
      });
    }

    const verdict = buildVerdict(detections);
    let suggestion = undefined;
    if (verdict.detections.length === 0 && (req.channel === "response_text" || req.channel === "tool_result")) {
      ctx.candidateTracker ??= createCandidateTracker();
      for (const pattern of extractCandidatePatterns(req.text)) {
        const candidate = observeCandidatePattern(ctx.candidateTracker, {
          host: req.host,
          sessionId: req.sessionId,
          channel: req.channel,
          pattern,
        });
        if (candidate) {
          suggestion = candidate;
          break;
        }
      }
    }

    const suggestionPattern = !suggestion && verdict.detections.length === 0
      ? await judgeUnknownPattern(ctx.judge, req.text, [...ctx.fingerprints.positives, ...ctx.fingerprints.negatives])
      : null;
    if (!suggestion && suggestionPattern) {
      suggestion = { pattern: suggestionPattern, reason: "Tier 1 suggested an unknown reusable injection pattern" };
    }
    if (suggestion) writePendingSuggestion(ctx.pendingSuggestionsPath, suggestion);

    const high = verdict.highConfidence.filter((d) => d.end > d.start);
    const low = verdict.lowConfidence;
    let sanitizedText = high.length > 0 ? stripText(req.text, high) : req.text;

    let action = Action.Clean;
    if (high.length > 0) action = Action.Stripped;
    else if (low.length > 0) action = Action.Flagged;

    if (req.host === "codex" && req.channel === "response_text" && action === Action.Stripped) {
      action = Action.FlaggedUnhandled;
      sanitizedText = req.text;
    }

    const notifications = verdict.detections.length > 0 && shouldNotify(ctx.notifySeen, req.sessionId, threat, req.notifyLevel)
      ? [`Guard detected ${threat} (${action})`]
      : [];

    for (const detection of verdict.detections) {
      appendAlertRing(ctx.alertsPath, ctx.alertLimit, alertFor(req, detection, action));
    }

    return { sanitizedText, detections: verdict.detections, action, notifications, suggestion };
  } catch {
    appendAlertRing(ctx.alertsPath, ctx.alertLimit, {
      ts: new Date().toISOString(),
      host: req.host,
      sessionId: req.sessionId,
      threat: Threat.Padding,
      confidence: Confidence.Low,
      action: Action.ErrorPassthrough,
      snippet: req.text.slice(0, 200),
    });
    return { sanitizedText: req.text, detections: [], action: Action.ErrorPassthrough, notifications: [] };
  }
}
