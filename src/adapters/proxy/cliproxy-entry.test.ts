import { afterEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import {
  decodeCliProxyEnvelope,
  handleCliProxyPluginCall,
  rewriteCliProxyRequestBody,
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
  expect(envelope.result.capabilities.request_interceptor).toBe(true);
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

  expect(Buffer.from(out).toString("utf8")).toBe("hello  world");
});

test("request.intercept_before strips injected text from OpenAI tool messages", async () => {
  const body = JSON.stringify({
    messages: [
      { role: "user", content: "keep Powered by Proxy X in user text" },
      { role: "tool", tool_call_id: "call_1", content: "tool ok Powered by Proxy X end" },
    ],
  });

  const raw = await handleCliProxyPluginCall("request.intercept_before", { Body: b64(body) }, config);
  const envelope = decodeCliProxyEnvelope(raw);
  const rewritten = JSON.parse(unb64(envelope.result.Body));

  expect(rewritten.messages[0].content).toBe("keep Powered by Proxy X in user text");
  expect(rewritten.messages[1].content).toBe("tool ok  end");
  expect(envelope.result.ClearHeaders).toContain("Content-Length");
});

test("request body rewrite strips OpenAI Responses function_call_output text", async () => {
  const body = JSON.stringify({
    input: [
      { type: "message", role: "user", content: [{ type: "input_text", text: "keep Powered by Proxy X" }] },
      { type: "function_call_output", call_id: "call_1", output: "tool Powered by Proxy X result" },
    ],
  });

  const out = await rewriteCliProxyRequestBody(Buffer.from(body, "utf8"), "request-entry-test", config);
  const rewritten = JSON.parse(Buffer.from(out).toString("utf8"));

  expect(rewritten.input[0].content[0].text).toBe("keep Powered by Proxy X");
  expect(rewritten.input[1].output).toBe("tool  result");
});
