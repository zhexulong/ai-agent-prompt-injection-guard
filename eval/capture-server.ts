export interface CapturedRequest {
  ts: string;
  sessionId: string;
  path: string;
  bodyText: string;
  json?: unknown;
}

export interface CaptureServerOptions {
  responseText?: string;
  port?: number;
}

function sessionIdFrom(req: Request, json: any): string {
  return req.headers.get("x-aipig-session")
    ?? json?.metadata?.session_id
    ?? json?.metadata?.sessionId
    ?? json?.session_id
    ?? json?.sessionId
    ?? "unknown-session";
}

function chatCompletionBody(content: string) {
  return {
    id: "aipig-capture-response",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "aipig-capture",
    choices: [{
      index: 0,
      message: { role: "assistant", content },
      finish_reason: "stop",
    }],
  };
}

function chatCompletionResponse(content: string, stream: boolean): Response {
  if (!stream) return Response.json(chatCompletionBody(content));

  const created = Math.floor(Date.now() / 1000);
  const events = [
    {
      id: "aipig-capture-response",
      object: "chat.completion.chunk",
      created,
      model: "aipig-capture",
      choices: [{
        index: 0,
        delta: { role: "assistant", content },
        finish_reason: null,
      }],
    },
    {
      id: "aipig-capture-response",
      object: "chat.completion.chunk",
      created,
      model: "aipig-capture",
      choices: [{
        index: 0,
        delta: {},
        finish_reason: "stop",
      }],
    },
  ];
  const body = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(body, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    },
  });
}

function responsesOutput(content: string) {
  return {
    id: "aipig-capture-response",
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    model: "aipig-capture",
    output: [{
      id: "aipig-capture-message",
      type: "message",
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text: content, annotations: [] }],
    }],
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      total_tokens: 2,
    },
  };
}

function responsesApiResponse(content: string, stream: boolean): Response {
  const response = responsesOutput(content);
  if (!stream) return Response.json(response);

  const outputItem = response.output[0];
  const contentPart = outputItem.content[0];
  const events = [
    { type: "response.created", response: { ...response, status: "in_progress", output: [] } },
    { type: "response.output_item.added", output_index: 0, item: { ...outputItem, status: "in_progress", content: [] } },
    { type: "response.content_part.added", item_id: outputItem.id, output_index: 0, content_index: 0, part: { ...contentPart, text: "" } },
    { type: "response.output_text.delta", item_id: outputItem.id, output_index: 0, content_index: 0, delta: content },
    { type: "response.output_text.done", item_id: outputItem.id, output_index: 0, content_index: 0, text: content },
    { type: "response.content_part.done", item_id: outputItem.id, output_index: 0, content_index: 0, part: contentPart },
    { type: "response.output_item.done", output_index: 0, item: outputItem },
    { type: "response.completed", response },
  ];
  const body = events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(body, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    },
  });
}

export function createCaptureHarness(options: CaptureServerOptions = {}) {
  const captured: CapturedRequest[] = [];
  const responseText = options.responseText ?? "capture response";

  return {
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);
      if (req.method === "GET" && url.pathname === "/health") return new Response("ok");
      if (req.method === "GET" && url.pathname.endsWith("/models")) {
        const created = Math.floor(Date.now() / 1000);
        return Response.json({
          object: "list",
          data: ["aipig-capture", "gpt-5.5"].map((id) => ({
            id,
            object: "model",
            created,
            owned_by: "aipig",
          })),
        });
      }
      if (req.method !== "POST") return new Response("not found", { status: 404 });

      const bodyText = await req.text();
      let json: unknown;
      try {
        json = bodyText ? JSON.parse(bodyText) : undefined;
      } catch {
        json = undefined;
      }

      captured.push({
        ts: new Date().toISOString(),
        sessionId: sessionIdFrom(req, json),
        path: url.pathname,
        bodyText,
        json,
      });

      if (url.pathname.endsWith("/chat/completions")) return chatCompletionResponse(responseText, Boolean((json as any)?.stream));
      if (url.pathname.endsWith("/responses")) return responsesApiResponse(responseText, Boolean((json as any)?.stream));
      return Response.json({ ok: true });
    },
    requests(sessionId?: string): CapturedRequest[] {
      return sessionId ? captured.filter((request) => request.sessionId === sessionId) : [...captured];
    },
    async nextRequestContains(sessionId: string, needle: string): Promise<boolean> {
      return captured.some((request) => request.sessionId === sessionId && request.bodyText.includes(needle));
    },
  };
}

export function createCaptureServer(options: CaptureServerOptions = {}) {
  const harness = createCaptureHarness(options);
  const port = options.port ?? 59180;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch: harness.fetch,
  });

  return {
    ...harness,
    url(path = ""): string {
      return `http://${server.hostname}:${server.port}${path}`;
    },
    stop(): void {
      server.stop(true);
    },
  };
}

if (import.meta.main) {
  const responseTextIndex = Bun.argv.indexOf("--response-text");
  const portIndex = Bun.argv.indexOf("--port");
  const responseText = responseTextIndex >= 0 ? Bun.argv[responseTextIndex + 1] : undefined;
  const port = portIndex >= 0 ? Number(Bun.argv[portIndex + 1]) : undefined;
  const server = createCaptureServer({ responseText, port });
  console.log(`capture server listening at ${server.url()}`);
}
