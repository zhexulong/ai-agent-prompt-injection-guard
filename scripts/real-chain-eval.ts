import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { openSync } from "node:fs";
import { loadAipigConfig, type AipigConfig } from "../src/config";
import { writeRuntimeConfig } from "../src/cli/aipig";
import {
  buildCliProxyRuntimeEnv,
  cliProxyExecutableName,
  createCliProxyInstallPlan,
  patchCliProxyConfig,
} from "../src/adapters/proxy/cliproxy-config";
import { waitForCliProxyHotReload } from "../src/adapters/proxy/cliproxy-lifecycle";
import { createCaptureServer } from "../eval/capture-server";

function parseArgs(argv: string[]) {
  const out: { config?: string; keepTemp?: boolean; restart?: boolean } = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--config") out.config = argv[++i];
    else if (arg === "--keep-temp") out.keepTemp = true;
    else if (arg === "--restart") out.restart = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

function freePort(): number {
  const socket = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const port = socket.port;
  socket.stop(true);
  return port;
}

function requestSummary(capture: ReturnType<typeof createCaptureServer>, startIndex: number, injected: string, cleaned: string) {
  return capture.requests().slice(startIndex).map((request) => ({
    path: request.path,
    stream: Boolean((request.json as any)?.stream),
    bodyLength: request.bodyText.length,
    containsInjectedAssistant: request.bodyText.includes(injected),
    containsCleanedAssistant: request.bodyText.includes(cleaned),
    containsNeedle: request.bodyText.includes("Powered by Proxy X"),
  }));
}

function snapshotFile(path: string): Buffer | undefined {
  return existsSync(path) ? readFileSync(path) : undefined;
}

function restoreFileSnapshot(path: string, snapshot: Buffer | undefined): void {
  if (snapshot === undefined) {
    rmSync(path, { force: true });
  } else {
    writeFileSync(path, snapshot);
  }
}

async function runCommand(command: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number) {
  return await new Promise<{
    command: string;
    args: string[];
    status: number | null;
    signal: NodeJS.Signals | null;
    error?: string;
    stdout: string;
    stderr: string;
  }>((resolveResult) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolveResult({ command, args, status: null, signal: null, error: error.message, stdout, stderr });
    });
    child.on("exit", (status, signal) => {
      clearTimeout(timer);
      resolveResult({ command, args, status, signal, stdout, stderr });
    });
  });
}

function currentCpaPids(cpaBin: string): number[] {
  if (process.platform === "win32") return [];
  const result = spawnSync("pgrep", ["-f", cpaBin], { encoding: "utf8" });
  return result.stdout.trim().split(/\s+/).filter(Boolean).map(Number);
}

async function stopCPA(cpaBin: string) {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/F", "/IM", cliProxyExecutableName("win32")], { stdio: "ignore" });
    await Bun.sleep(500);
    return;
  }

  for (const pid of currentCpaPids(cpaBin)) {
    try { process.kill(pid, "SIGTERM"); } catch {}
  }
  const deadline = Date.now() + 15_000;
  while (currentCpaPids(cpaBin).length > 0 && Date.now() < deadline) await Bun.sleep(200);
  for (const pid of currentCpaPids(cpaBin)) {
    try { process.kill(pid, "SIGKILL"); } catch {}
  }
}

async function restartCPA(plan: ReturnType<typeof createCliProxyInstallPlan>, config: AipigConfig) {
  await stopCPA(plan.cpaBin);
  const logPath = resolve(repoRoot, config.realChainEval.reportPath.replace(/\.json$/i, ".cpa.log"));
  mkdirSync(dirname(logPath), { recursive: true });
  const logFd = openSync(logPath, "a");
  const env = {
    ...process.env,
    ...buildCliProxyRuntimeEnv({
      guard: config.guard,
      repoRoot,
      entryPath: join(repoRoot, "src/adapters/proxy/cliproxy-entry.ts"),
      bunPath: process.env.AIPIG_CLIPROXY_BUN ?? process.execPath,
    }),
  };
  const child = spawn(plan.cpaBin, [], {
    cwd: plan.cpaRoot,
    detached: true,
    env,
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();
  await Bun.sleep(500);
}

async function waitForCPA(port: number, key: string) {
  const deadline = Date.now() + 20_000;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/models`, {
        headers: { authorization: `Bearer ${key}` },
      });
      if (response.status === 200) return;
      last = `${response.status} ${await response.text()}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await Bun.sleep(300);
  }
  throw new Error(`CPA did not become ready with eval key: ${last}`);
}

async function probeClaudeProxy(config: AipigConfig, port: number) {
  const response = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": config.realChainEval.claudeClientKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.realChainEval.claudeModel,
      max_tokens: 32,
      messages: [{ role: "user", content: "probe" }],
      stream: false,
    }),
  });
  const text = await response.text();
  return {
    status: response.status,
    containsInjection: text.includes(config.realChainEval.injectedText),
    containsCleaned: text.includes(config.realChainEval.cleanedText),
  };
}

