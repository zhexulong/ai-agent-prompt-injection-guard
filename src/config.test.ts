import { afterEach, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadAipigConfig, loadConfig, resolveAipigConfigPaths } from "./config";
import { NotifyLevel } from "./core/types";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function tempRoot(name: string): string {
  const root = join("/tmp", `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  tempRoots.push(root);
  return root;
}

test("loadConfig uses safe local defaults", () => {
  const config = loadConfig({});
  expect(config.fingerprintsPath).toBe("fingerprints.json");
  expect(config.alertsPath).toBe("alerts.jsonl");
  expect(config.pendingSuggestionsPath).toBe("pending-suggestions.json");
  expect(config.alertLimit).toBe(100);
  expect(config.notifyLevel).toBe(NotifyLevel.First);
  expect(config.judge).toBeUndefined();
});

test("loadConfig enables Tier 1 only when all judge env vars exist", () => {
  const partial = loadConfig({ AIPIG_JUDGE_BASE_URL: "https://example.invalid" });
  expect(partial.judge).toBeUndefined();

  const full = loadConfig({
    AIPIG_JUDGE_BASE_URL: "https://example.invalid",
    AIPIG_JUDGE_API_KEY: "k",
    AIPIG_JUDGE_MODEL: "m",
    AIPIG_NOTIFY_LEVEL: "always",
    AIPIG_ALERT_LIMIT: "7",
  });
  expect(full.judge?.model).toBe("m");
  expect(full.notifyLevel).toBe(NotifyLevel.Always);
  expect(full.alertLimit).toBe(7);
});

test("resolveAipigConfigPaths follows dcp-style global, config-dir, then project order", () => {
  const root = tempRoot("aipig-config-paths");
  const home = join(root, "home");
  const configDir = join(root, "custom-config");
  const project = join(root, "project", "nested");
  const projectOpencode = join(root, "project", ".opencode");
  mkdirSync(join(home, ".config", "opencode"), { recursive: true });
  mkdirSync(configDir, { recursive: true });
  mkdirSync(projectOpencode, { recursive: true });
  writeFileSync(join(home, ".config", "opencode", "aipig.jsonc"), "{}");
  writeFileSync(join(configDir, "aipig.json"), "{}");
  writeFileSync(join(projectOpencode, "aipig.jsonc"), "{}");

  const paths = resolveAipigConfigPaths({
    cwd: project,
    env: { HOME: home, OPENCODE_CONFIG_DIR: configDir },
    platform: "linux",
  });

  expect(paths.map((item) => item.kind)).toEqual(["global", "configDir", "project"]);
  expect(paths[0].path).toBe(join(home, ".config", "opencode", "aipig.jsonc"));
  expect(paths[1].path).toBe(join(configDir, "aipig.json"));
  expect(paths[2].path).toBe(join(projectOpencode, "aipig.jsonc"));
});

test("resolveAipigConfigPaths uses APPDATA on Windows", () => {
  const root = tempRoot("aipig-config-windows");
  const appdata = join(root, "AppData", "Roaming");
  mkdirSync(join(appdata, "opencode"), { recursive: true });
  writeFileSync(join(appdata, "opencode", "aipig.jsonc"), "{}");

  const paths = resolveAipigConfigPaths({
    cwd: root,
    env: { APPDATA: appdata },
    platform: "win32",
  });

  expect(paths).toEqual([{ kind: "global", path: join(appdata, "opencode", "aipig.jsonc") }]);
});

test("loadAipigConfig merges config layers and lets env override guard values", () => {
  const root = tempRoot("aipig-config-merge");
  const home = join(root, "home");
  const configDir = join(root, "custom-config");
  const project = join(root, "project");
  mkdirSync(join(home, ".config", "opencode"), { recursive: true });
  mkdirSync(configDir, { recursive: true });
  mkdirSync(join(project, ".opencode"), { recursive: true });
  writeFileSync(join(home, ".config", "opencode", "aipig.jsonc"), `{
    // jsonc comment is allowed
    "guard": {
      "alertsPath": "global-alerts.jsonl",
      "notifyLevel": "never",
    },
    "cliproxy": { "port": 8317 }
  }`);
  writeFileSync(join(configDir, "aipig.json"), JSON.stringify({
    guard: { pendingSuggestionsPath: "custom-pending.json" },
    cliproxy: { cpaRoot: "/opt/cliproxyapi" },
  }));
  writeFileSync(join(project, ".opencode", "aipig.jsonc"), JSON.stringify({
    guard: { notifyLevel: "always" },
    realChainEval: { enabledHosts: ["opencode"] },
  }));

  const config = loadAipigConfig({
    cwd: project,
    env: {
      HOME: home,
      OPENCODE_CONFIG_DIR: configDir,
      AIPIG_ALERTS_PATH: "env-alerts.jsonl",
    },
    platform: "linux",
  });

  expect(config.guard.alertsPath).toBe("env-alerts.jsonl");
  expect(config.guard.pendingSuggestionsPath).toBe("custom-pending.json");
  expect(config.guard.notifyLevel).toBe(NotifyLevel.Always);
  expect(config.cliproxy.port).toBe(8317);
  expect(config.cliproxy.cpaRoot).toBe("/opt/cliproxyapi");
  expect(config.realChainEval.enabledHosts).toEqual(["opencode"]);
});

test("AIPIG_CONFIG explicit file overrides discovered aipig config files", () => {
  const root = tempRoot("aipig-config-explicit");
  const home = join(root, "home");
  const explicit = join(root, "explicit.jsonc");
  mkdirSync(join(home, ".config", "opencode"), { recursive: true });
  writeFileSync(join(home, ".config", "opencode", "aipig.json"), JSON.stringify({
    guard: { alertsPath: "global-alerts.jsonl" },
  }));
  writeFileSync(explicit, JSON.stringify({
    guard: { alertsPath: "explicit-alerts.jsonl" },
    cliproxy: { cpaRoot: "C:\\cliproxyapi" },
  }));

  const config = loadAipigConfig({
    cwd: root,
    env: { HOME: home, AIPIG_CONFIG: explicit },
    platform: "win32",
  });

  expect(config.guard.alertsPath).toBe("explicit-alerts.jsonl");
  expect(config.cliproxy.cpaRoot).toBe("C:\\cliproxyapi");
});
