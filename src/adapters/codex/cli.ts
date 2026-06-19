import { loadConfig } from "../../config";
import { createCandidateTracker } from "../../core/candidates";
import { runGuard } from "../../core/engine";
import { loadFingerprints } from "../../core/fingerprints";
import { applyConfirmedSuggestion } from "../../core/suggest";

const notifySeen = new Set<string>();
const candidateTracker = createCandidateTracker();

export async function handleCodexEvent(event: any, config = loadConfig()) {
  const fingerprints = loadFingerprints(config.fingerprintsPath);
  const sessionId = event.session_id ?? "unknown-session";
  const context = {
    fingerprints,
    alertsPath: config.alertsPath,
    alertLimit: config.alertLimit,
    pendingSuggestionsPath: config.pendingSuggestionsPath,
    notifySeen,
    candidateTracker,
    judge: config.judge,
  };

  if (event.hook_event_name === "PostToolUse") {
    const decision = await runGuard(
      {
        host: "codex",
        sessionId,
        channel: "tool_result",
        text: event.tool_response ?? "",
        notifyLevel: config.notifyLevel,
      },
      context,
    );
    return {
      hookSpecificOutput: {
        feedback_message: decision.sanitizedText,
        should_block: false,
      },
      statusMessage: decision.notifications[0],
    };
  }

  if (event.hook_event_name === "Stop") {
    const decision = await runGuard(
      {
        host: "codex",
        sessionId,
        channel: "response_text",
        text: event.last_assistant_message ?? "",
        notifyLevel: config.notifyLevel,
      },
      context,
    );
    return {
      statusMessage: decision.notifications[0] ?? `Guard detected response_text (${decision.action})`,
    };
  }

  if (event.hook_event_name === "UserPromptSubmit") {
    const decision = await runGuard(
      {
        host: "codex",
        sessionId,
        channel: "user_prompt",
        text: event.user_prompt ?? "",
        notifyLevel: config.notifyLevel,
      },
      context,
    );
    if (decision.action === "stripped" || decision.action === "flagged") {
      return {
        hookSpecificOutput: {
          decision: "block",
          additionalContext: decision.notifications[0],
        },
        statusMessage: decision.notifications[0],
      };
    }
  }

  if (event.hook_event_name === "PermissionRequest" && event.anti_injection_confirmation) {
    applyConfirmedSuggestion(
      config.fingerprintsPath,
      event.anti_injection_confirmation.suggestion,
      event.anti_injection_confirmation.approved,
    );
    return { statusMessage: "Anti-injection fingerprint decision saved" };
  }

  return {};
}

if (import.meta.main) {
  const input = await Bun.stdin.text();
  const event = JSON.parse(input || "{}");
  const output = await handleCodexEvent(event);
  process.stdout.write(`${JSON.stringify(output)}\n`);
}
