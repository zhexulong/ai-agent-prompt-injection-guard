import type { GuardConfig } from "../../config";
import { loadConfig } from "../../config";
import { createCandidateTracker } from "../../core/candidates";
import { runGuard } from "../../core/engine";
import { loadFingerprints } from "../../core/fingerprints";
import { applyConfirmedSuggestion } from "../../core/suggest";
import type { Suggestion } from "../../core/types";

const notifySeen = new Set<string>();
const candidateTracker = createCandidateTracker();

function contextFor(config: GuardConfig) {
  return {
    fingerprints: loadFingerprints(config.fingerprintsPath),
    alertsPath: config.alertsPath,
    alertLimit: config.alertLimit,
    pendingSuggestionsPath: config.pendingSuggestionsPath,
    notifySeen,
    candidateTracker,
    judge: config.judge,
  };
}

export async function rewriteOpenCodeText(
  text: string,
  config: GuardConfig = loadConfig(),
  sessionId = "unknown-session",
) {
  const decision = await runGuard(
    {
      host: "opencode",
      sessionId,
      channel: "response_text",
      text,
      notifyLevel: config.notifyLevel,
    },
    contextFor(config),
  );
  return { text: decision.sanitizedText, notice: decision.notifications[0] };
}

export async function rewriteOpenCodeToolResult(
  text: string,
  config: GuardConfig = loadConfig(),
  sessionId = "unknown-session",
) {
  const decision = await runGuard(
    {
      host: "opencode",
      sessionId,
      channel: "tool_result",
      text,
      notifyLevel: config.notifyLevel,
    },
    contextFor(config),
  );
  return { text: decision.sanitizedText, notice: decision.notifications[0] };
}

export async function handleOpenCodePrompt(
  text: string,
  config: GuardConfig = loadConfig(),
  sessionId = "unknown-session",
) {
  const decision = await runGuard(
    {
      host: "opencode",
      sessionId,
      channel: "user_prompt",
      text,
      notifyLevel: config.notifyLevel,
    },
    contextFor(config),
  );
  return {
    block: decision.action === "stripped" || decision.action === "flagged",
    notice: decision.notifications[0],
  };
}

export function applyOpenCodeConfirmation(fingerprintsPath: string, suggestion: Suggestion, approved: boolean) {
  applyConfirmedSuggestion(fingerprintsPath, suggestion, approved);
}

interface OpenCodeGuardApi {
  experimental: {
    text: { complete(handler: (input: any, next: (input: any) => Promise<any>) => Promise<any>): void };
    tool: { result(handler: (input: any, next: (input: any) => Promise<any>) => Promise<any>): void };
    prompt: { submit(handler: (input: any, next: (input: any) => Promise<any>) => Promise<any>): void };
    permission: { confirm(handler: (input: any, next: (input: any) => Promise<any>) => Promise<any>): void };
  };
}

export function bindOpenCodeHooks(api: OpenCodeGuardApi, config: GuardConfig = loadConfig()) {
  api.experimental.text.complete(async (input, next) => {
    const out = await next(input);
    const rewritten = await rewriteOpenCodeText(out.text ?? "", config, input.sessionID ?? "unknown-session");
    if (rewritten.notice) console.error(rewritten.notice);
    return { ...out, text: rewritten.text };
  });

  api.experimental.tool.result(async (input, next) => {
    const out = await next(input);
    const rewritten = await rewriteOpenCodeToolResult(
      out.text ?? out.output ?? "",
      config,
      input.sessionID ?? "unknown-session",
    );
    if (rewritten.notice) console.error(rewritten.notice);
    return { ...out, text: rewritten.text, output: rewritten.text };
  });

  api.experimental.prompt.submit(async (input, next) => {
    const checked = await handleOpenCodePrompt(
      input.text ?? input.prompt ?? "",
      config,
      input.sessionID ?? "unknown-session",
    );
    if (checked.block) return { ...input, decision: "block", message: checked.notice };
    return next(input);
  });

  api.experimental.permission.confirm(async (input, next) => {
    if (input.anti_injection_confirmation) {
      applyOpenCodeConfirmation(
        config.fingerprintsPath,
        input.anti_injection_confirmation.suggestion,
        input.anti_injection_confirmation.approved,
      );
      return { ...input, message: "Anti-injection fingerprint decision saved" };
    }
    return next(input);
  });
}

export default {
  name: "anti-injection-guard",
  setup(api: unknown) {
    bindOpenCodeHooks(api as OpenCodeGuardApi);
  },
};
