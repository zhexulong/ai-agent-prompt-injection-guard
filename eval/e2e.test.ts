import { expect, test } from "bun:test";
import {
  nextRequestContains,
  simulateClaudeDirectResponseRoundTrip,
  simulateClaudeToolResultRoundTrip,
  simulateCodexDirectResponseRoundTrip,
  simulateCodexToolResultRoundTrip,
  simulateOpenCodeResponseRoundTrip,
  simulateOpenCodeToolResultRoundTrip,
} from "./proxy-capture";

test("tool-result fixture is removed before the next model-visible request when using Codex feedback_message", async () => {
  const sessionId = "codex-e2e-1";
  await simulateCodexToolResultRoundTrip(sessionId, "tool ok Powered by Proxy X end");
  expect(await nextRequestContains(sessionId, "Powered by Proxy X")).toBe(false);
});

test("Codex direct response-text injection remains flagged but still present downstream", async () => {
  const sessionId = "codex-e2e-2";
  await simulateCodexDirectResponseRoundTrip(sessionId, "assistant Powered by Proxy X text");
  expect(await nextRequestContains(sessionId, "Powered by Proxy X")).toBe(true);
});

test("Claude tool-result fixture is removed before the next model-visible request", async () => {
  const sessionId = "claude-e2e-1";
  await simulateClaudeToolResultRoundTrip(sessionId, "tool ok Powered by Proxy X end");
  expect(await nextRequestContains(sessionId, "Powered by Proxy X")).toBe(false);
});

test("Claude direct response-text injection can be hidden from display but remains downstream", async () => {
  const sessionId = "claude-e2e-2";
  const roundTrip = await simulateClaudeDirectResponseRoundTrip(sessionId, "assistant Powered by Proxy X text");
  expect(roundTrip.displayContent).not.toContain("Powered by Proxy X");
  expect(await nextRequestContains(sessionId, "Powered by Proxy X")).toBe(true);
});

test("OpenCode response-text fixture is removed before the next model-visible request", async () => {
  const sessionId = "opencode-e2e-1";
  await simulateOpenCodeResponseRoundTrip(sessionId, "assistant Powered by Proxy X text");
  expect(await nextRequestContains(sessionId, "Powered by Proxy X")).toBe(false);
});

test("OpenCode tool-result fixture is removed before the next model-visible request", async () => {
  const sessionId = "opencode-e2e-2";
  await simulateOpenCodeToolResultRoundTrip(sessionId, "tool Powered by Proxy X result");
  expect(await nextRequestContains(sessionId, "Powered by Proxy X")).toBe(false);
});
