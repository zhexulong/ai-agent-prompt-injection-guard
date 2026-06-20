export interface HotReloadWaitOptions {
  baseUrl: string;
  clientKey?: string;
  timeoutMs?: number;
  intervalMs?: number;
  fetchImpl?: typeof fetch;
}

export interface HotReloadWaitResult {
  ok: boolean;
  healthz?: number;
  models?: number;
  lastError?: string;
}

export async function waitForCliProxyHotReload(options: HotReloadWaitOptions): Promise<HotReloadWaitResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const intervalMs = options.intervalMs ?? 250;
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const deadline = Date.now() + timeoutMs;
  let last: HotReloadWaitResult = { ok: false };

  while (Date.now() < deadline) {
    last = await probe(fetchImpl, baseUrl, options.clientKey);
    if (last.ok) return last;
    await Bun.sleep(intervalMs);
  }

  return last;
}

async function probe(fetchImpl: typeof fetch, baseUrl: string, clientKey?: string): Promise<HotReloadWaitResult> {
  try {
    const health = await fetchImpl(`${baseUrl}/healthz`);
    if (health.status < 200 || health.status >= 500) {
      return { ok: false, healthz: health.status, lastError: `${health.status} ${await safeText(health)}` };
    }
    if (!clientKey) return { ok: true, healthz: health.status };

    const models = await fetchImpl(`${baseUrl}/v1/models`, {
      headers: { authorization: `Bearer ${clientKey}` },
    });
    return {
      ok: models.status === 200,
      healthz: health.status,
      models: models.status,
      lastError: models.status === 200 ? undefined : `${models.status} ${await safeText(models)}`,
    };
  } catch (error) {
    return { ok: false, lastError: error instanceof Error ? error.message : String(error) };
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
