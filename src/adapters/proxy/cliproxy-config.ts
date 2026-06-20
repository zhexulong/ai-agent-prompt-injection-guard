import { join } from "node:path";
import YAML from "yaml";
import type { GuardConfig } from "../../config";

export interface CliProxyPatchOptions {
  cpaRoot: string;
  cpaPort: number;
  upstreamPort: number;
  pluginName: string;
  openaiClientKey: string;
  claudeClientKey: string;
  upstreamApiKey?: string;
  openaiModel: string;
}

export interface CliProxyRuntimeEnvOptions {
  guard: GuardConfig;
  repoRoot: string;
  entryPath: string;
  bunPath?: string;
}

export interface CliProxyInstallPlanOptions {
  cpaRoot: string;
  repoRoot: string;
  platform?: NodeJS.Platform;
  pluginName: string;
}

export interface CliProxyInstallPlan {
  cpaRoot: string;
  cpaBin: string;
  cpaConfig: string;
  pluginsDir: string;
  pluginArtifact: string;
  pluginTarget: string;
}

export function createCliProxyInstallPlan(options: CliProxyInstallPlanOptions): CliProxyInstallPlan {
  const platform = options.platform ?? process.platform;
  const artifactName = cliproxyPluginArtifactName(platform, options.pluginName);
  const pluginsDir = join(options.cpaRoot, "plugins");
  return {
    cpaRoot: options.cpaRoot,
    cpaBin: join(options.cpaRoot, cliProxyExecutableName(platform)),
    cpaConfig: join(options.cpaRoot, "config.yaml"),
    pluginsDir,
    pluginArtifact: join(options.repoRoot, "dist", artifactName),
    pluginTarget: join(pluginsDir, artifactName),
  };
}

export function cliProxyExecutableName(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "cli-proxy-api.exe" : "cli-proxy-api";
}

export function cliproxyPluginArtifactName(
  platform: NodeJS.Platform = process.platform,
  pluginName = "cliproxy-aipig",
): string {
  if (platform === "win32") return `${pluginName}.dll`;
  if (platform === "darwin") return `${pluginName}.dylib`;
  return `${pluginName}.so`;
}

export function patchCliProxyConfig(original: string, options: CliProxyPatchOptions): string {
  const config = parseYamlConfig(original);
  const apiKeys = arrayAt(config, "api-keys");
  pushUniqueScalar(apiKeys, options.openaiClientKey);
  pushUniqueScalar(apiKeys, options.claudeClientKey);

  const openaiCompatibility = arrayAt(config, "openai-compatibility");
  pushUniqueBy(openaiCompatibility, "name", "aipig-eval-upstream", {
    name: "aipig-eval-upstream",
    "base-url": `http://127.0.0.1:${options.upstreamPort}/v1`,
    "api-key-entries": [{ "api-key": options.upstreamApiKey ?? "aipig-eval-upstream-key" }],
    models: [{ name: options.openaiModel, alias: options.openaiModel }],
  });

  const claudeKeys = arrayAt(config, "claude-api-key");
  pushUniqueBy(claudeKeys, "api-key", options.claudeClientKey, {
    "api-key": options.claudeClientKey,
    priority: 100,
    "base-url": `http://127.0.0.1:${options.upstreamPort}`,
    "proxy-url": "",
    models: [],
  });

  ensurePluginConfig(config, options);
  return stringifyYamlConfig(config);
}

export function patchCliProxyPluginConfig(
  original: string,
  options: Pick<CliProxyPatchOptions, "cpaRoot" | "pluginName">,
): string {
  const config = parseYamlConfig(original);
  ensurePluginConfig(config, {
    ...options,
    cpaPort: 8317,
    upstreamPort: 0,
    openaiClientKey: "",
    claudeClientKey: "",
    openaiModel: "",
  });
  return stringifyYamlConfig(config);
}

export function buildCliProxyRuntimeEnv(options: CliProxyRuntimeEnvOptions): Record<string, string> {
  return {
    ...(options.bunPath ? { AIPIG_CLIPROXY_BUN: options.bunPath } : {}),
    AIPIG_CLIPROXY_WORKDIR: options.repoRoot,
    AIPIG_CLIPROXY_ENTRY: options.entryPath,
    AIPIG_FINGERPRINTS_PATH: options.guard.fingerprintsPath,
    AIPIG_ALERTS_PATH: options.guard.alertsPath,
    AIPIG_PENDING_SUGGESTIONS_PATH: options.guard.pendingSuggestionsPath,
    AIPIG_NOTIFY_LEVEL: options.guard.notifyLevel,
    AIPIG_ALERT_LIMIT: String(options.guard.alertLimit),
    ...(options.guard.judge
      ? {
          AIPIG_JUDGE_BASE_URL: options.guard.judge.baseUrl,
          AIPIG_JUDGE_API_KEY: options.guard.judge.apiKey,
          AIPIG_JUDGE_MODEL: options.guard.judge.model,
        }
      : {}),
  };
}

function ensurePluginConfig(config: Record<string, any>, options: CliProxyPatchOptions): void {
  const pluginDir = join(options.cpaRoot, "plugins").replaceAll("\\", "/");
  const plugins = objectAt(config, "plugins");
  if (plugins.enabled === undefined) plugins.enabled = true;
  if (plugins.dir === undefined) plugins.dir = pluginDir;
  const pluginConfigs = objectAt(plugins, "configs");
  pluginConfigs[options.pluginName] = {
    enabled: true,
    priority: 1,
    ...(isPlainObject(pluginConfigs[options.pluginName]) ? pluginConfigs[options.pluginName] : {}),
  };
}

function parseYamlConfig(text: string): Record<string, any> {
  const parsed = YAML.parse(text || "{}");
  if (parsed === null || parsed === undefined) return {};
  if (!isPlainObject(parsed)) throw new Error("CLIProxyAPI config root must be a YAML mapping");
  return parsed;
}

function stringifyYamlConfig(config: Record<string, any>): string {
  return YAML.stringify(config, { lineWidth: 0 });
}

function arrayAt(config: Record<string, any>, key: string): any[] {
  if (!Array.isArray(config[key])) config[key] = [];
  return config[key];
}

function objectAt(config: Record<string, any>, key: string): Record<string, any> {
  if (!isPlainObject(config[key])) config[key] = {};
  return config[key];
}

function pushUniqueScalar(items: any[], value: string): void {
  if (!items.includes(value)) items.push(value);
}

function pushUniqueBy(items: any[], key: string, value: string, item: Record<string, any>): void {
  if (!items.some((existing) => isPlainObject(existing) && existing[key] === value)) items.push(item);
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
