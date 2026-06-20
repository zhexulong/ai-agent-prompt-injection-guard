import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { cliproxyPluginArtifactName } from "./cliproxy-config";

export interface BuildCliProxyNativePluginOptions {
  repoRoot: string;
  platform: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  spawn?: (command: string, args: string[], options: { env: Record<string, string> }) => number;
}

export function buildCliProxyNativePlugin(options: BuildCliProxyNativePluginOptions): number {
  const pluginDir = resolve(options.repoRoot, "src/adapters/proxy/cliproxy-plugin");
  const out = resolve(options.repoRoot, "dist", cliproxyPluginArtifactName(options.platform, "cliproxy-aipig"));
  const env = {
    ...(options.env ?? process.env),
    GOCACHE: options.env?.GOCACHE ?? process.env.GOCACHE ?? resolve(tmpdir(), "aipig-go-build-cache"),
  };
  const args = [
    "-C",
    pluginDir,
    "build",
    "-buildmode=c-shared",
    "-buildvcs=false",
    "-o",
    out,
    ".",
  ];
  mkdirSync(dirname(out), { recursive: true });
  const spawn = options.spawn ?? ((command, commandArgs, commandOptions) => {
    const result = spawnSync(command, commandArgs, { stdio: "inherit", env: commandOptions.env });
    return result.status ?? 1;
  });
  return spawn("go", args, { env });
}
