import { expect, test } from "bun:test";
import {
  buildCliProxyRuntimeEnv,
  cliProxyExecutableName,
  cliproxyPluginArtifactName,
  createCliProxyInstallPlan,
  patchCliProxyPluginConfig,
  patchCliProxyConfig,
} from "./cliproxy-config";
import { NotifyLevel } from "../../core/types";

const guard = {
  fingerprintsPath: "fingerprints.json",
  alertsPath: "alerts.jsonl",
  pendingSuggestionsPath: "pending-suggestions.json",
  alertLimit: 100,
  notifyLevel: NotifyLevel.Always,
};

test("patchCliProxyConfig adds api keys, upstreams, claude key, and plugin config", () => {
  const original = [
    "api-keys:",
    '  - "existing-key"',
    "openai-compatibility:",
    "claude-api-key:",
  ].join("\n");

  const patched = patchCliProxyConfig(original, {
    cpaRoot: "/opt/cliproxyapi",
    cpaPort: 8317,
    upstreamPort: 9123,
    pluginName: "cliproxy-aipig",
    openaiClientKey: "client-key",
    claudeClientKey: "claude-key",
    openaiModel: "aipig-capture",
  });

  expect(patched).toContain('- "client-key"');
  expect(patched).toContain('- "claude-key"');
  expect(patched).toContain('name: "aipig-eval-upstream"');
  expect(patched).toContain('base-url: "http://127.0.0.1:9123/v1"');
  expect(patched).toContain('api-key: "claude-key"');
  expect(patched).toContain('dir: "/opt/cliproxyapi/plugins"');
  expect(patched).toContain("cliproxy-aipig:");
  expect(patched).toContain("priority: 1");
});

test("patchCliProxyPluginConfig only installs the plugin section", () => {
  const original = [
    "api-keys:",
    "openai-compatibility:",
    "claude-api-key:",
  ].join("\n");

  const patched = patchCliProxyPluginConfig(original, {
    cpaRoot: "/opt/cliproxyapi",
    pluginName: "cliproxy-aipig",
  });

  expect(patched).toContain("plugins:");
  expect(patched).toContain('dir: "/opt/cliproxyapi/plugins"');
  expect(patched).toContain("cliproxy-aipig:");
  expect(patched).not.toContain("aipig-eval-upstream");
  expect(patched).not.toContain("aipig-eval-client-key");
});

test("patchCliProxyConfig appends plugin config to an existing plugins section", () => {
  const original = [
    "api-keys:",
    "openai-compatibility:",
    "claude-api-key:",
    "plugins:",
    "  enabled: true",
    '  dir: "/tmp/plugins"',
    "  configs:",
    "    other-plugin:",
    "      enabled: true",
    "server:",
    "  port: 8317",
  ].join("\n");

  const patched = patchCliProxyConfig(original, {
    cpaRoot: "C:\\cliproxyapi",
    cpaPort: 8317,
    upstreamPort: 9444,
    pluginName: "cliproxy-aipig",
    openaiClientKey: "client-key",
    claudeClientKey: "claude-key",
    openaiModel: "aipig-capture",
  });

  expect(patched).toContain("    other-plugin:");
  expect(patched).toContain("    cliproxy-aipig:");
  expect(patched).toContain('dir: "/tmp/plugins"');
  expect(patched).toContain("server:");
});

test("buildCliProxyRuntimeEnv exports guard config paths for the native bridge", () => {
  const env = buildCliProxyRuntimeEnv({
    guard,
    repoRoot: "/repo",
    entryPath: "/repo/src/adapters/proxy/cliproxy-entry.ts",
    bunPath: "/usr/bin/bun",
  });

  expect(env.AIPIG_CLIPROXY_BUN).toBe("/usr/bin/bun");
  expect(env.AIPIG_CLIPROXY_WORKDIR).toBe("/repo");
  expect(env.AIPIG_CLIPROXY_ENTRY).toBe("/repo/src/adapters/proxy/cliproxy-entry.ts");
  expect(env.AIPIG_FINGERPRINTS_PATH).toBe("fingerprints.json");
  expect(env.AIPIG_ALERTS_PATH).toBe("alerts.jsonl");
  expect(env.AIPIG_PENDING_SUGGESTIONS_PATH).toBe("pending-suggestions.json");
  expect(env.AIPIG_NOTIFY_LEVEL).toBe("always");
  expect(env.AIPIG_ALERT_LIMIT).toBe("100");
});

test("cliproxy install plan uses platform-specific binary and plugin artifact names", () => {
  const linux = createCliProxyInstallPlan({
    cpaRoot: "/opt/cliproxyapi",
    repoRoot: "/repo",
    platform: "linux",
    pluginName: "cliproxy-aipig",
  });
  expect(linux.cpaBin).toBe("/opt/cliproxyapi/cli-proxy-api");
  expect(linux.pluginArtifact).toBe("/repo/dist/cliproxy-aipig.so");
  expect(linux.pluginTarget).toBe("/opt/cliproxyapi/plugins/cliproxy-aipig.so");

  const windows = createCliProxyInstallPlan({
    cpaRoot: "C:\\cliproxyapi",
    repoRoot: "C:\\repo",
    platform: "win32",
    pluginName: "cliproxy-aipig",
  });
  expect(windows.cpaBin).toBe("C:\\cliproxyapi/cli-proxy-api.exe");
  expect(windows.pluginArtifact).toBe("C:\\repo/dist/cliproxy-aipig.dll");
  expect(windows.pluginTarget).toBe("C:\\cliproxyapi/plugins/cliproxy-aipig.dll");
});

test("platform helpers expose CPA executable and plugin names", () => {
  expect(cliProxyExecutableName("win32")).toBe("cli-proxy-api.exe");
  expect(cliProxyExecutableName("linux")).toBe("cli-proxy-api");
  expect(cliproxyPluginArtifactName("win32", "cliproxy-aipig")).toBe("cliproxy-aipig.dll");
  expect(cliproxyPluginArtifactName("darwin", "cliproxy-aipig")).toBe("cliproxy-aipig.dylib");
  expect(cliproxyPluginArtifactName("linux", "cliproxy-aipig")).toBe("cliproxy-aipig.so");
});
