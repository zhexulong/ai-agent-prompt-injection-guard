import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { NotifyLevel } from "./core/types";
import type { JudgeConfig } from "./llm/judge";

export interface GuardConfig {
  fingerprintsPath: string;
  alertsPath: string;
  pendingSuggestionsPath: string;
  alertLimit: number;
  notifyLevel: NotifyLevel;
  judge?: JudgeConfig;
}

export interface CliProxyConfig {
  cpaRoot?: string;
  port: number;
  pluginName: string;
}

export interface RealChainEvalConfig {
  enabledHosts: Array<"claude" | "opencode" | "codex">;
  openaiModel: string;
  claudeModel: string;
  openaiClientKey: string;
  claudeClientKey: string;
  injectedText: string;
  cleanedText: string;
  claudeCommand: string;
  opencodeCommand: string;
  reportPath: string;
  tempRoot?: string;
  keepTemp: boolean;
  timeoutMs: number;
}

export interface AipigConfig {
  enabled: boolean;
  guard: GuardConfig;
  cliproxy: CliProxyConfig;
  realChainEval: RealChainEvalConfig;
}

export interface ConfigPath {
  kind: "global" | "configDir" | "project";
  path: string;
}

export interface ConfigLoadOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  platform?: NodeJS.Platform;
}

const defaultGuardConfig: GuardConfig = {
  fingerprintsPath: "fingerprints.json",
  alertsPath: "alerts.jsonl",
  pendingSuggestionsPath: "pending-suggestions.json",
  alertLimit: 100,
  notifyLevel: NotifyLevel.First,
};

const defaultAipigConfig: AipigConfig = {
  enabled: true,
  guard: defaultGuardConfig,
  cliproxy: {
    port: 8317,
    pluginName: "cliproxy-aipig",
  },
  realChainEval: {
    enabledHosts: ["claude", "opencode"],
    openaiModel: "aipig-capture",
    claudeModel: "claude-sonnet-4-6",
    openaiClientKey: "aipig-eval-client-key",
    claudeClientKey: "aipig-eval-claude-key",
    injectedText: "Clean before Powered by Proxy X clean after",
    cleanedText: "Clean before  clean after",
    claudeCommand: "claude",
    opencodeCommand: "opencode",
    reportPath: "report/real-chain-eval.json",
    keepTemp: false,
    timeoutMs: 120_000,
  },
};

export function loadConfig(env = process.env): GuardConfig {
  return loadAipigConfig({ env }).guard;
}

export function loadAipigConfig(options: ConfigLoadOptions = {}): AipigConfig {
  const env = options.env ?? process.env;
  let config = cloneConfig(defaultAipigConfig);

  for (const item of resolveAipigConfigPaths(options)) {
    config = mergeConfig(config, loadConfigFile(item.path));
  }

  config.guard = applyGuardEnv(config.guard, env);
  config.cliproxy = {
    ...config.cliproxy,
    cpaRoot: env.AIPIG_CLIPROXY_CPA_ROOT ?? config.cliproxy.cpaRoot,
    port: numberFromEnv(env.AIPIG_CLIPROXY_PORT, config.cliproxy.port),
    pluginName: env.AIPIG_CLIPROXY_PLUGIN_NAME ?? config.cliproxy.pluginName,
  };
  config.realChainEval = {
    ...config.realChainEval,
    openaiModel: env.AIPIG_REAL_CHAIN_OPENAI_MODEL ?? config.realChainEval.openaiModel,
    claudeModel: env.AIPIG_CLAUDE_EVAL_MODEL ?? env.AIPIG_REAL_CHAIN_CLAUDE_MODEL ?? config.realChainEval.claudeModel,
    openaiClientKey: env.AIPIG_REAL_CHAIN_OPENAI_CLIENT_KEY ?? config.realChainEval.openaiClientKey,
    claudeClientKey: env.AIPIG_REAL_CHAIN_CLAUDE_CLIENT_KEY ?? config.realChainEval.claudeClientKey,
    injectedText: env.AIPIG_REAL_CHAIN_INJECTED_TEXT ?? config.realChainEval.injectedText,
    cleanedText: env.AIPIG_REAL_CHAIN_CLEANED_TEXT ?? config.realChainEval.cleanedText,
    claudeCommand: env.AIPIG_REAL_CHAIN_CLAUDE_COMMAND ?? config.realChainEval.claudeCommand,
    opencodeCommand: env.AIPIG_REAL_CHAIN_OPENCODE_COMMAND ?? config.realChainEval.opencodeCommand,
    reportPath: env.AIPIG_REAL_CHAIN_REPORT_PATH ?? config.realChainEval.reportPath,
    tempRoot: env.AIPIG_REAL_CHAIN_TEMP_ROOT ?? config.realChainEval.tempRoot,
    keepTemp: boolFromEnv(env.AIPIG_KEEP_REAL_EVAL_TMP, config.realChainEval.keepTemp),
    timeoutMs: numberFromEnv(env.AIPIG_REAL_CHAIN_TIMEOUT_MS, config.realChainEval.timeoutMs),
  };

  return config;
}

