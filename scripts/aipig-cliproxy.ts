import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadAipigConfig } from "../src/config";
import {
  createCliProxyInstallPlan,
  patchCliProxyPluginConfig,
} from "../src/adapters/proxy/cliproxy-config";

function parseArgs(argv: string[]) {
  const out: { command?: string; config?: string; write: boolean; json: boolean } = {
    command: argv[0],
    write: false,
    json: false,
  };
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--config") out.config = argv[++i];
    else if (arg === "--write") out.write = true;
    else if (arg === "--json") out.json = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

function loadWithArgs(configPath?: string) {
  const env = { ...process.env };
  if (configPath) env.AIPIG_CONFIG = resolve(configPath);
  return loadAipigConfig({ env });
}

function requireCpaRoot(value: string | undefined): string {
  if (!value) {
    throw new Error("cliproxy.cpaRoot is required. Set it in aipig.jsonc or AIPIG_CLIPROXY_CPA_ROOT.");
  }
  return value;
}

function usage() {
  console.error("usage: bun run scripts/aipig-cliproxy.ts <doctor|install> [--config path] [--write] [--json]");
}

const args = parseArgs(Bun.argv.slice(2));
if (!args.command || !["doctor", "install"].includes(args.command)) {
  usage();
  process.exit(2);
}

try {
  const repoRoot = resolve(import.meta.dir, "..");
  const config = loadWithArgs(args.config);
  const plan = createCliProxyInstallPlan({
    cpaRoot: requireCpaRoot(config.cliproxy.cpaRoot),
    repoRoot,
    platform: process.platform,
    pluginName: config.cliproxy.pluginName,
  });

  if (args.command === "doctor") {
    const result = {
      cpaRoot: plan.cpaRoot,
      cpaBin: plan.cpaBin,
      cpaConfig: plan.cpaConfig,
      pluginArtifact: plan.pluginArtifact,
      pluginTarget: plan.pluginTarget,
      checks: {
        cpaRootExists: existsSync(plan.cpaRoot),
        cpaBinExists: existsSync(plan.cpaBin),
        cpaConfigExists: existsSync(plan.cpaConfig),
        pluginArtifactExists: existsSync(plan.pluginArtifact),
        pluginTargetExists: existsSync(plan.pluginTarget),
      },
    };
    console.log(JSON.stringify(result, null, 2));
    process.exit(Object.values(result.checks).every(Boolean) ? 0 : 1);
  }

  const original = readFileSync(plan.cpaConfig, "utf8");
  const patched = patchCliProxyPluginConfig(original, {
    cpaRoot: plan.cpaRoot,
    pluginName: config.cliproxy.pluginName,
  });

  if (!args.write) {
    console.log(patched);
    console.error("dry-run only. Re-run with --write to copy the plugin and update config.yaml.");
    process.exit(0);
  }

  mkdirSync(plan.pluginsDir, { recursive: true });
  copyFileSync(plan.pluginArtifact, plan.pluginTarget);
  const backup = `${plan.cpaConfig}.aipig-backup-${Date.now()}`;
  writeFileSync(backup, original, { mode: 0o600 });
  mkdirSync(dirname(plan.cpaConfig), { recursive: true });
  writeFileSync(plan.cpaConfig, patched, { mode: 0o600 });
  const result = { backup, pluginTarget: plan.pluginTarget, cpaConfig: plan.cpaConfig };
  console.log(args.json ? JSON.stringify(result, null, 2) : `installed ${plan.pluginTarget}\nbackup ${backup}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
