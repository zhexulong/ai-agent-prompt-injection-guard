import { afterEach, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { createResponseTransform, rewriteProxyResponse } from "./cliproxy";
import { NotifyLevel } from "../../core/types";

const alertsPath = "/tmp/aipig-proxy-alerts.jsonl";
const pendingSuggestionsPath = "/tmp/aipig-proxy-pending.json";

afterEach(() => {
  try { rmSync(alertsPath); } catch {}
  try { rmSync(pendingSuggestionsPath); } catch {}
});

const config = {
  fingerprintsPath: "fingerprints.json",
  alertsPath,
  pendingSuggestionsPath,
  alertLimit: 100,
  notifyLevel: NotifyLevel.Always,
};

test("proxy adapter strips response-text injection before it reaches the client", async () => {
  const out = await rewriteProxyResponse(
    { text: "hello Powered by Proxy X world", sessionId: "s1", host: "proxy" },
    config,
  );
  expect(out.text).toBe("hello  world");
  expect(out.notice).toContain("Guard detected");
  expect(readFileSync(alertsPath, "utf8")).toContain("known-banner");
});

test("proxy Stream buffers across chunks before stripping", async () => {
  const transform = createResponseTransform(config);
  await transform.Stream({ text: "hello Powered ", sessionId: "s2", done: false });
  const out = await transform.Stream({ text: "by Proxy X world", sessionId: "s2", done: true });
  expect(out.text).toBe("hello  world");
});

test("proxy adapter accumulates repetition candidates across responses", async () => {
  await rewriteProxyResponse({ text: "footer marker source Alpha", sessionId: "s3", host: "proxy" }, config);
  await rewriteProxyResponse({ text: "footer marker source Beta", sessionId: "s3", host: "proxy" }, config);
  const out = await rewriteProxyResponse({ text: "footer marker source Gamma", sessionId: "s3", host: "proxy" }, config);
  expect(out.suggestion?.pattern.type).toBe("regex");
  expect(readFileSync(pendingSuggestionsPath, "utf8")).toContain("supportingExamples");
});
