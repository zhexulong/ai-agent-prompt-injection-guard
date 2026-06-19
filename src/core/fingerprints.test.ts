import { afterEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { appendFingerprint, loadFingerprints } from "./fingerprints";

const path = "/tmp/aipig-fingerprints.json";

afterEach(() => {
  try { rmSync(path); } catch {}
});

test("loadFingerprints returns the file structure", () => {
  Bun.write(path, JSON.stringify({ _README: "x", positives: [], negatives: [] }));
  const file = loadFingerprints(path);
  expect(file.positives).toEqual([]);
  expect(file.negatives).toEqual([]);
});

test("appendFingerprint writes to positives and negatives without touching the other side", () => {
  Bun.write(path, JSON.stringify({ _README: "x", positives: [], negatives: [] }));
  appendFingerprint(path, "positives", { id: "p1", type: "literal", pattern: "abc" });
  appendFingerprint(path, "negatives", { id: "n1", type: "literal", pattern: "def" });
  const file = loadFingerprints(path);
  expect(file.positives.map((x) => x.id)).toEqual(["p1"]);
  expect(file.negatives.map((x) => x.id)).toEqual(["n1"]);
});
