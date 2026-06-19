import { handleClaudeEvent } from "../src/adapters/claude/cli";
import { handleCodexEvent } from "../src/adapters/codex/cli";
import { rewriteOpenCodeText, rewriteOpenCodeToolResult } from "../src/adapters/opencode/plugin";
import { NotifyLevel } from "../src/core/types";

const seenBodies = new Map<string, string[]>();

const config = {
  fingerprintsPath: "fingerprints.json",
  alertsPath: "/tmp/aipig-eval-alerts.jsonl",
  pendingSuggestionsPath: "/tmp/aipig-eval-pending.json",
  alertLimit: 100,
  notifyLevel: NotifyLevel.Always,
} as const;

function appendNextRequest(sessionId: string, text: string): void {
  const current = seenBodies.get(sessionId) ?? [];
  current.push(JSON.stringify({ messages: [{ role: "assistant", content: text }] }));
  seenBodies.set(sessionId, current);
}

export async function simulateCodexToolResultRoundTrip(sessionId: string, toolResponse: string): Promise<void> {
  const output = await handleCodexEvent({
    hook_event_name: "PostToolUse",
    session_id: sessionId,
    tool_response: toolResponse,
  }, config);
  appendNextRequest(sessionId, output.hookSpecificOutput?.feedback_message ?? toolResponse);
}

export async function simulateCodexDirectResponseRoundTrip(sessionId: string, assistantText: string): Promise<void> {
  await handleCodexEvent({
    hook_event_name: "Stop",
    session_id: sessionId,
    last_assistant_message: assistantText,
  }, config);
  appendNextRequest(sessionId, assistantText);
}

export async function nextRequestContains(sessionId: string, needle: string): Promise<boolean> {
  return (seenBodies.get(sessionId) ?? []).some((body) => body.includes(needle));
}

export async function simulateClaudeToolResultRoundTrip(sessionId: string, toolResponse: string): Promise<void> {
  const output = await handleClaudeEvent({
    hook_event_name: "PostToolUse",
    session_id: sessionId,
    tool_response: toolResponse,
  }, config);
  appendNextRequest(sessionId, output.hookSpecificOutput?.updatedToolOutput ?? toolResponse);
}

export async function simulateClaudeDirectResponseRoundTrip(
  sessionId: string,
  assistantText: string,
): Promise<{ displayContent: string }> {
  const output = await handleClaudeEvent({
    hook_event_name: "MessageDisplay",
    session_id: sessionId,
    message_text: assistantText,
  }, config);
  appendNextRequest(sessionId, assistantText);
  return {
    displayContent: output.hookSpecificOutput?.displayContent ?? assistantText,
  };
}

export async function simulateOpenCodeResponseRoundTrip(sessionId: string, assistantText: string): Promise<void> {
  const output = await rewriteOpenCodeText(assistantText, config, sessionId);
  appendNextRequest(sessionId, output.text);
}

export async function simulateOpenCodeToolResultRoundTrip(sessionId: string, toolResponse: string): Promise<void> {
  const output = await rewriteOpenCodeToolResult(toolResponse, config, sessionId);
  appendNextRequest(sessionId, output.text);
}
