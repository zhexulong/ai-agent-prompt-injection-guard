import { expect, test } from "bun:test";
import { Confidence, Threat, type Detection } from "./types";
import { mergeDetections, stripText } from "./strip";

const d = (start: number, end: number): Detection => ({
  start,
  end,
  confidence: Confidence.High,
  threat: Threat.ResponseInjection,
});

test("mergeDetections merges overlap and adjacency", () => {
  const out = mergeDetections([d(5, 7), d(0, 2), d(2, 4)]);
  expect(out.map((x) => [x.start, x.end])).toEqual([[0, 4], [5, 7]]);
});

test("stripText removes only matched spans", () => {
  expect(stripText("AAABBBCCC", [d(3, 6)])).toBe("AAACCC");
});
