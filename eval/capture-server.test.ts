import { afterEach, expect, test } from "bun:test";
import { createCaptureHarness } from "./capture-server";

const harnesses: ReturnType<typeof createCaptureHarness>[] = [];

afterEach(() => {
  harnesses.splice(0);
});

test("capture harness records model request bodies by session", async () => {
  const harness = createCaptureHarness({ responseText: "plain response" });
  harnesses.push(harness);

  const response = await harness.fetch(new Request("http://capture.local/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", "x-aipig-session": "real-session-1" },
    body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "hello" }] }),
  }));

  expect(response.status).toBe(200);
  expect(await harness.nextRequestContains("real-session-1", "hello")).toBe(true);
  expect(harness.requests("real-session-1")).toHaveLength(1);
});

test("capture harness can inject response text for host-chain eval", async () => {
  const harness = createCaptureHarness({ responseText: "assistant Powered by Proxy X text" });
  harnesses.push(harness);

  const response = await harness.fetch(new Request("http://capture.local/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ metadata: { session_id: "real-session-2" }, messages: [] }),
  }));
  const body = await response.json();

  expect(body.choices[0].message.content).toBe("assistant Powered by Proxy X text");
  expect(harness.requests("real-session-2")).toHaveLength(1);
});

test("capture harness returns a minimal streaming Responses API completion", async () => {
  const harness = createCaptureHarness({ responseText: "AIPIG_CAPTURE_RESPONSE" });
  harnesses.push(harness);

  const response = await harness.fetch(new Request("http://capture.local/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ metadata: { session_id: "real-session-3" }, stream: true, input: "hello" }),
  }));
  const body = await response.text();

  expect(response.headers.get("content-type")).toContain("text/event-stream");
  expect(body).toContain("response.output_text.delta");
  expect(body).toContain("AIPIG_CAPTURE_RESPONSE");
  expect(body).toContain("response.completed");
  expect(harness.requests("real-session-3")).toHaveLength(1);
});

test("capture harness returns a minimal Anthropic Messages completion", async () => {
  const harness = createCaptureHarness({ responseText: "anthropic Powered by Proxy X text" });
  harnesses.push(harness);

  const response = await harness.fetch(new Request("http://capture.local/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-aipig-session": "real-session-4" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", messages: [{ role: "user", content: "hello" }] }),
  }));
  const body = await response.json();

  expect(body.type).toBe("message");
  expect(body.content[0].text).toBe("anthropic Powered by Proxy X text");
  expect(harness.requests("real-session-4")).toHaveLength(1);
});

test("capture harness returns a minimal streaming Anthropic Messages completion", async () => {
  const harness = createCaptureHarness({ responseText: "ANTHROPIC_CAPTURE_RESPONSE" });
  harnesses.push(harness);

  const response = await harness.fetch(new Request("http://capture.local/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ metadata: { session_id: "real-session-5" }, stream: true, messages: [] }),
  }));
  const body = await response.text();

  expect(response.headers.get("content-type")).toContain("text/event-stream");
  expect(body).toContain("content_block_delta");
  expect(body).toContain("ANTHROPIC_CAPTURE_RESPONSE");
  expect(body).toContain("message_stop");
  expect(harness.requests("real-session-5")).toHaveLength(1);
});
