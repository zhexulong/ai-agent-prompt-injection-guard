import { expect, test } from "bun:test";
import { buildCliProxyPluginArtifacts } from "./build";

test("buildCliProxyPluginArtifacts builds the packaged proxy entry before the native bridge", () => {
  const calls: string[][] = [];
  const status = buildCliProxyPluginArtifacts({
    runBun(args) {
      calls.push(args);
      return 0;
    },
  });

  expect(status).toBe(0);
  expect(calls).toEqual([
    [
      "build",
      "src/adapters/proxy/cliproxy-entry.ts",
      "--outdir",
      "dist",
      "--target",
      "bun",
      "--format",
      "esm",
    ],
    ["run", "scripts/build-cliproxy-plugin.ts"],
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
