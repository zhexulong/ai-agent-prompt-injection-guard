import { expect, test } from "bun:test";
import { NotifyLevel, Threat } from "./types";
import { shouldNotify } from "./notify";

test("first only notifies once per session and threat", () => {
  const seen = new Set<string>();
  expect(shouldNotify(seen, "s1", Threat.Padding, NotifyLevel.First)).toBe(true);
  expect(shouldNotify(seen, "s1", Threat.Padding, NotifyLevel.First)).toBe(false);
});

test("always and never behave literally", () => {
  const seen = new Set<string>();
  expect(shouldNotify(seen, "s1", Threat.Padding, NotifyLevel.Always)).toBe(true);
  expect(shouldNotify(seen, "s1", Threat.Padding, NotifyLevel.Never)).toBe(false);
});
