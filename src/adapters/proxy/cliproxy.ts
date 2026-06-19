import { loadConfig, type GuardConfig } from "../../config";
import { createCandidateTracker } from "../../core/candidates";
import { loadFingerprints } from "../../core/fingerprints";
import { runGuard } from "../../core/engine";

const notifySeen = new Set<string>();
const candidateTracker = createCandidateTracker();

export async function rewriteProxyResponse(
  input: { text: string; sessionId: string; host?: "proxy" },
  config: GuardConfig = loadConfig(),
) {
  const fingerprints = loadFingerprints(config.fingerprintsPath);
  const decision = await runGuard(
    {
      host: input.host ?? "proxy",
      sessionId: input.sessionId,
      channel: "response_text",
      text: input.text,
      notifyLevel: config.notifyLevel,
    },
    {
      fingerprints,
      alertsPath: config.alertsPath,
      alertLimit: config.alertLimit,
      pendingSuggestionsPath: config.pendingSuggestionsPath,
      notifySeen,
      candidateTracker,
      judge: config.judge,
    },
  );

  return {
    text: decision.sanitizedText,
    notice: decision.notifications[0],
    suggestion: decision.suggestion,
  };
}

export function createResponseTransform(config: GuardConfig = loadConfig()) {
  const streamBuffers = new Map<string, string>();
  return {
    async NonStream(payload: { text: string; sessionId: string }) {
      return rewriteProxyResponse(payload, config);
    },
    async Stream(payload: { text: string; sessionId: string; done: boolean }) {
      const buffered = `${streamBuffers.get(payload.sessionId) ?? ""}${payload.text}`;
      if (!payload.done) {
        streamBuffers.set(payload.sessionId, buffered);
        return { text: "" };
      }
      streamBuffers.delete(payload.sessionId);
      return rewriteProxyResponse({ text: buffered, sessionId: payload.sessionId }, config);
    },
  };
}
