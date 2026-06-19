import { expect, test } from "bun:test";
import { decideSuggestionTarget } from "./confirm";

test("approved suggestions go to positives", () => {
  expect(decideSuggestionTarget(true)).toBe("positives");
});

test("rejected suggestions go to negatives", () => {
  expect(decideSuggestionTarget(false)).toBe("negatives");
});
