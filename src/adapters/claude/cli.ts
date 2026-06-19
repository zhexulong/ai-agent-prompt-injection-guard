import { loadConfig } from "../../config";
import { createCandidateTracker } from "../../core/candidates";
import { runGuard } from "../../core/engine";
import { loadFingerprints } from "../../core/fingerprints";
import { applyConfirmedSuggestion } from "../../core/suggest";

const notifySeen = new Set<string>();
const candidateTracker = createCandidateTracker();

export async function handleClaudeEvent(event: any, config = loadConfig()) {
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
        host: "claude",
        sessionId,
        channel: "tool_result",
        text: event.tool_response ?? "",
        notifyLevel: config.notifyLevel,
      },
      context,
    );
    return {
      hookSpecificOutput: {
        updatedToolOutput: decision.sanitizedText,
      },
      systemMessage: decision.notifications[0],
    };
  }

  if (event.hook_event_name === "MessageDisplay") {
    const decision = await runGuard(
      {
        host: "claude",
        sessionId,
        channel: "response_text",
        text: event.message_text ?? "",
        notifyLevel: config.notifyLevel,
      },
      context,
    );
    return {
      hookSpecificOutput: {
        displayContent: decision.sanitizedText,
      },
      systemMessage: decision.notifications[0],
    };
  }

  if (event.hook_event_name === "Stop") {
    const decision = await runGuard(
      {
        host: "claude",
        sessionId,
        channel: "usage_only",
        text: event.last_assistant_message ?? "",
        notifyLevel: config.notifyLevel,
        usage: event.usage,
      },
      context,
    );
    return { systemMessage: decision.notifications[0] };
  }

  if (event.hook_event_name === "UserPromptSubmit") {
    const decision = await runGuard(
      {
        host: "claude",
        sessionId,
        channel: "user_prompt",
        text: event.user_prompt ?? "",
        notifyLevel: config.notifyLevel,
      },
      context,
    );
    if (decision.action === "stripped" || decision.action === "flagged") {
      return {
        decision: "block",
        systemMessage: decision.notifications[0],
      };
    }
  }

  if (event.hook_event_name === "PreToolUse" && event.anti_injection_confirmation) {
    applyConfirmedSuggestion(
      config.fingerprintsPath,
      event.anti_injection_confirmation.suggestion,
      event.anti_injection_confirmation.approved,
    );
    return { systemMessage: "Anti-injection fingerprint decision saved" };
  }

  return {};
}

if (import.meta.main) {
  const input = await Bun.stdin.text();
  const event = JSON.parse(input || "{}");
  const output = await handleClaudeEvent(event);
  process.stdout.write(`${JSON.stringify(output)}\n`);
}
