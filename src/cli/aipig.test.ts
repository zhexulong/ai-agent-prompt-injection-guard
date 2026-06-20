import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { parseAipigArgs, runAipigCli } from "./aipig";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(name: string): string {
  const root = join("/tmp", `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  roots.push(root);
  return root;
}

function seedCpa(root: string) {
  const cpaRoot = join(root, "cliproxyapi");
  mkdirSync(cpaRoot, { recursive: true });
  writeFileSync(join(cpaRoot, "cli-proxy-api"), "");
  writeFileSync(join(cpaRoot, "config.yaml"), "port: 8317\nplugins:\n  enabled: true\n  configs:\n    other:\n      enabled: true\n");
  return cpaRoot;
}

test("parseAipigArgs supports top-level and cliproxy subcommands", () => {
  expect(parseAipigArgs(["init", "--config", "x.jsonc"]).command).toBe("init");
  expect(parseAipigArgs(["cliproxy", "install", "--write"]).cliproxyCommand).toBe("install");
  expect(parseAipigArgs(["cliproxy", "restore", "--backup", "b.yaml"]).backup).toBe("b.yaml");
});

test("init creates an editable config without overwriting by default", async () => {
  const root = tempRoot("aipig-cli-init");
  const configPath = join(root, ".opencode", "aipig.jsonc");

  const first = await runAipigCli(["init", "--config", configPath], { cwd: root });
  const second = await runAipigCli(["init", "--config", configPath], { cwd: root });

  expect(first.status).toBe(0);
  expect(second.status).toBe(1);
  expect(readFileSync(configPath, "utf8")).toContain("cliproxy");
});

test("cliproxy install writes backup and waits for hot reload without restarting", async () => {
  const root = tempRoot("aipig-cli-install");
  const cpaRoot = seedCpa(root);
  const configPath = join(root, "aipig.jsonc");
  const artifact = join(root, "dist", "cliproxy-aipig.so");
  const entry = join(root, "dist", "src", "adapters", "proxy", "cliproxy-entry.js");
  mkdirSync(join(root, "dist"), { recursive: true });
  mkdirSync(join(root, "dist", "src", "adapters", "proxy"), { recursive: true });
  writeFileSync(artifact, "plugin");
  writeFileSync(entry, "entry");
  writeFileSync(configPath, JSON.stringify({ cliproxy: { cpaRoot, port: 8317, pluginName: "cliproxy-aipig" } }));

  const result = await runAipigCli(["cliproxy", "install", "--config", configPath, "--write"], {
    cwd: root,
    repoRoot: root,
    fetchImpl: (async (url: string | URL | Request) => String(url).endsWith("/healthz") ? Response.json({ ok: true }) : Response.json({ data: [] })) as unknown as typeof fetch,
  });

  const yaml = YAML.parse(readFileSync(join(cpaRoot, "config.yaml"), "utf8"));
  expect(result.status).toBe(0);
  expect(yaml.plugins.configs["cliproxy-aipig"].enabled).toBe(true);
  expect(existsSync(join(cpaRoot, "plugins", "cliproxy-aipig.so"))).toBe(true);
  expect(existsSync(join(cpaRoot, "plugins", "cliproxy-aipig-entry.js"))).toBe(true);
  const runtimeConfig = readFileSync(join(cpaRoot, ".opencode", "aipig.jsonc"), "utf8");
  expect(runtimeConfig).toContain(join(root, "fingerprints.json"));
  expect(runtimeConfig).toContain(join(root, "alerts.jsonl"));
  expect(result.stdout).toContain("hotReload");
  expect(result.stdout).not.toContain("restart");
});

test("cliproxy doctor prints human-readable checks by default", async () => {
  const root = tempRoot("aipig-cli-doctor");
  const cpaRoot = seedCpa(root);
  const configPath = join(root, "aipig.jsonc");
  mkdirSync(join(root, "dist", "src", "adapters", "proxy"), { recursive: true });
  writeFileSync(join(root, "dist", "cliproxy-aipig.so"), "plugin");
  writeFileSync(join(root, "dist", "src", "adapters", "proxy", "cliproxy-entry.js"), "entry");
  writeFileSync(configPath, JSON.stringify({ cliproxy: { cpaRoot, port: 8317, pluginName: "cliproxy-aipig" } }));

  const result = await runAipigCli(["cliproxy", "doctor", "--config", configPath], { cwd: root, repoRoot: root });

  expect(result.status).toBe(0);
  expect(result.stdout).toContain("CLIProxyAPI doctor");
  expect(result.stdout).toContain("[OK] CLIProxyAPI config");
  expect(result.stdout).toContain("[WARN] Plugin installed");
  expect(result.stdout).toContain("Next: aipig cliproxy install --config");
  expect(() => JSON.parse(result.stdout)).toThrow();
});

test("cliproxy doctor keeps machine-readable JSON with --json", async () => {
  const root = tempRoot("aipig-cli-doctor-json");
  const cpaRoot = seedCpa(root);
  const configPath = join(root, "aipig.jsonc");
  mkdirSync(join(root, "dist", "src", "adapters", "proxy"), { recursive: true });
  writeFileSync(join(root, "dist", "cliproxy-aipig.so"), "plugin");
  writeFileSync(join(root, "dist", "src", "adapters", "proxy", "cliproxy-entry.js"), "entry");
  writeFileSync(configPath, JSON.stringify({ cliproxy: { cpaRoot, port: 8317, pluginName: "cliproxy-aipig" } }));

  const result = await runAipigCli(["cliproxy", "doctor", "--config", configPath, "--json"], { cwd: root, repoRoot: root });
  const payload = JSON.parse(result.stdout);

  expect(result.status).toBe(0);
  expect(payload.entryArtifact).toBe(join(root, "dist", "src", "adapters", "proxy", "cliproxy-entry.js"));
  expect(payload.entryTarget).toBe(join(cpaRoot, "plugins", "cliproxy-aipig-entry.js"));
  expect(payload.checks.pluginTargetExists).toBe(false);
  expect(payload.checks.entryTargetExists).toBe(false);
});

test("cliproxy install explains how to recover when plugin artifacts are missing", async () => {
  const root = tempRoot("aipig-cli-install-missing-artifact");
  const cpaRoot = seedCpa(root);
  const configPath = join(root, "aipig.jsonc");
  writeFileSync(configPath, JSON.stringify({ cliproxy: { cpaRoot, port: 8317, pluginName: "cliproxy-aipig" } }));

  const result = await runAipigCli(["cliproxy", "install", "--config", configPath, "--write"], {
    cwd: root,
    repoRoot: root,
  });

  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Missing CLIProxyAPI plugin artifact");
  expect(result.stderr).toContain("aipig build-plugin");
  expect(readFileSync(join(cpaRoot, "config.yaml"), "utf8")).not.toContain("cliproxy-aipig");
});

test("cliproxy uninstall removes only AIPIG and restore copies the backup back", async () => {
  const root = tempRoot("aipig-cli-uninstall");
  const cpaRoot = seedCpa(root);
  const configPath = join(root, "aipig.jsonc");
  const backupPath = join(root, "backup.yaml");
  writeFileSync(configPath, JSON.stringify({ cliproxy: { cpaRoot, port: 8317, pluginName: "cliproxy-aipig" } }));
  writeFileSync(join(cpaRoot, "config.yaml"), "plugins:\n  configs:\n    other:\n      enabled: true\n    cliproxy-aipig:\n      enabled: true\n");
  writeFileSync(backupPath, "port: 8317\n");

  const uninstall = await runAipigCli(["cliproxy", "uninstall", "--config", configPath, "--write"], { cwd: root, repoRoot: root });
  const restore = await runAipigCli(["cliproxy", "restore", "--config", configPath, "--backup", backupPath, "--write"], { cwd: root, repoRoot: root });

  expect(uninstall.status).toBe(0);
  expect(restore.status).toBe(0);
  expect(readFileSync(join(cpaRoot, "config.yaml"), "utf8")).toBe("port: 8317\n");
});
