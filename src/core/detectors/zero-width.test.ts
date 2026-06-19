import { expect, test } from "bun:test";
import { Confidence, Threat } from "../types";
import { detectZeroWidth } from "./zero-width";

test("detects runs of zero-width characters", () => {
  const text = `safe\u200b\u200c\u200dunsafe`;
  const out = detectZeroWidth(text, Threat.ToolInjection);
  expect(out).toHaveLength(1);
  expect(out[0].confidence).toBe(Confidence.High);
  expect(text.slice(out[0].start, out[0].end)).toBe("\u200b\u200c\u200d");
});

test("ignores isolated single codepoints", () => {
  expect(detectZeroWidth(`a\u200bb`, Threat.ResponseInjection)).toEqual([]);
});
