import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

test("npm package metadata exposes the source CLI without enabling publish yet", () => {
  expect(packageJson.private).toBe(true);
  expect(packageJson.description).toContain("prompt-injection");
  expect(packageJson.bin).toEqual({ aipig: "bin/aipig" });
  expect(packageJson.files).toEqual([
    "bin/aipig",
    "src/**/*.ts",
    "!src/**/*.test.ts",
    "src/adapters/proxy/cliproxy-plugin/",
    "scripts/build-cliproxy-plugin.ts",
    "examples/",
    "fingerprints.json",
    "README.md",
    "CHANGELOG.md",
  ]);
  expect(packageJson.repository.url).toBe("git+ssh://git@github.com/zhexulong/ai-agent-prompt-injection-guard.git");
  expect(packageJson.bugs.url).toBe("https://github.com/zhexulong/ai-agent-prompt-injection-guard/issues");
  expect(packageJson.homepage).toBe("https://github.com/zhexulong/ai-agent-prompt-injection-guard#readme");
  expect(packageJson.engines.bun).toBe(">=1.3.0");
  expect(packageJson.scripts["pack:audit"]).toBe("node scripts/npm-pack-audit.mjs");
});

test("npm ignore file excludes tests, eval artifacts, and local evidence", () => {
  const ignore = readFileSync(".npmignore", "utf8");

  for (const pattern of [
    "**/*.test.ts",
    "eval/",
    "docs/",
    "report/",
    "dist/",
    "alerts.jsonl",
    "pending-suggestions.json",
    "eval/fixtures/private-real-history/",
  ]) {
    expect(ignore).toContain(pattern);
  }
});

test("npm bin entry is a Bun executable that delegates to the source CLI", () => {
  const bin = readFileSync("bin/aipig", "utf8");

  expect(bin.startsWith("#!/usr/bin/env bun\n")).toBe(true);
  expect(bin).toContain("../src/cli/aipig");
  expect(bin).toContain("runAipigCli");
});
