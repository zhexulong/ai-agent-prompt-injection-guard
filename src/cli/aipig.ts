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

    if (args.command === "init") return initConfig(args, cwd, repoRoot);
    if (args.command === "doctor") return cliproxyDoctor(args, repoRoot);
    if (args.command === "build-plugin") return buildPlugin(deps);
    if (args.command === "cliproxy") return await cliproxy(args, repoRoot, cwd, deps.fetchImpl);
    return fail(`usage: aipig <init|doctor|build-plugin|cliproxy>`);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

function initConfig(args: ParsedAipigArgs, cwd: string, repoRoot: string): AipigCliResult {
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
  ensureDefaultFingerprints(cwd, repoRoot);
  return ok(`created ${configPath}\n`);
}

function ensureDefaultFingerprints(cwd: string, repoRoot: string): void {
  const target = resolve(cwd, "fingerprints.json");
  if (existsSync(target)) return;
  const source = join(repoRoot, "fingerprints.json");
  const fallback = JSON.stringify({ positives: [], negatives: [] }, null, 2);
  writeFileSync(target, existsSync(source) ? readFileSync(source, "utf8") : `${fallback}\n`);
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
  const result = createCliProxyDoctorResult(plan);
  const prerequisitesReady = result.checks.cpaRootExists
    && result.checks.cpaBinExists
    && result.checks.cpaConfigExists
    && result.checks.pluginArtifactExists
    && result.checks.entryArtifactExists
    && result.support.status === "supported";
  if (!args.json) {
    return {
      status: prerequisitesReady ? 0 : 1,
      stdout: formatCliProxyDoctor(result, args),
      stderr: "",
    };
  }
  return {
    status: prerequisitesReady ? 0 : 1,
    stdout: JSON.stringify(result, null, 2),
    stderr: "",
  };
}

function cliproxyDiff(args: ParsedAipigArgs, repoRoot: string): AipigCliResult {
  const { plan, config } = planAndConfig(args, repoRoot);
  const original = readCliProxyConfig(plan);
  const patched = patchCliProxyPluginConfig(original, {
    cpaRoot: plan.cpaRoot,
    pluginName: config.cliproxy.pluginName,
  });
  return ok(patched);
}

async function cliproxyInstall(args: ParsedAipigArgs, repoRoot: string, cwd: string, fetchImpl?: typeof fetch): Promise<AipigCliResult> {
  const { plan, config } = planAndConfig(args, repoRoot);
  if (args.write) assertInstallArtifactsExist(plan);
  const original = readCliProxyConfig(plan);
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
  const original = readCliProxyConfig(plan);
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

type CliProxyDoctorResult = ReturnType<typeof createCliProxyDoctorResult>;

function createCliProxyDoctorResult(plan: ReturnType<typeof planFromArgs>) {
  const cpaVersion = readCliProxyVersion(plan.cpaRoot);
  return {
    cpaRoot: plan.cpaRoot,
    cpaVersion,
    support: assessCliProxySupport(cpaVersion),
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
}

function formatCliProxyDoctor(result: CliProxyDoctorResult, args: ParsedAipigArgs): string {
  const lines = [
    "CLIProxyAPI doctor",
    formatCheck(result.checks.cpaRootExists, "CLIProxyAPI root", result.cpaRoot),
    formatVersionCheck(result),
    formatCheck(result.checks.cpaBinExists, "CLIProxyAPI binary", result.cpaBin),
    formatCheck(result.checks.cpaConfigExists, "CLIProxyAPI config", result.cpaConfig),
    formatCheck(result.checks.pluginArtifactExists, "Native plugin artifact", result.pluginArtifact),
    formatCheck(result.checks.entryArtifactExists, "JS entry artifact", result.entryArtifact),
    formatCheck(result.checks.pluginTargetExists, "Plugin installed", result.pluginTarget, "WARN"),
    formatCheck(result.checks.entryTargetExists, "JS entry installed", result.entryTarget, "WARN"),
    "",
  ];
  if (!result.checks.pluginArtifactExists || !result.checks.entryArtifactExists) {
    lines.push("Next: aipig build-plugin");
  } else if (!result.checks.pluginTargetExists || !result.checks.entryTargetExists) {
    lines.push(`Next: aipig cliproxy install${args.config ? ` --config ${args.config}` : ""} --write`);
  } else {
    lines.push("Next: CLIProxyAPI is ready to load AIPIG through hot reload.");
  }
  return `${lines.join("\n")}\n`;
}

function formatVersionCheck(result: CliProxyDoctorResult): string {
  const version = result.cpaVersion ?? "unknown";
  const suffix = result.support.status === "supported"
    ? `(supported; minimum ${result.support.minimumVersion}; verified ${result.support.verifiedVersion})`
    : result.support.reason;
  return `[${result.support.status === "supported" ? "OK" : "FAIL"}] CLIProxyAPI version: ${version} ${suffix}`;
}

function formatCheck(ok: boolean, label: string, path: string, missingLevel: "FAIL" | "WARN" = "FAIL"): string {
  return `[${ok ? "OK" : missingLevel}] ${label}: ${path}`;
}

function readCliProxyConfig(plan: ReturnType<typeof planFromArgs>): string {
  if (!existsSync(plan.cpaConfig)) {
    throw new Error(`CLIProxyAPI config not found: ${plan.cpaConfig}. Check cliproxy.cpaRoot or AIPIG_CLIPROXY_CPA_ROOT.`);
  }
  return readFileSync(plan.cpaConfig, "utf8");
}

function readCliProxyVersion(cpaRoot: string): string | undefined {
  const versionPath = join(cpaRoot, "version.txt");
  if (!existsSync(versionPath)) return undefined;
  const version = readFileSync(versionPath, "utf8").trim();
  return version || undefined;
}

function assessCliProxySupport(version: string | undefined) {
  const minimumVersion = "7.0.0";
  const verifiedVersion = "7.2.22";
  if (!version) {
    return {
      status: "unknown" as const,
      minimumVersion,
      verifiedVersion,
      reason: `AIPIG proxy mode requires CLIProxyAPI ${minimumVersion} or newer with plugin request/response interceptors.`,
    };
  }
  const major = Number(version.split(".")[0]);
  if (!Number.isInteger(major) || major < 7) {
    return {
      status: "unsupported" as const,
      minimumVersion,
      verifiedVersion,
      reason: `AIPIG proxy mode requires CLIProxyAPI ${minimumVersion} or newer with plugin request/response interceptors.`,
    };
  }
  return {
    status: "supported" as const,
    minimumVersion,
    verifiedVersion,
    reason: "",
  };
}

function assertInstallArtifactsExist(plan: ReturnType<typeof planFromArgs>): void {
  const missing: string[] = [];
  if (!existsSync(plan.pluginArtifact)) missing.push(`Missing CLIProxyAPI plugin artifact: ${plan.pluginArtifact}`);
  if (!existsSync(plan.entryArtifact)) missing.push(`Missing CLIProxyAPI JS entry artifact: ${plan.entryArtifact}`);
  if (missing.length === 0) return;
  throw new Error(`${missing.join("\n")}\nRun \`aipig build-plugin\` and retry the install.`);
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
