import { afterEach, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { appendAlertRing } from "./alerts";
import { Action, Confidence, Threat, type AlertRecord } from "./types";

const path = "/tmp/aipig-alerts.jsonl";

afterEach(() => {
  try { rmSync(path); } catch {}
});

function record(i: number): AlertRecord {
  return {
    ts: `2026-06-19T00:00:0${i}.000Z`,
    host: "claude",
    sessionId: "s1",
    threat: Threat.ToolInjection,
    confidence: Confidence.High,
    action: Action.Stripped,
    snippet: `snippet-${i}`,
  };
}

test("appendAlertRing retains only the newest N records", () => {
  appendAlertRing(path, 2, record(1));
  appendAlertRing(path, 2, record(2));
  appendAlertRing(path, 2, record(3));
  const lines = readFileSync(path, "utf8").trim().split("\n");
  expect(lines).toHaveLength(2);
  expect(lines[0]).toContain("snippet-2");
  expect(lines[1]).toContain("snippet-3");
  expect(existsSync(`${path}.1`)).toBe(false);
});
