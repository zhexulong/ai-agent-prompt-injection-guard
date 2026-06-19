import { afterEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import {
  decodeCliProxyEnvelope,
  handleCliProxyPluginCall,
  rewriteCliProxyResponseBody,
} from "./cliproxy-entry";
import { NotifyLevel } from "../../core/types";

const alertsPath = "/tmp/aipig-cliproxy-entry-alerts.jsonl";
const pendingSuggestionsPath = "/tmp/aipig-cliproxy-entry-pending.json";

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

function b64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

function unb64(text: string): string {
  return Buffer.from(text, "base64").toString("utf8");
}

test("register returns a CLIProxyAPI response interceptor capability", async () => {
  const raw = await handleCliProxyPluginCall("plugin.register", {}, config);
  const envelope = decodeCliProxyEnvelope(raw);

  expect(envelope.ok).toBe(true);
  expect(envelope.result.schema_version).toBe(1);
  expect(envelope.result.metadata.Name).toBe("ai-agent-prompt-injection-guard");
  expect(envelope.result.capabilities.response_interceptor).toBe(true);
  expect(envelope.result.capabilities.response_stream_interceptor).toBe(true);
});

test("response.intercept_after strips injected text from OpenAI Responses body", async () => {
  const body = JSON.stringify({
    output: [{
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Clean before Powered by Proxy X clean after" }],
    }],
  });

  const raw = await handleCliProxyPluginCall("response.intercept_after", { Body: b64(body) }, config);
  const envelope = decodeCliProxyEnvelope(raw);
  const rewritten = JSON.parse(unb64(envelope.result.Body));

  expect(rewritten.output[0].content[0].text).toBe("Clean before  clean after");
  expect(envelope.result.ClearHeaders).toContain("Content-Length");
});

test("response body rewrite handles plain text fallback", async () => {
  const out = await rewriteCliProxyResponseBody(
    Buffer.from("hello Powered by Proxy X world", "utf8"),
    "entry-test",
    config,
  );

  expect(out.toString("utf8")).toBe("hello  world");
});
