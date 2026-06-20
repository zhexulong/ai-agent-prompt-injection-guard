import { expect, test } from "bun:test";
import { buildCliProxyPluginArtifacts } from "./build";

test("buildCliProxyPluginArtifacts builds the packaged proxy entry before the native bridge", () => {
  const calls: Array<{ args: string[]; cwd?: string }> = [];
  const status = buildCliProxyPluginArtifacts({
    packageRoot: "/pkg/aipig",
    runBun(args, options) {
      calls.push({ args, cwd: options.cwd });
      return 0;
    },
  });

  expect(status).toBe(0);
  expect(calls).toEqual([
    {
      args: [
        "build",
        "src/adapters/proxy/cliproxy-entry.ts",
        "--outdir",
        "dist/src/adapters/proxy",
        "--target",
        "bun",
        "--format",
        "esm",
      ],
      cwd: "/pkg/aipig",
    },
    { args: ["run", "scripts/build-cliproxy-plugin.ts"], cwd: "/pkg/aipig" },
  ]);
});

test("buildCliProxyPluginArtifacts stops before native build when runtime entry build fails", () => {
  const calls: string[][] = [];
  const status = buildCliProxyPluginArtifacts({
    runBun(args) {
      calls.push(args);
      return 17;
    },
  });

  expect(status).toBe(17);
  expect(calls).toHaveLength(1);
});
