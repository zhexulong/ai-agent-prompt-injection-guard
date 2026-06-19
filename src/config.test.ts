import { expect, test } from "bun:test";
import { loadConfig } from "./config";
import { NotifyLevel } from "./core/types";

test("loadConfig uses safe local defaults", () => {
  const config = loadConfig({});
  expect(config.fingerprintsPath).toBe("fingerprints.json");
  expect(config.alertsPath).toBe("alerts.jsonl");
  expect(config.pendingSuggestionsPath).toBe("pending-suggestions.json");
  expect(config.alertLimit).toBe(100);
  expect(config.notifyLevel).toBe(NotifyLevel.First);
  expect(config.judge).toBeUndefined();
});

test("loadConfig enables Tier 1 only when all judge env vars exist", () => {
  const partial = loadConfig({ AIPIG_JUDGE_BASE_URL: "https://example.invalid" });
  expect(partial.judge).toBeUndefined();

  const full = loadConfig({
    AIPIG_JUDGE_BASE_URL: "https://example.invalid",
    AIPIG_JUDGE_API_KEY: "k",
    AIPIG_JUDGE_MODEL: "m",
    AIPIG_NOTIFY_LEVEL: "always",
    AIPIG_ALERT_LIMIT: "7",
  });
  expect(full.judge?.model).toBe("m");
  expect(full.notifyLevel).toBe(NotifyLevel.Always);
  expect(full.alertLimit).toBe(7);
});
