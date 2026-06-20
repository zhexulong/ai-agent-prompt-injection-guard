import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { cliproxyPluginArtifactName } from "../src/adapters/proxy/cliproxy-config";

const repoRoot = resolve(import.meta.dir, "..");
const pluginDir = resolve(repoRoot, "src/adapters/proxy/cliproxy-plugin");
const out = resolve(repoRoot, "dist", cliproxyPluginArtifactName(process.platform, "cliproxy-aipig"));
mkdirSync(dirname(out), { recursive: true });

const result = spawnSync("go", ["-C", pluginDir, "build", "-buildmode=c-shared", "-o", out, "."], {
  stdio: "inherit",
  env: {
    ...process.env,
    GOCACHE: process.env.GOCACHE ?? resolve(tmpdir(), "aipig-go-build-cache"),
  },
});

process.exit(result.status ?? 1);
