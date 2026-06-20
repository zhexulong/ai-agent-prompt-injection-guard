import { afterEach, expect, mock, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { runGuard } from "./engine";
import { Action, NotifyLevel, type FingerprintFile } from "./types";
import type { StoredUsage } from "./usage";

const tempFiles = [
  "/tmp/aipig-engine-alerts.jsonl",
  "/tmp/aipig-engine-alerts-2.jsonl",
  "/tmp/aipig-engine-alerts-3.jsonl",
  "/tmp/aipig-engine-alerts-4.jsonl",
  "/tmp/aipig-engine-pending.json",
  "/tmp/aipig-engine-pending-2.json",
  "/tmp/aipig-engine-pending-3.json",
  "/tmp/aipig-engine-pending-4.json",
];

afterEach(() => {
  for (const path of tempFiles) {
    try { rmSync(path); } catch {}
  }
});

const fingerprints: FingerprintFile = {
  _README: "x",
  positives: [{ id: "banner", type: "literal", pattern: "Powered by Proxy X" }],
  negatives: [],
};

test("high-confidence matches strip and emit notification", async () => {
  const result = await runGuard(
    {
      host: "claude",
      sessionId: "s1",
      channel: "tool_result",
      text: "ok Powered by Proxy X end",
      notifyLevel: NotifyLevel.First,
    },
    {
      fingerprints,
      alertLimit: 100,
      alertsPath: "/tmp/aipig-engine-alerts.jsonl",
      pendingSuggestionsPath: "/tmp/aipig-engine-pending.json",
      notifySeen: new Set<string>(),
    },
  );

  expect(result.sanitizedText).toBe("ok  end");
  expect(result.action).toBe(Action.Stripped);
  expect(result.notifications).toHaveLength(1);
});

test("codex direct response text is flagged unhandled rather than rewritten", async () => {
  const result = await runGuard(
    {
      host: "codex",
      sessionId: "s1",
      channel: "response_text",
      text: "ok Powered by Proxy X end",
      notifyLevel: NotifyLevel.Always,
    },
    {
      fingerprints,
      alertLimit: 100,
      alertsPath: "/tmp/aipig-engine-alerts.jsonl",
      pendingSuggestionsPath: "/tmp/aipig-engine-pending.json",
      notifySeen: new Set<string>(),
    },
  );

  expect(result.sanitizedText).toBe("ok Powered by Proxy X end");
  expect(result.action).toBe(Action.FlaggedUnhandled);
});

test("usage-only suspicion flags without rewriting text", async () => {
  const result = await runGuard(
    {
      host: "codex",
      sessionId: "s2",
      channel: "usage_only",
      text: "short reply",
      notifyLevel: NotifyLevel.Always,
      usage: { outputTokens: 8000 },
    },
    {
      fingerprints,
      alertLimit: 100,
      alertsPath: "/tmp/aipig-engine-alerts-2.jsonl",
      pendingSuggestionsPath: "/tmp/aipig-engine-pending-2.json",
      notifySeen: new Set<string>(),
    },
  );

  expect(result.sanitizedText).toBe("short reply");
  expect(result.action).toBe(Action.Flagged);
});

test("Tier 1 suggestions are written to pending when no synchronous confirmation is available", async () => {
  const fetchImpl = mock(async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ id: "new-banner", type: "literal", pattern: "Injected by Y", note: "new banner" }) } }],
  })));
  const result = await runGuard(
    {
      host: "claude",
      sessionId: "s3",
      channel: "response_text",
      text: "Injected by Y",
      notifyLevel: NotifyLevel.Always,
    },
    {
      fingerprints,
      alertLimit: 100,
      alertsPath: "/tmp/aipig-engine-alerts-3.jsonl",
      pendingSuggestionsPath: "/tmp/aipig-engine-pending-3.json",
      notifySeen: new Set<string>(),
      judge: { baseUrl: "https://example.invalid", apiKey: "k", model: "m", fetchImpl: fetchImpl as unknown as typeof fetch },
    },
  );

  expect(result.suggestion?.pattern.id).toBe("new-banner");
  const pending = JSON.parse(readFileSync("/tmp/aipig-engine-pending-3.json", "utf8"));
  expect(pending[0].pattern.pattern).toBe("Injected by Y");
});

test("repetition candidates accumulate across calls with the same engine context", async () => {
  const context = {
    fingerprints,
    alertLimit: 100,
    alertsPath: "/tmp/aipig-engine-alerts-3.jsonl",
    pendingSuggestionsPath: "/tmp/aipig-engine-pending-3.json",
    notifySeen: new Set<string>(),
  };
  await runGuard({
    host: "claude",
    sessionId: "repeat-session",
    channel: "response_text",
    text: "footer marker source Alpha",
    notifyLevel: NotifyLevel.Always,
  }, context);
  await runGuard({
    host: "claude",
    sessionId: "repeat-session",
    channel: "response_text",
    text: "footer marker source Beta",
    notifyLevel: NotifyLevel.Always,
  }, context);
  const result = await runGuard({
    host: "claude",
    sessionId: "repeat-session",
    channel: "response_text",
    text: "footer marker source Gamma",
    notifyLevel: NotifyLevel.Always,
  }, context);

  expect(result.suggestion?.pattern.type).toBe("regex");
  const pending = JSON.parse(readFileSync("/tmp/aipig-engine-pending-3.json", "utf8"));
  expect(pending[0].evidence.supportingExamples).toHaveLength(3);
});

test("previous-turn usage fallback flags padding on the next prompt-submit event", async () => {
  const usageStore = new Map<string, StoredUsage>();
  await runGuard(
    {
      host: "claude",
      sessionId: "s4",
      channel: "usage_only",
      text: "short reply",
      notifyLevel: NotifyLevel.Never,
      usage: { outputTokens: 8000 },
    },
    {
      fingerprints,
      alertLimit: 100,
      alertsPath: "/tmp/aipig-engine-alerts-4.jsonl",
      pendingSuggestionsPath: "/tmp/aipig-engine-pending-4.json",
      notifySeen: new Set<string>(),
      usageStore,
      deferUsageCheck: true,
    },
  );
  const result = await runGuard(
    {
      host: "claude",
      sessionId: "s4",
      channel: "user_prompt",
      text: "next prompt",
      notifyLevel: NotifyLevel.Always,
    },
    {
      fingerprints,
      alertLimit: 100,
      alertsPath: "/tmp/aipig-engine-alerts-4.jsonl",
      pendingSuggestionsPath: "/tmp/aipig-engine-pending-4.json",
      notifySeen: new Set<string>(),
      usageStore,
    },
  );

  expect(result.action).toBe(Action.Flagged);
});
