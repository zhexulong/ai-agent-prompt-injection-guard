import { spawnSync } from "node:child_process";

export interface BuildCliProxyPluginArtifactsDeps {
  runBun?: (args: string[]) => number;
}

export function buildCliProxyPluginArtifacts(deps: BuildCliProxyPluginArtifactsDeps = {}): number {
  const runBun = deps.runBun ?? ((args: string[]) => {
    const result = spawnSync(process.execPath, args, { stdio: "inherit" });
    return result.status ?? 1;
  });
  const runtimeStatus = runBun([
    "build",
    "src/adapters/proxy/cliproxy-entry.ts",
    "--outdir",
    "dist",
    "--target",
    "bun",
    "--format",
    "esm",
  ]);
  if (runtimeStatus !== 0) return runtimeStatus;
  return runBun(["run", "scripts/build-cliproxy-plugin.ts"]);
}
