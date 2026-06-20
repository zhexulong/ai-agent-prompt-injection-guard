import { expect, test } from "bun:test";
import { waitForCliProxyHotReload } from "./cliproxy-lifecycle";

test("waitForCliProxyHotReload checks health and model access without restarting CPA", async () => {
  const calls: string[] = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    calls.push(`${href} ${init?.headers ? JSON.stringify(init.headers) : ""}`);
    if (href.endsWith("/healthz")) return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    if (href.endsWith("/v1/models")) return Response.json({ data: [] });
    return new Response("not found", { status: 404 });
  };

  const result = await waitForCliProxyHotReload({
    baseUrl: "http://127.0.0.1:8317",
    clientKey: "eval-key",
    timeoutMs: 100,
    intervalMs: 1,
    fetchImpl: fetchImpl as typeof fetch,
  });

  expect(result.ok).toBe(true);
  expect(result.healthz).toBe(200);
  expect(result.models).toBe(200);
  expect(calls.some((call) => call.includes("Bearer eval-key"))).toBe(true);
});

test("waitForCliProxyHotReload returns a non-throwing failure result on timeout", async () => {
  const result = await waitForCliProxyHotReload({
    baseUrl: "http://127.0.0.1:8317",
    clientKey: "eval-key",
    timeoutMs: 5,
    intervalMs: 1,
    fetchImpl: (async () => new Response("down", { status: 503 })) as unknown as typeof fetch,
  });

  expect(result.ok).toBe(false);
  expect(result.lastError).toContain("503");
});
