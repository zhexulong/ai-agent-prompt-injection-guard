import { expect, test } from "bun:test";
import { Confidence, Threat, type Detection } from "./types";
import { buildVerdict } from "./verdict";

const d = (start: number, end: number, confidence: Confidence): Detection => ({
  start,
  end,
  confidence,
  threat: Threat.ToolInjection,
});

test("buildVerdict separates high and low confidence detections", () => {
  const verdict = buildVerdict([d(0, 2, Confidence.High), d(3, 5, Confidence.Low)]);
  expect(verdict.highConfidence).toHaveLength(1);
  expect(verdict.lowConfidence).toHaveLength(1);
});
