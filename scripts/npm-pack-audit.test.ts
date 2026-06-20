import { expect, test } from "bun:test";
// @ts-expect-error The audit entry is plain ESM so npm can run it without a build step.
import { auditPackFiles } from "./npm-pack-audit.mjs";

test("auditPackFiles accepts the intended npm package boundary", () => {
  expect(auditPackFiles([
    "package.json",
    "README.md",
    "CHANGELOG.md",
    "bin/aipig",
    "scripts/build-cliproxy-plugin.ts",
    "src/cli/aipig.ts",
    "src/cli/build.ts",
    "src/adapters/proxy/cliproxy-entry.ts",
    "src/adapters/proxy/cliproxy-native-build.ts",
    "src/adapters/proxy/cliproxy-plugin/go.mod",
    "src/adapters/proxy/cliproxy-plugin/main.go",
    "fingerprints.json",
  ])).toEqual([]);
});

test("auditPackFiles rejects tests, eval data, local reports, and missing runtime files", () => {
  expect(auditPackFiles([
    "package.json",
    "src/cli/aipig.test.ts",
    "eval/history-replay.ts",
    "report/real-chain-eval.json",
    "dist/src/adapters/proxy/cliproxy-entry.js",
    "eval/fixtures/private-real-history/sample.jsonl",
  ])).toEqual([
    "missing required package file: bin/aipig",
    "missing required package file: scripts/build-cliproxy-plugin.ts",
    "missing required package file: src/cli/aipig.ts",
    "missing required package file: src/cli/build.ts",
    "missing required package file: src/adapters/proxy/cliproxy-entry.ts",
    "missing required package file: src/adapters/proxy/cliproxy-native-build.ts",
    "missing required package file: src/adapters/proxy/cliproxy-plugin/go.mod",
    "missing required package file: src/adapters/proxy/cliproxy-plugin/main.go",
    "forbidden package file: src/cli/aipig.test.ts",
    "forbidden package file: eval/history-replay.ts",
    "forbidden package file: report/real-chain-eval.json",
    "forbidden package file: dist/src/adapters/proxy/cliproxy-entry.js",
    "forbidden package file: eval/fixtures/private-real-history/sample.jsonl",
  ]);
});
