import { expect, test } from "bun:test";
import { rememberUsage, takePreviousUsage, type StoredUsage } from "./usage";

test("usage fallback stores one previous turn per session", () => {
  const store = new Map<string, StoredUsage>();
  rememberUsage(store, "s1", { outputTokens: 8000, visibleTextLength: 20 });
  expect(takePreviousUsage(store, "s1")?.outputTokens).toBe(8000);
  expect(takePreviousUsage(store, "s1")).toBeUndefined();
});
