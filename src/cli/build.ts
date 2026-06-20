import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

export interface BuildCliProxyPluginArtifactsDeps {
  packageRoot?: string;
  runBun?: (args: string[], options: { cwd: string }) => number;
}

export function buildCliProxyPluginArtifacts(deps: BuildCliProxyPluginArtifactsDeps = {}): number {
  const packageRoot = deps.packageRoot ?? resolve(import.meta.dir, "../..");
  const runBun = deps.runBun ?? ((args: string[], options: { cwd: string }) => {
    const result = spawnSync(process.execPath, args, { cwd: options.cwd, stdio: "inherit" });
    return result.status ?? 1;
  });
  const runtimeStatus = runBun([
    "build",
    "src/adapters/proxy/cliproxy-entry.ts",
    "--outdir",
    "dist/src/adapters/proxy",
    "--target",
    "bun",
    "--format",
    "esm",
  ], { cwd: packageRoot });
  if (runtimeStatus !== 0) return runtimeStatus;
  return runBun(["run", "scripts/build-cliproxy-plugin.ts"], { cwd: packageRoot });
}
