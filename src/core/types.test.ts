import { expect, test } from "bun:test";
import {
  Action,
  Confidence,
  NotifyLevel,
  Threat,
  type AlertRecord,
  type Detection,
  type Fingerprint,
  type GuardDecision,
  type GuardRequest,
} from "./types";

test("enum values stay stable", () => {
  expect(String(Confidence.High)).toBe("high");
  expect(String(Threat.ToolInjection)).toBe("tool_injection");
  expect(String(Action.FlaggedUnhandled)).toBe("flagged_unhandled");
  expect(String(NotifyLevel.First)).toBe("first");
});

test("key contracts are constructible", () => {
  const fp: Fingerprint = { id: "p1", type: "literal", pattern: "x" };
  const d: Detection = {
    start: 1,
    end: 3,
    confidence: Confidence.High,
    threat: Threat.ResponseInjection,
    fingerprintId: fp.id,
  };
  const req: GuardRequest = {
    host: "claude",
    sessionId: "s1",
    channel: "tool_result",
    text: "abc",
    notifyLevel: NotifyLevel.First,
  };
  const decision: GuardDecision = {
    sanitizedText: "abc",
    detections: [d],
    action: Action.Stripped,
    notifications: ["guard notice"],
  };
  const alert: AlertRecord = {
    ts: "2026-06-19T00:00:00.000Z",
    host: req.host,
    sessionId: req.sessionId,
    threat: d.threat,
    confidence: d.confidence,
    action: decision.action,
    snippet: "abc",
  };
  expect(alert.action).toBe(Action.Stripped);
});
