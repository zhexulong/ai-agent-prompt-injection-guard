import { resolve } from "node:path";
import { buildCliProxyNativePlugin } from "../src/adapters/proxy/cliproxy-native-build";

const repoRoot = resolve(import.meta.dir, "..");
const status = buildCliProxyNativePlugin({
  repoRoot,
  platform: process.platform,
});

process.exit(status);
