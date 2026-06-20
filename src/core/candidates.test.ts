import { expect, test } from "bun:test";
import { buildFormatFingerprint, createCandidateTracker, extractCandidatePatterns, observeCandidatePattern } from "./candidates";

test("extractCandidatePatterns normalizes repeated banner-like text", () => {
  const patterns = extractCandidatePatterns("回答内容\nPowered by Proxy X https://track.example/a?u=123");
  expect(patterns).toContain("Powered by Proxy X https://track.example/a");
});

test("extractCandidatePatterns skips markdown and code structure lines", () => {
  const patterns = extractCandidatePatterns([
    "### /home/prosumer/project",
    "| column | value |",
    "import { thing } from './module';",
    "expect(result).toBe(true);",
    "Chunk ID: abc123",
    "Wall time: 0.123 seconds",
    "Process exited with code 0",
    "Original token count: 42",
    "Run: `bun test src/core/candidates.test.ts`",
    "git add src/core/candidates.ts",
    "drwxr-xr-x 2 prosumer prosumer 4096 Jun 19 src",
    "│   ├── file.ts",
    "src/llm/judge.ts",
    "package.json",
    "build passed",
    "Powered by Proxy X https://track.example/a?u=123",
  ].join("\n"));
  expect(patterns).not.toContain("### /home/prosumer/project");
  expect(patterns).not.toContain("| column | value |");
  expect(patterns.some((pattern) => pattern.startsWith("import "))).toBe(false);
  expect(patterns.some((pattern) => pattern.startsWith("expect("))).toBe(false);
  expect(patterns.some((pattern) => pattern.startsWith("Chunk ID:"))).toBe(false);
  expect(patterns.some((pattern) => pattern.startsWith("Wall time:"))).toBe(false);
  expect(patterns.some((pattern) => pattern.startsWith("Run:"))).toBe(false);
  expect(patterns.some((pattern) => pattern.startsWith("git add"))).toBe(false);
  expect(patterns.some((pattern) => pattern.endsWith(".ts"))).toBe(false);
  expect(patterns).not.toContain("package.json");
  expect(patterns).not.toContain("build passed");
  expect(patterns).toContain("Powered by Proxy X https://track.example/a");
});

test("buildFormatFingerprint turns repeated variants into a bounded regex fingerprint", () => {
  const fp = buildFormatFingerprint([
    "notice source Foo appended https://track.example/a?u=123",
    "notice source Bar appended https://track.example/a?u=456",
    "notice source Baz appended https://track.example/a?u=789",
  ]);
  expect(fp.type).toBe("regex");
  expect(fp.pattern).toContain("https://track\\.example/a");
  expect(new RegExp(fp.pattern).test("notice source Qux appended https://track.example/a?u=999")).toBe(true);
});

test("observeCandidatePattern suggests only after three repeats in the same host/session/channel", () => {
  const tracker = createCandidateTracker();
  expect(observeCandidatePattern(tracker, { host: "claude", sessionId: "s1", channel: "response_text", pattern: "footer marker source Alpha" })).toBeNull();
  expect(observeCandidatePattern(tracker, { host: "claude", sessionId: "s1", channel: "response_text", pattern: "footer marker source Beta" })).toBeNull();
  const suggestion = observeCandidatePattern(tracker, { host: "claude", sessionId: "s1", channel: "response_text", pattern: "footer marker source Gamma" });
  expect(suggestion?.pattern.type).toBe("regex");
  expect(suggestion?.evidence?.supportingExamples).toHaveLength(3);
  expect(new RegExp(suggestion!.pattern.pattern).test("footer marker source Delta")).toBe(true);
  expect(observeCandidatePattern(tracker, { host: "claude", sessionId: "s1", channel: "response_text", pattern: "footer marker source Delta" })).toBeNull();
});

test("observeCandidatePattern counts distinct observations when observationId is provided", () => {
  const tracker = createCandidateTracker();
  expect(observeCandidatePattern(tracker, { host: "claude", sessionId: "s1", channel: "response_text", pattern: "footer marker source Alpha", observationId: "record-1" })).toBeNull();
  expect(observeCandidatePattern(tracker, { host: "claude", sessionId: "s1", channel: "response_text", pattern: "footer marker source Beta", observationId: "record-1" })).toBeNull();
  expect(observeCandidatePattern(tracker, { host: "claude", sessionId: "s1", channel: "response_text", pattern: "footer marker source Gamma", observationId: "record-1" })).toBeNull();
  expect(observeCandidatePattern(tracker, { host: "claude", sessionId: "s1", channel: "response_text", pattern: "footer marker source Delta", observationId: "record-2" })).toBeNull();
  const suggestion = observeCandidatePattern(tracker, { host: "claude", sessionId: "s1", channel: "response_text", pattern: "footer marker source Epsilon", observationId: "record-3" });
  expect(suggestion?.pattern.type).toBe("regex");
});

test("observeCandidatePattern does not suggest regexes without a stable prefix", () => {
  const tracker = createCandidateTracker();
  expect(observeCandidatePattern(tracker, { host: "claude", sessionId: "s1", channel: "response_text", pattern: "Alpha footer marker", observationId: "record-1" })).toBeNull();
  expect(observeCandidatePattern(tracker, { host: "claude", sessionId: "s1", channel: "response_text", pattern: "Beta footer marker", observationId: "record-2" })).toBeNull();
  expect(observeCandidatePattern(tracker, { host: "claude", sessionId: "s1", channel: "response_text", pattern: "Gamma footer marker", observationId: "record-3" })).toBeNull();
});

