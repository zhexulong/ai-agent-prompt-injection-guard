import { afterEach, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { applyConfirmedSuggestion, writePendingSuggestion } from "./suggest";

const path = "/tmp/aipig-pending.json";
const fingerprintsPath = "/tmp/aipig-suggest-fingerprints.json";

afterEach(() => {
  try { rmSync(path); } catch {}
  try { rmSync(fingerprintsPath); } catch {}
});

test("pending suggestion file keeps only the newest 100 entries", () => {
  for (let i = 0; i < 101; i++) {
    writePendingSuggestion(path, { pattern: { id: `p${i}`, type: "literal", pattern: `abc-${i}` }, reason: "new pattern" });
  }
  const data = JSON.parse(readFileSync(path, "utf8"));
  expect(data).toHaveLength(100);
  expect(data[0].pattern.id).toBe("p1");
  expect(data[99].pattern.id).toBe("p100");
});

test("confirmed suggestions append to positives or negatives", () => {
  Bun.write(fingerprintsPath, JSON.stringify({ _README: "x", positives: [], negatives: [] }));
  applyConfirmedSuggestion(fingerprintsPath, { pattern: { id: "p1", type: "literal", pattern: "abc" }, reason: "new pattern" }, true);
  applyConfirmedSuggestion(fingerprintsPath, { pattern: { id: "n1", type: "literal", pattern: "def" }, reason: "not injection" }, false);
  const data = JSON.parse(readFileSync(fingerprintsPath, "utf8"));
  expect(data.positives.map((x: any) => x.id)).toEqual(["p1"]);
  expect(data.negatives.map((x: any) => x.id)).toEqual(["n1"]);
});