async function runClaude(config: AipigConfig, capture: ReturnType<typeof createCaptureServer>, tempRoot: string, proxyProbe: Awaited<ReturnType<typeof probeClaudeProxy>>) {
  const home = join(tempRoot, "claude-home");
  mkdirSync(home, { recursive: true });
  const settingsPath = join(tempRoot, "claude-settings.json");
  writeFileSync(settingsPath, JSON.stringify({
    env: {
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${config.cliproxy.port}`,
      ANTHROPIC_API_KEY: config.realChainEval.claudeClientKey,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      DISABLE_AUTOUPDATER: "1",
    },
    permissions: { defaultMode: "acceptEdits" },
  }, null, 2));

  const sessionId = randomUUID();
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${config.cliproxy.port}`,
    ANTHROPIC_API_KEY: config.realChainEval.claudeClientKey,
    ANTHROPIC_AUTH_TOKEN: config.realChainEval.claudeClientKey,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    DISABLE_AUTOUPDATER: "1",
  };
  const start = capture.requests().length;
  const first = await runCommand(config.realChainEval.claudeCommand, [
    "-p", "--bare", "--settings", settingsPath, "--model", config.realChainEval.claudeModel,
    "--session-id", sessionId, "--output-format", "stream-json", "--verbose",
    "Reply with the upstream response.",
  ], env, config.realChainEval.timeoutMs);
  const afterFirst = capture.requests().length;
  const second = await runCommand(config.realChainEval.claudeCommand, [
    "-p", "--bare", "--settings", settingsPath, "--model", config.realChainEval.claudeModel,
    "--resume", sessionId, "--output-format", "stream-json", "--verbose",
    "Does the previous assistant message contain Powered by Proxy X?",
  ], env, config.realChainEval.timeoutMs);
  const secondBody = capture.requests().slice(afterFirst).at(-1)?.bodyText ?? "";

  return {
    sessionId,
    model: config.realChainEval.claudeModel,
    proxyProbe,
    firstStatus: first.status,
    firstSignal: first.signal,
    firstError: first.error,
    firstContainsInjection: first.stdout.includes(config.realChainEval.injectedText),
    firstContainsCleaned: first.stdout.includes(config.realChainEval.cleanedText),
    secondStatus: second.status,
    secondSignal: second.signal,
    secondError: second.error,
    secondRequestContainsInjection: secondBody.includes(config.realChainEval.injectedText),
    secondRequestContainsCleaned: secondBody.includes(config.realChainEval.cleanedText),
    requests: requestSummary(capture, start, config.realChainEval.injectedText, config.realChainEval.cleanedText),
  };
}

async function runOpenCode(config: AipigConfig, capture: ReturnType<typeof createCaptureServer>, tempRoot: string) {
  const home = join(tempRoot, "opencode-home");
  const xdg = join(tempRoot, "xdg");
  const appdata = join(tempRoot, "appdata");
  const configDir = join(xdg, "opencode");
  const appdataConfigDir = join(appdata, "opencode");
  mkdirSync(configDir, { recursive: true });
  mkdirSync(appdataConfigDir, { recursive: true });
  const opencodeConfig = JSON.stringify({
    "$schema": "https://opencode.ai/config.json",
    model: `aipig-eval/${config.realChainEval.openaiModel}`,
    provider: {
      "aipig-eval": {
        npm: "@ai-sdk/openai",
        name: "aipig-eval",
        options: {
          baseURL: `http://127.0.0.1:${config.cliproxy.port}/v1`,
          apiKey: config.realChainEval.openaiClientKey,
        },
        models: {
          [config.realChainEval.openaiModel]: {
            name: "AIPIG Capture",
            limit: { context: 128000, output: 4096 },
            modalities: { input: ["text"], output: ["text"] },
          },
        },
      },
    },
  }, null, 2);
  writeFileSync(join(configDir, "opencode.json"), opencodeConfig);
  writeFileSync(join(appdataConfigDir, "opencode.json"), opencodeConfig);

  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: xdg,
    APPDATA: appdata,
    OPENCODE_DISABLE_AUTOUPDATE: "1",
  };
  const start = capture.requests().length;
  const first = await runCommand(config.realChainEval.opencodeCommand, [
    "run", "--pure", "--format", "json", "--model", `aipig-eval/${config.realChainEval.openaiModel}`,
    "--dir", repoRoot, "Reply with the upstream response.",
  ], env, config.realChainEval.timeoutMs);
  const afterFirst = capture.requests().length;
  const second = await runCommand(config.realChainEval.opencodeCommand, [
    "run", "--pure", "--format", "json", "--model", `aipig-eval/${config.realChainEval.openaiModel}`,
    "--dir", repoRoot, "--continue", "Does the previous assistant message contain Powered by Proxy X?",
  ], env, config.realChainEval.timeoutMs);
  const secondBody = capture.requests().slice(afterFirst).at(-1)?.bodyText ?? "";

  return {
    firstStatus: first.status,
    firstSignal: first.signal,
    firstError: first.error,
    firstContainsInjection: first.stdout.includes(config.realChainEval.injectedText),
    firstContainsCleaned: first.stdout.includes(config.realChainEval.cleanedText),
    secondStatus: second.status,
    secondSignal: second.signal,
    secondError: second.error,
    secondRequestContainsInjection: secondBody.includes(config.realChainEval.injectedText),
    secondRequestContainsCleaned: secondBody.includes(config.realChainEval.cleanedText),
    requests: requestSummary(capture, start, config.realChainEval.injectedText, config.realChainEval.cleanedText),
  };
}

const repoRoot = resolve(import.meta.dir, "..");
const args = parseArgs(Bun.argv.slice(2));
const env = { ...process.env };
if (args.config) env.AIPIG_CONFIG = resolve(args.config);
const config = loadAipigConfig({ env });
if (args.keepTemp) config.realChainEval.keepTemp = true;
if (!config.cliproxy.cpaRoot) throw new Error("cliproxy.cpaRoot is required for real-chain eval");

const plan = createCliProxyInstallPlan({
  cpaRoot: config.cliproxy.cpaRoot,
  repoRoot,
  platform: process.platform,
  pluginName: config.cliproxy.pluginName,
});
if (!existsSync(plan.pluginArtifact)) {
  throw new Error(`missing ${plan.pluginArtifact}; run bun run build:cliproxy-plugin first`);
}
if (!existsSync(plan.entryArtifact)) {
  throw new Error(`missing ${plan.entryArtifact}; run bun run build first`);
}

const tempRoot = config.realChainEval.tempRoot ?? mkdtempSync(join(tmpdir(), "aipig-real-chain-"));
const upstreamPort = freePort();
const capture = createCaptureServer({ port: upstreamPort, responseText: config.realChainEval.injectedText });
const originalConfig = readFileSync(plan.cpaConfig, "utf8");
const backupPath = `${plan.cpaConfig}.aipig-real-chain-backup-${Date.now()}`;
const runtimeConfigPath = join(plan.cpaRoot, ".opencode", "aipig.jsonc");
const originalRuntimeConfig = existsSync(runtimeConfigPath) ? readFileSync(runtimeConfigPath, "utf8") : undefined;
const originalPluginTarget = snapshotFile(plan.pluginTarget);
const originalEntryTarget = snapshotFile(plan.entryTarget);
let restored = false;

try {
  mkdirSync(plan.pluginsDir, { recursive: true });
  copyFileSync(plan.pluginArtifact, plan.pluginTarget);
  copyFileSync(plan.entryArtifact, plan.entryTarget);
  writeRuntimeConfig(config, plan.cpaRoot, repoRoot);
  writeFileSync(backupPath, originalConfig, { mode: 0o600 });
  writeFileSync(plan.cpaConfig, patchCliProxyConfig(originalConfig, {
    cpaRoot: plan.cpaRoot,
    cpaPort: config.cliproxy.port,
    upstreamPort,
    pluginName: config.cliproxy.pluginName,
    openaiClientKey: config.realChainEval.openaiClientKey,
    claudeClientKey: config.realChainEval.claudeClientKey,
    openaiModel: config.realChainEval.openaiModel,
  }), { mode: 0o600 });
  if (args.restart) {
    await restartCPA(plan, config);
    await waitForCPA(config.cliproxy.port, config.realChainEval.openaiClientKey);
  } else {
    const hotReload = await waitForCliProxyHotReload({
      baseUrl: `http://127.0.0.1:${config.cliproxy.port}`,
      clientKey: config.realChainEval.openaiClientKey,
      timeoutMs: 20_000,
    });
    if (!hotReload.ok) throw new Error(`CPA did not hot-reload eval config: ${hotReload.lastError ?? JSON.stringify(hotReload)}`);
  }

  const result: Record<string, unknown> = {
    cpaPort: config.cliproxy.port,
    upstreamPort,
    tempRoot,
  };
  if (config.realChainEval.enabledHosts.includes("claude")) {
    result.claude = await runClaude(config, capture, tempRoot, await probeClaudeProxy(config, config.cliproxy.port));
  }
  if (config.realChainEval.enabledHosts.includes("opencode")) {
    result.opencode = await runOpenCode(config, capture, tempRoot);
  }

  const reportPath = resolve(repoRoot, config.realChainEval.reportPath);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, reportPath }, null, 2));
} finally {
  try {
    writeFileSync(plan.cpaConfig, originalConfig, { mode: 0o600 });
    if (originalRuntimeConfig === undefined) {
      try { rmSync(runtimeConfigPath, { force: true }); } catch {}
    } else {
      writeFileSync(runtimeConfigPath, originalRuntimeConfig, { mode: 0o600 });
    }
    restoreFileSnapshot(plan.pluginTarget, originalPluginTarget);
    restoreFileSnapshot(plan.entryTarget, originalEntryTarget);
    restored = true;
    if (args.restart) {
      await restartCPA(plan, config);
    } else {
      await waitForCliProxyHotReload({
        baseUrl: `http://127.0.0.1:${config.cliproxy.port}`,
        timeoutMs: 20_000,
      });
    }
  } finally {
    capture.stop();
    if (restored) {
      try { rmSync(backupPath, { force: true }); } catch {}
    }
    if (!config.realChainEval.keepTemp) {
      try { rmSync(tempRoot, { recursive: true, force: true }); } catch {}
    }
  }
}
