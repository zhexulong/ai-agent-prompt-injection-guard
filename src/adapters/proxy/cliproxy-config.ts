import { join } from "node:path";
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
  let text = original;

  if (!containsYamlScalar(text, options.openaiClientKey)) {
    text = insertIntoTopLevelList(text, "api-keys", `  - ${yamlQuote(options.openaiClientKey)}`);
  }
  if (!containsYamlScalar(text, options.claudeClientKey)) {
    text = insertIntoTopLevelList(text, "api-keys", `  - ${yamlQuote(options.claudeClientKey)}`);
  }

  const openaiBlock = [
    `  - name: ${yamlQuote("aipig-eval-upstream")}`,
    `    base-url: ${yamlQuote(`http://127.0.0.1:${options.upstreamPort}/v1`)}`,
    "    api-key-entries:",
    `      - api-key: ${yamlQuote(options.upstreamApiKey ?? "aipig-eval-upstream-key")}`,
    "    models:",
    `      - name: ${yamlQuote(options.openaiModel)}`,
    `        alias: ${yamlQuote(options.openaiModel)}`,
  ].join("\n");
  if (!text.includes("name: \"aipig-eval-upstream\"") && !text.includes("name: aipig-eval-upstream")) {
    text = insertIntoTopLevelList(text, "openai-compatibility", openaiBlock);
  }

  const claudeBlock = [
    `  - api-key: ${yamlQuote(options.claudeClientKey)}`,
    "    priority: 100",
    `    base-url: ${yamlQuote(`http://127.0.0.1:${options.upstreamPort}`)}`,
    `    proxy-url: ${yamlQuote("")}`,
    "    models: []",
  ].join("\n");
  if (!text.includes(`api-key: "${options.claudeClientKey}"`) && !text.includes(`api-key: ${options.claudeClientKey}`)) {
    text = insertIntoTopLevelList(text, "claude-api-key", claudeBlock);
  }

  return ensurePluginConfig(text, options);
}

export function patchCliProxyPluginConfig(
  original: string,
  options: Pick<CliProxyPatchOptions, "cpaRoot" | "pluginName">,
): string {
  return ensurePluginConfig(original, {
    ...options,
    cpaPort: 8317,
    upstreamPort: 0,
    openaiClientKey: "",
    claudeClientKey: "",
    openaiModel: "",
  });
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

function insertIntoTopLevelList(text: string, key: string, block: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim() === `${key}:`);
  if (start < 0) throw new Error(`missing top-level ${key}: section`);

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^[A-Za-z0-9_-][A-Za-z0-9_-]*:/.test(lines[i])) {
      end = i;
      break;
    }
  }
  lines.splice(end, 0, ...block.split("\n"));
  return lines.join("\n");
}

function ensurePluginConfig(text: string, options: CliProxyPatchOptions): string {
  const pluginDir = join(options.cpaRoot, "plugins").replaceAll("\\", "/");
  const pluginBlock = [
    "plugins:",
    "  enabled: true",
    `  dir: ${yamlQuote(pluginDir)}`,
    "  configs:",
    `    ${options.pluginName}:`,
    "      enabled: true",
    "      priority: 1",
  ].join("\n");

  if (!/^plugins:\s*$/m.test(text)) {
    return `${text.replace(/\s*$/, "")}\n${pluginBlock}\n`;
  }
  if (text.includes(`${options.pluginName}:`)) return text;

  const lines = text.split("\n");
  const pluginsStart = lines.findIndex((line) => line.trim() === "plugins:");
  const pluginsEnd = findSectionEnd(lines, pluginsStart);
  const configsIndex = findNestedKey(lines, pluginsStart, pluginsEnd, 2, "configs");

  if (configsIndex >= 0) {
    lines.splice(configsIndex + 1, 0, `    ${options.pluginName}:`, "      enabled: true", "      priority: 1");
    return lines.join("\n");
  }

  lines.splice(pluginsEnd, 0, "  configs:", `    ${options.pluginName}:`, "      enabled: true", "      priority: 1");
  if (!lines.slice(pluginsStart, pluginsEnd).some((line) => line.trim().startsWith("dir:"))) {
    lines.splice(pluginsStart + 1, 0, `  dir: ${yamlQuote(pluginDir)}`);
  }
  if (!lines.slice(pluginsStart, pluginsEnd).some((line) => line.trim().startsWith("enabled:"))) {
    lines.splice(pluginsStart + 1, 0, "  enabled: true");
  }
  return lines.join("\n");
}

function findSectionEnd(lines: string[], start: number): number {
  for (let i = start + 1; i < lines.length; i++) {
    if (/^[A-Za-z0-9_-][A-Za-z0-9_-]*:/.test(lines[i])) return i;
  }
  return lines.length;
}

function findNestedKey(lines: string[], start: number, end: number, spaces: number, key: string): number {
  const prefix = " ".repeat(spaces);
  for (let i = start + 1; i < end; i++) {
    if (lines[i].startsWith(prefix) && lines[i].trim() === `${key}:`) return i;
  }
  return -1;
}

function containsYamlScalar(text: string, value: string): boolean {
  return text.includes(yamlQuote(value)) || new RegExp(`(^|\\s)${escapeRegExp(value)}($|\\s)`).test(text);
}

function yamlQuote(value: string): string {
  return JSON.stringify(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
