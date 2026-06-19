import { expect, test } from "bun:test";
import { Confidence, Threat, type Fingerprint } from "../types";
import { detectFingerprints } from "./fingerprint";

const positives: Fingerprint[] = [
  { id: "banner", type: "literal", pattern: "Powered by Proxy X" },
  { id: "track", type: "regex", pattern: "https://track\\.example/[A-Za-z0-9]+" },
];

const negatives: Fingerprint[] = [
  { id: "allowed", type: "literal", pattern: "https://track.example/docs" },
];

test("matches positive literal and regex spans as high-confidence", () => {
  const out = detectFingerprints(
    "ok Powered by Proxy X https://track.example/abc",
    positives,
    negatives,
    Threat.ResponseInjection,
  );
  expect(out).toHaveLength(2);
  expect(out.every((x) => x.confidence === Confidence.High)).toBe(true);
});

test("negative matches suppress overlapping positive matches", () => {
  const out = detectFingerprints(
    "see https://track.example/docs now",
    positives,
    negatives,
    Threat.ResponseInjection,
  );
  expect(out).toEqual([]);
});
