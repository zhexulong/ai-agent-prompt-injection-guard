import { expect, test } from "bun:test";
import { buildCliProxyNativePlugin } from "./cliproxy-native-build";

test("buildCliProxyNativePlugin disables Go VCS stamping for npm package installs", () => {
  const calls: Array<{ command: string; args: string[]; env: Record<string, string> }> = [];
  const repoRoot = "/tmp/aipig-native-build-test";
  const status = buildCliProxyNativePlugin({
    repoRoot,
    platform: "linux",
    env: {},
    spawn(command, args, options) {
      calls.push({ command, args, env: options.env });
      return 0;
    },
  });

  expect(status).toBe(0);
  expect(calls).toEqual([{
    command: "go",
    args: [
      "-C",
      `${repoRoot}/src/adapters/proxy/cliproxy-plugin`,
      "build",
      "-buildmode=c-shared",
      "-buildvcs=false",
      "-o",
      `${repoRoot}/dist/cliproxy-aipig.so`,
      ".",
    ],
    env: { GOCACHE: expect.stringContaining("aipig-go-build-cache") },
  }]);
});
