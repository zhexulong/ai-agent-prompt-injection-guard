import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { loadAipigConfig, type AipigConfig } from "../config";
import {
  createCliProxyInstallPlan,
  patchCliProxyPluginConfig,
  unpatchCliProxyPluginConfig,
} from "../adapters/proxy/cliproxy-config";
import { waitForCliProxyHotReload } from "../adapters/proxy/cliproxy-lifecycle";

export interface ParsedAipigArgs {
  command?: string;
  cliproxyCommand?: string;
  config?: string;
  backup?: string;
  write: boolean;
  force: boolean;
  json: boolean;
}

export interface AipigCliDeps {
  cwd?: string;
  repoRoot?: string;
  fetchImpl?: typeof fetch;
  spawnBuild?: () => Promise<number> | number;
}

export interface AipigCliResult {
  status: number;
  stdout: string;
  stderr: string;
}

export function parseAipigArgs(argv: string[]): ParsedAipigArgs {
  const out: ParsedAipigArgs = {
    command: argv[0],
    write: false,
    force: false,
    json: false,
  };
  let start = 1;
  if (out.command === "cliproxy") {
    out.cliproxyCommand = argv[1];
    start = 2;
  }
  for (let i = start; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--config") out.config = argv[++i];
    else if (arg === "--backup") out.backup = argv[++i];
    else if (arg === "--write") out.write = true;
    else if (arg === "--force") out.force = true;
    else if (arg === "--json") out.json = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

export async function runAipigCli(argv: string[], deps: AipigCliDeps = {}): Promise<AipigCliResult> {
  try {
    const args = parseAipigArgs(argv);
    const cwd = deps.cwd ?? process.cwd();
    const repoRoot = deps.repoRoot ?? resolve(import.meta.dir, "../..");

    if (args.command === "init") return initConfig(args, cwd);
    if (args.command === "doctor") return cliproxyDoctor(args, repoRoot);
    if (args.command === "build-plugin") return buildPlugin(deps);
    if (args.command === "cliproxy") return await cliproxy(args, repoRoot, cwd, deps.fetchImpl);
    return fail(`usage: aipig <init|doctor|build-plugin|cliproxy>`);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

function initConfig(args: ParsedAipigArgs, cwd: string): AipigCliResult {
  const configPath = resolve(cwd, args.config ?? ".opencode/aipig.jsonc");
  if (existsSync(configPath) && !args.force) return fail(`${configPath} already exists; pass --force to overwrite`);
  mkdirSync(dirname(configPath), { recursive: true });
  const content = [
    "{",
    "  \"$schema\": \"https://raw.githubusercontent.com/zhexulong/ai-agent-prompt-injection-guard/master/examples/aipig.schema.json\",",
    "  \"guard\": {",
    "    \"fingerprintsPath\": \"fingerprints.json\",",
    "    \"alertsPath\": \"alerts.jsonl\",",
    "    \"pendingSuggestionsPath\": \"pending-suggestions.json\"",
    "  },",
    "  \"cliproxy\": {",
    "    \"cpaRoot\": \"/absolute/path/to/cliproxyapi\",",
    "    \"port\": 8317,",
    "    \"pluginName\": \"cliproxy-aipig\"",
    "  }",
    "}",
    "",
  ].join("\n");
  writeFileSync(configPath, content);
  return ok(`created ${configPath}\n`);
}

async function buildPlugin(deps: AipigCliDeps): Promise<AipigCliResult> {
  const status = await (deps.spawnBuild?.() ?? 0);
  return status === 0 ? ok("built CLIProxyAPI plugin\n") : fail("failed to build CLIProxyAPI plugin");
}

async function cliproxy(args: ParsedAipigArgs, repoRoot: string, cwd: string, fetchImpl?: typeof fetch): Promise<AipigCliResult> {
  switch (args.cliproxyCommand) {
    case "doctor":
      return cliproxyDoctor(args, repoRoot);
    case "diff":
      return cliproxyDiff(args, repoRoot);
    case "install":
      return await cliproxyInstall(args, repoRoot, cwd, fetchImpl);
    case "uninstall":
      return cliproxyUninstall(args, repoRoot);
    case "restore":
      return cliproxyRestore(args, repoRoot);
    default:
      return fail("usage: aipig cliproxy <doctor|diff|install|uninstall|restore>");
  }
}

function cliproxyDoctor(args: ParsedAipigArgs, repoRoot: string): AipigCliResult {
  const plan = planFromArgs(args, repoRoot);
  const result = {
    cpaRoot: plan.cpaRoot,
    cpaBin: plan.cpaBin,
    cpaConfig: plan.cpaConfig,
    pluginArtifact: plan.pluginArtifact,
    pluginTarget: plan.pluginTarget,
    entryArtifact: plan.entryArtifact,
    entryTarget: plan.entryTarget,
    checks: {
      cpaRootExists: existsSync(plan.cpaRoot),
      cpaBinExists: existsSync(plan.cpaBin),
      cpaConfigExists: existsSync(plan.cpaConfig),
      pluginArtifactExists: existsSync(plan.pluginArtifact),
      pluginTargetExists: existsSync(plan.pluginTarget),
      entryArtifactExists: existsSync(plan.entryArtifact),
      entryTargetExists: existsSync(plan.entryTarget),
    },
  };
  const prerequisitesReady = result.checks.cpaRootExists
    && result.checks.cpaBinExists
    && result.checks.cpaConfigExists
    && result.checks.pluginArtifactExists
    && result.checks.entryArtifactExists;
  return {
    status: prerequisitesReady ? 0 : 1,
    stdout: JSON.stringify(result, null, 2),
    stderr: "",
  };
}

function cliproxyDiff(args: ParsedAipigArgs, repoRoot: string): AipigCliResult {
  const { plan, config } = planAndConfig(args, repoRoot);
  const original = readFileSync(plan.cpaConfig, "utf8");
  const patched = patchCliProxyPluginConfig(original, {
    cpaRoot: plan.cpaRoot,
    pluginName: config.cliproxy.pluginName,
  });
  return ok(patched);
}

async function cliproxyInstall(args: ParsedAipigArgs, repoRoot: string, cwd: string, fetchImpl?: typeof fetch): Promise<AipigCliResult> {
  const { plan, config } = planAndConfig(args, repoRoot);
  const original = readFileSync(plan.cpaConfig, "utf8");
  const patched = patchCliProxyPluginConfig(original, {
    cpaRoot: plan.cpaRoot,
    pluginName: config.cliproxy.pluginName,
  });
  if (!args.write) return ok(`${patched}\ndry-run only. Re-run with --write to copy the plugin and update config.yaml.\n`);

  mkdirSync(plan.pluginsDir, { recursive: true });
  copyFileSync(plan.pluginArtifact, plan.pluginTarget);
  copyFileSync(plan.entryArtifact, plan.entryTarget);
  writeRuntimeConfig(config, plan.cpaRoot, cwd);
  const backup = `${plan.cpaConfig}.aipig-backup-${Date.now()}`;
  writeFileSync(backup, original, { mode: 0o600 });
  writeFileSync(plan.cpaConfig, patched, { mode: 0o600 });
  const hotReload = await waitForCliProxyHotReload({
    baseUrl: `http://127.0.0.1:${config.cliproxy.port}`,
    timeoutMs: 5_000,
    fetchImpl,
  });
  return ok(JSON.stringify({ backup, pluginTarget: plan.pluginTarget, cpaConfig: plan.cpaConfig, hotReload }, null, 2));
}

export function writeRuntimeConfig(config: AipigConfig, cpaRoot: string, baseDir: string): string {
  const target = join(cpaRoot, ".opencode", "aipig.jsonc");
  mkdirSync(dirname(target), { recursive: true });
  const runtime = {
    enabled: config.enabled,
    guard: {
      ...config.guard,
      fingerprintsPath: absolutize(config.guard.fingerprintsPath, baseDir),
      alertsPath: absolutize(config.guard.alertsPath, baseDir),
      pendingSuggestionsPath: absolutize(config.guard.pendingSuggestionsPath, baseDir),
    },
  };
  writeFileSync(target, `${JSON.stringify(runtime, null, 2)}\n`, { mode: 0o600 });
  return target;
}

function absolutize(path: string, baseDir: string): string {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) ? path : resolve(baseDir, path);
}

function cliproxyUninstall(args: ParsedAipigArgs, repoRoot: string): AipigCliResult {
  const { plan, config } = planAndConfig(args, repoRoot);
  const original = readFileSync(plan.cpaConfig, "utf8");
  const patched = unpatchCliProxyPluginConfig(original, config.cliproxy.pluginName);
  if (!args.write) return ok(`${patched}\ndry-run only. Re-run with --write to update config.yaml.\n`);
  const backup = `${plan.cpaConfig}.aipig-backup-${Date.now()}`;
  writeFileSync(backup, original, { mode: 0o600 });
  writeFileSync(plan.cpaConfig, patched, { mode: 0o600 });
  return ok(JSON.stringify({ backup, cpaConfig: plan.cpaConfig }, null, 2));
}

function cliproxyRestore(args: ParsedAipigArgs, repoRoot: string): AipigCliResult {
  if (!args.backup) return fail("--backup is required");
  const { plan } = planAndConfig(args, repoRoot);
  const backup = readFileSync(resolve(args.backup), "utf8");
  if (!args.write) return ok(`${backup}\ndry-run only. Re-run with --write to restore config.yaml.\n`);
  writeFileSync(plan.cpaConfig, backup, { mode: 0o600 });
  return ok(JSON.stringify({ restored: plan.cpaConfig, backup: resolve(args.backup) }, null, 2));
}

function planFromArgs(args: ParsedAipigArgs, repoRoot: string) {
  return planAndConfig(args, repoRoot).plan;
}

function planAndConfig(args: ParsedAipigArgs, repoRoot: string) {
  const env = { ...process.env };
  if (args.config) env.AIPIG_CONFIG = resolve(args.config);
  const config = loadAipigConfig({ env });
  if (!config.cliproxy.cpaRoot) throw new Error("cliproxy.cpaRoot is required. Set it in aipig.jsonc or AIPIG_CLIPROXY_CPA_ROOT.");
  return {
    config,
    plan: createCliProxyInstallPlan({
      cpaRoot: config.cliproxy.cpaRoot,
      repoRoot,
      platform: process.platform,
      pluginName: config.cliproxy.pluginName,
    }),
  };
}

function ok(stdout: string): AipigCliResult {
  return { status: 0, stdout, stderr: "" };
}

function fail(stderr: string): AipigCliResult {
  return { status: 1, stdout: "", stderr };
}