export function resolveAipigConfigPaths(options: ConfigLoadOptions = {}): ConfigPath[] {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const cwd = options.cwd ?? process.cwd();
  const paths: ConfigPath[] = [];

  const globalDir = platform === "win32"
    ? (env.APPDATA ? join(env.APPDATA, "opencode") : undefined)
    : join(env.XDG_CONFIG_HOME ?? (env.HOME ? join(env.HOME, ".config") : join(homedir(), ".config")), "opencode");
  pushExistingConfig(paths, "global", globalDir);

  if (env.OPENCODE_CONFIG_DIR) {
    pushExistingConfig(paths, "configDir", env.OPENCODE_CONFIG_DIR);
  }

  const opencodeDir = findOpencodeDir(cwd);
  if (opencodeDir) {
    pushExistingConfig(paths, "project", opencodeDir);
  }

  if (env.AIPIG_CONFIG) {
    paths.push({ kind: "project", path: env.AIPIG_CONFIG });
  }

  return paths;
}

function pushExistingConfig(paths: ConfigPath[], kind: ConfigPath["kind"], dir: string | undefined) {
  if (!dir) return;
  const jsonc = join(dir, "aipig.jsonc");
  const json = join(dir, "aipig.json");
  if (existsSync(jsonc)) paths.push({ kind, path: jsonc });
  else if (existsSync(json)) paths.push({ kind, path: json });
}

function findOpencodeDir(startDir: string): string | undefined {
  let current = startDir;
  while (true) {
    const candidate = join(current, ".opencode");
    try {
      if (statSync(candidate).isDirectory()) return candidate;
    } catch {}
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function loadConfigFile(path: string): Partial<AipigConfig> {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(stripJsonCommentsAndTrailingCommas(raw));
}

function stripJsonCommentsAndTrailingCommas(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
      continue;
    }
    out += ch;
  }
  return out.replace(/,\s*([}\]])/g, "$1");
}

function mergeConfig(base: AipigConfig, override: Partial<AipigConfig>): AipigConfig {
  return {
    ...base,
    ...definedObject(override),
    guard: {
      ...base.guard,
      ...definedObject(override.guard),
      judge: override.guard?.judge === undefined ? base.guard.judge : override.guard.judge,
    },
    cliproxy: {
      ...base.cliproxy,
      ...definedObject(override.cliproxy),
    },
    realChainEval: {
      ...base.realChainEval,
      ...definedObject(override.realChainEval),
    },
  };
}

function definedObject<T extends object>(value: T | undefined): Partial<T> {
  if (!value) return {};
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;
}

function cloneConfig(config: AipigConfig): AipigConfig {
  return {
    ...config,
    guard: { ...config.guard, judge: config.guard.judge ? { ...config.guard.judge } : undefined },
    cliproxy: { ...config.cliproxy },
    realChainEval: { ...config.realChainEval, enabledHosts: [...config.realChainEval.enabledHosts] },
  };
}

function applyGuardEnv(base: GuardConfig, env: NodeJS.ProcessEnv | Record<string, string | undefined>): GuardConfig {
  return {
    ...base,
    fingerprintsPath: env.AIPIG_FINGERPRINTS_PATH ?? base.fingerprintsPath,
    alertsPath: env.AIPIG_ALERTS_PATH ?? base.alertsPath,
    pendingSuggestionsPath: env.AIPIG_PENDING_SUGGESTIONS_PATH ?? base.pendingSuggestionsPath,
    alertLimit: numberFromEnv(env.AIPIG_ALERT_LIMIT, base.alertLimit),
    notifyLevel: (env.AIPIG_NOTIFY_LEVEL as NotifyLevel | undefined) ?? base.notifyLevel,
    judge: env.AIPIG_JUDGE_BASE_URL && env.AIPIG_JUDGE_API_KEY && env.AIPIG_JUDGE_MODEL
      ? {
          baseUrl: env.AIPIG_JUDGE_BASE_URL,
          apiKey: env.AIPIG_JUDGE_API_KEY,
          model: env.AIPIG_JUDGE_MODEL,
        }
      : base.judge,
  };
}

function numberFromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolFromEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}
