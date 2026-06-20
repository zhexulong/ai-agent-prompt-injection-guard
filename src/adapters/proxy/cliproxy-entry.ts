import type { GuardConfig } from "../../config";
import { loadConfig } from "../../config";
import { rewriteProxyResponse, rewriteProxyToolResult } from "./cliproxy";

export interface CliProxyEnvelope {
  ok: boolean;
  result?: any;
  error?: {
    code: string;
    message: string;
    retryable?: boolean;
  };
}

const textKeys = new Set(["content", "text", "delta", "output_text"]);
const toolResultStringKeys = new Set(["content", "text", "output", "result"]);
const toolResultTypes = new Set(["function_call_output", "tool_result", "tool_response"]);

export function decodeCliProxyEnvelope(raw: string | Uint8Array): CliProxyEnvelope {
  const text = typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8");
  return JSON.parse(text) as CliProxyEnvelope;
}

export async function handleCliProxyPluginCall(
  method: string,
  request: any,
  config: GuardConfig = loadConfig(),
): Promise<string> {
  try {
    switch (method) {
      case "plugin.register":
      case "plugin.reconfigure":
        return okEnvelope(pluginRegistration());
      case "plugin.shutdown":
        return okEnvelope({});
      case "request.intercept_before":
        return okEnvelope(await handleRequestIntercept(request, config));
      case "response.intercept_after":
        return okEnvelope(await handleResponseIntercept(request, config));
      case "response.intercept_stream_chunk":
        return okEnvelope(await handleStreamChunkIntercept(request, config));
      default:
        return errorEnvelope("unknown_method", `unknown method: ${method}`);
    }
  } catch (error) {
    return errorEnvelope("plugin_error", error instanceof Error ? error.message : String(error));
  }
}

export async function rewriteCliProxyResponseBody(
  body: Uint8Array,
  sessionId: string,
  config: GuardConfig = loadConfig(),
): Promise<Uint8Array> {
  const text = Buffer.from(body).toString("utf8");
  const rewrittenJson = await rewriteJsonResponseText(text, sessionId, config);
  if (rewrittenJson !== undefined) return Buffer.from(rewrittenJson, "utf8");

  const rewritten = await rewriteProxyResponse({ text, sessionId, host: "proxy" }, config);
  return Buffer.from(rewritten.text, "utf8");
}

export async function rewriteCliProxyRequestBody(
  body: Uint8Array,
  sessionId: string,
  config: GuardConfig = loadConfig(),
): Promise<Uint8Array> {
  const text = Buffer.from(body).toString("utf8");
  const rewrittenJson = await rewriteJsonRequestToolResults(text, sessionId, config);
  return Buffer.from(rewrittenJson ?? text, "utf8");
}

async function rewriteJsonResponseText(
  text: string,
  sessionId: string,
  config: GuardConfig,
): Promise<string | undefined> {
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }

  const rewritten = await rewriteJsonValue(json, sessionId, config);
  return JSON.stringify(rewritten);
}

async function rewriteJsonValue(value: any, sessionId: string, config: GuardConfig, key?: string): Promise<any> {
  if (typeof value === "string") {
    if (key === undefined || textKeys.has(key)) {
      return (await rewriteProxyResponse({ text: value, sessionId, host: "proxy" }, config)).text;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => rewriteJsonValue(item, sessionId, config)));
  }
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [itemKey, itemValue] of Object.entries(value)) {
      out[itemKey] = await rewriteJsonValue(itemValue, sessionId, config, itemKey);
    }
    return out;
  }
  return value;
}

async function rewriteJsonRequestToolResults(
  text: string,
  sessionId: string,
  config: GuardConfig,
): Promise<string | undefined> {
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }

  const rewritten = await rewriteJsonRequestValue(json, sessionId, config);
  return JSON.stringify(rewritten);
}

async function rewriteJsonRequestValue(
  value: any,
  sessionId: string,
  config: GuardConfig,
  key?: string,
  inToolResult = false,
): Promise<any> {
  if (typeof value === "string") {
    if (inToolResult && (key === undefined || toolResultStringKeys.has(key))) {
      return (await rewriteProxyToolResult({ text: value, sessionId, host: "proxy" }, config)).text;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => rewriteJsonRequestValue(item, sessionId, config, undefined, inToolResult)));
  }
  if (value && typeof value === "object") {
    const nextInToolResult = inToolResult || isToolResultContainer(value);
    const out: Record<string, any> = {};
    for (const [itemKey, itemValue] of Object.entries(value)) {
      out[itemKey] = await rewriteJsonRequestValue(itemValue, sessionId, config, itemKey, nextInToolResult);
    }
    return out;
  }
  return value;
}

function isToolResultContainer(value: Record<string, any>): boolean {
  return value.role === "tool" || toolResultTypes.has(value.type);
}

async function handleRequestIntercept(request: any, config: GuardConfig) {
  const body = decodeBody(request?.Body);
  if (!body) return {};

  const sessionId = sessionIdFromInterceptRequest(request);
  const rewritten = await rewriteCliProxyRequestBody(body, sessionId, config);
  return {
    Body: encodeBody(rewritten),
    ClearHeaders: ["Content-Length"],
  };
}

async function handleResponseIntercept(request: any, config: GuardConfig) {
  const body = decodeBody(request?.Body);
  if (!body) return {};

  const sessionId = sessionIdFromInterceptRequest(request);
  const rewritten = await rewriteCliProxyResponseBody(body, sessionId, config);
  return {
    Body: encodeBody(rewritten),
    ClearHeaders: ["Content-Length"],
  };
}

async function handleStreamChunkIntercept(request: any, config: GuardConfig) {
  const body = decodeBody(request?.Body);
  if (!body) return {};

  const sessionId = sessionIdFromInterceptRequest(request);
  const rewritten = await rewriteCliProxyResponseBody(body, sessionId, config);
  return {
    Body: encodeBody(rewritten),
    ClearHeaders: ["Content-Length"],
  };
}

function pluginRegistration() {
  return {
    schema_version: 1,
    metadata: {
      Name: "ai-agent-prompt-injection-guard",
      Version: "0.1.0",
      Author: "ai-agent-prompt-injection-guard",
      GitHubRepository: "https://github.com/zhexulong/ai-agent-prompt-injection-guard",
      Logo: "",
      ConfigFields: [],
    },
    capabilities: {
      request_interceptor: true,
      response_interceptor: true,
      response_stream_interceptor: true,
    },
  };
}

function decodeBody(value: unknown): Uint8Array | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return Buffer.from(value, "base64");
}

function encodeBody(value: Uint8Array): string {
  return Buffer.from(value).toString("base64");
}

function sessionIdFromInterceptRequest(request: any): string {
  return request?.Metadata?.session_id
    ?? request?.Metadata?.sessionId
    ?? request?.RequestedModel
    ?? request?.Model
    ?? "cliproxy-session";
}

function okEnvelope(result: any): string {
  return JSON.stringify({ ok: true, result });
}

function errorEnvelope(code: string, message: string): string {
  return JSON.stringify({ ok: false, error: { code, message } });
}

async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of Bun.stdin.stream()) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

if (import.meta.main) {
  const method = Bun.argv[2];
  if (!method) {
    console.error("usage: bun src/adapters/proxy/cliproxy-entry.ts <cliproxy-method>");
    process.exit(2);
  }
  const input = await readStdin();
  const request = input.trim() ? JSON.parse(input) : {};
  process.stdout.write(await handleCliProxyPluginCall(method, request));
}
