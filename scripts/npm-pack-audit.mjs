import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const requiredPackageFiles = [
  "bin/aipig",
  "scripts/build-cliproxy-plugin.ts",
  "src/cli/aipig.ts",
  "src/cli/build.ts",
  "src/adapters/proxy/cliproxy-entry.ts",
  "src/adapters/proxy/cliproxy-native-build.ts",
  "src/adapters/proxy/cliproxy-plugin/go.mod",
  "src/adapters/proxy/cliproxy-plugin/main.go",
];

const forbiddenPackageFilePatterns = [
  /\.test\.ts$/,
  /^eval\//,
  /^docs\//,
  /^report\//,
  /^dist\//,
  /^node_modules\//,
  /^alerts\.jsonl$/,
  /^pending-suggestions\.json$/,
  /^eval\/fixtures\/private-real-history\//,
];

export function auditPackFiles(files) {
  const fileSet = new Set(files);
  const issues = [];
  for (const path of requiredPackageFiles) {
    if (!fileSet.has(path)) issues.push(`missing required package file: ${path}`);
  }
  for (const path of files) {
    if (forbiddenPackageFilePatterns.some((pattern) => pattern.test(path))) {
      issues.push(`forbidden package file: ${path}`);
    }
  }
  return issues;
}

export function runPackDryRun(options = {}) {
  const cache = options.cache ?? process.env.npm_config_cache ?? mkdtempSync(join(tmpdir(), "aipig-npm-cache-"));
  const spawnImpl = options.spawnImpl ?? spawnSync;
  const result = spawnImpl("npm", ["pack", "--dry-run", "--json"], {
    encoding: "utf8",
    env: { ...process.env, npm_config_cache: cache },
  });
  return {
    status: result.error ? 1 : (result.status ?? 1),
    stdout: result.stdout ?? "",
    stderr: result.error ? `${result.error.message}\n${result.stderr ?? ""}` : (result.stderr ?? ""),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runPackDryRun();
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.stderr.write(result.stdout);
    process.exit(result.status ?? 1);
  }
  const pack = JSON.parse(result.stdout)[0];
  const files = pack.files.map((file) => file.path);
  const issues = auditPackFiles(files);
  if (issues.length > 0) {
    process.stderr.write(`${issues.join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write(JSON.stringify({
    filename: pack.filename,
    entryCount: pack.entryCount,
    size: pack.size,
    unpackedSize: pack.unpackedSize,
  }, null, 2));
  process.stdout.write("\n");
}