test("observeCandidatePattern suggests exact repeated compact watermarks", () => {
  const tracker = createCandidateTracker();
  expect(observeCandidatePattern(tracker, { host: "codex", sessionId: "s1", channel: "response_text", pattern: "本回答来自ABCD站点,请勿分发", observationId: "record-1" })).toBeNull();
  expect(observeCandidatePattern(tracker, { host: "codex", sessionId: "s1", channel: "response_text", pattern: "本回答来自ABCD站点,请勿分发", observationId: "record-2" })).toBeNull();
  const suggestion = observeCandidatePattern(tracker, { host: "codex", sessionId: "s1", channel: "response_text", pattern: "本回答来自ABCD站点,请勿分发", observationId: "record-3" });
  expect(suggestion?.pattern.pattern).toContain("ABCD");
});

test("observeCandidatePattern generalizes compact CJK watermark suffix variants", () => {
  const tracker = createCandidateTracker();
  expect(observeCandidatePattern(tracker, { host: "codex", sessionId: "s1", channel: "response_text", pattern: "本回答来自ABCD站点,请勿分发", observationId: "record-1" })).toBeNull();
  expect(observeCandidatePattern(tracker, { host: "codex", sessionId: "s1", channel: "response_text", pattern: "本回答来自ABCD站点,请勿传播", observationId: "record-2" })).toBeNull();
  const suggestion = observeCandidatePattern(tracker, { host: "codex", sessionId: "s1", channel: "response_text", pattern: "本回答来自ABCD站点,请勿外传", observationId: "record-3" });
  expect(suggestion?.pattern.pattern).toContain("ABCD");
  expect(new RegExp(suggestion!.pattern.pattern).test("本回答来自ABCD站点,请勿扩散")).toBe(true);
});

test("candidate counts do not cross sessions", () => {
  const tracker = createCandidateTracker();
  expect(observeCandidatePattern(tracker, { host: "claude", sessionId: "s1", channel: "response_text", pattern: "Powered by Proxy X" })).toBeNull();
  expect(observeCandidatePattern(tracker, { host: "claude", sessionId: "s2", channel: "response_text", pattern: "Powered by Proxy X" })).toBeNull();
});

test("powered by is too weak to generalize across unrelated brands", () => {
  const tracker = createCandidateTracker();
  expect(observeCandidatePattern(tracker, { host: "proxy", sessionId: "s1", channel: "response_text", pattern: "Powered by PostgreSQL", observationId: "record-1" })).toBeNull();
  expect(observeCandidatePattern(tracker, { host: "proxy", sessionId: "s1", channel: "response_text", pattern: "Powered by OpenAI", observationId: "record-2" })).toBeNull();
  expect(observeCandidatePattern(tracker, { host: "proxy", sessionId: "s1", channel: "response_text", pattern: "Powered by Next.js", observationId: "record-3" })).toBeNull();
});

test("powered by can suggest a narrow brand-specific fingerprint", () => {
  const tracker = createCandidateTracker();
  expect(observeCandidatePattern(tracker, { host: "proxy", sessionId: "s1", channel: "response_text", pattern: "Powered by ABCD", observationId: "record-1" })).toBeNull();
  expect(observeCandidatePattern(tracker, { host: "proxy", sessionId: "s1", channel: "response_text", pattern: "Powered by ABCD", observationId: "record-2" })).toBeNull();
  const suggestion = observeCandidatePattern(tracker, { host: "proxy", sessionId: "s1", channel: "response_text", pattern: "Powered by ABCD", observationId: "record-3" });
  expect(suggestion?.pattern.pattern).toBe("Powered\\s+by\\s+ABCD");
});

test("powered by variants can suggest a brand-bounded fingerprint", () => {
  const tracker = createCandidateTracker();
  expect(observeCandidatePattern(tracker, { host: "proxy", sessionId: "s1", channel: "response_text", pattern: "Powered by SampleSite", observationId: "record-1" })).toBeNull();
  expect(observeCandidatePattern(tracker, { host: "proxy", sessionId: "s1", channel: "response_text", pattern: "Powered by samplesite", observationId: "record-2" })).toBeNull();
  const suggestion = observeCandidatePattern(tracker, { host: "proxy", sessionId: "s1", channel: "response_text", pattern: "Powered by SAMPLESITE", observationId: "record-3" });
  expect(suggestion?.pattern.type).toBe("regex");
  expect(suggestion?.pattern.pattern).toBe("Powered\\s+by\\s+(?:SampleSite|samplesite|SAMPLESITE)");
  expect(new RegExp(suggestion!.pattern.pattern).test("Powered by samplesite")).toBe(true);
  expect(new RegExp(suggestion!.pattern.pattern).test("Powered by PostgreSQL")).toBe(false);
});

test("long repeated templates become precise regexes without trailing wildcard", () => {
  const fp = buildFormatFingerprint([
    "This response was distributed by ABCD site for evaluation only please do not share ref 1001 end",
    "This response was distributed by ABCD site for evaluation only please do not share ref 1002 end",
    "This response was distributed by ABCD site for evaluation only please do not share ref 1003 end",
  ]);
  expect(fp.pattern).toBe("This\\s+response\\s+was\\s+distributed\\s+by\\s+ABCD\\s+site\\s+for\\s+evaluation\\s+only\\s+please\\s+do\\s+not\\s+share\\s+ref\\s+\\d{3,}\\s+end");
  expect(fp.pattern.endsWith(".*")).toBe(false);
  expect(fp.pattern.endsWith("\\S{1,80}")).toBe(false);
});
