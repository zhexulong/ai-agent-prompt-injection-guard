import { expect, test } from "bun:test";
import YAML from "yaml";
import {
  buildCliProxyRuntimeEnv,
  cliProxyExecutableName,
  cliproxyPluginArtifactName,
  createCliProxyInstallPlan,
  patchCliProxyPluginConfig,
  patchCliProxyConfig,
  unpatchCliProxyPluginConfig,
} from "./cliproxy-config";
import { NotifyLevel } from "../../core/types";

const guard = {
  fingerprintsPath: "fingerprints.json",
  alertsPath: "alerts.jsonl",
  pendingSuggestionsPath: "pending-suggestions.json",
  alertLimit: 100,
  notifyLevel: NotifyLevel.Always,
};

function parseYaml(text: string): any {
  return YAML.parse(text);
}

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

  const yaml = parseYaml(patched);
  expect(yaml["api-keys"]).toContain("client-key");
  expect(yaml["api-keys"]).toContain("claude-key");
  expect(yaml["openai-compatibility"][0].name).toBe("aipig-eval-upstream");
  expect(yaml["openai-compatibility"][0]["base-url"]).toBe("http://127.0.0.1:9123/v1");
  expect(yaml["claude-api-key"][0]["api-key"]).toBe("claude-key");
  expect(yaml.plugins.dir).toBe("/opt/cliproxyapi/plugins");
  expect(yaml.plugins.configs["cliproxy-aipig"].priority).toBe(1);
});

test("patchCliProxyConfig creates missing top-level sections with YAML semantics", () => {
  const original = [
    "# minimal CPA config",
    "host: 127.0.0.1",
    "port: 8317",
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

  expect(patched).toContain("api-keys:");
  expect(patched).toContain("openai-compatibility:");
  expect(patched).toContain("claude-api-key:");
  expect(patched).toContain("plugins:");
  expect(patched).toContain("host: 127.0.0.1");
});

test("patchCliProxyPluginConfig only installs the plugin section", () => {
  const original = [
    "# minimal CPA config",
    "port: 8317",
  ].join("\n");

  const patched = patchCliProxyPluginConfig(original, {
    cpaRoot: "/opt/cliproxyapi",
    pluginName: "cliproxy-aipig",
  });

  expect(patched).toContain("plugins:");
  const yaml = parseYaml(patched);
  expect(yaml.plugins.dir).toBe("/opt/cliproxyapi/plugins");
  expect(yaml.plugins.configs["cliproxy-aipig"].enabled).toBe(true);
  expect(patched).not.toContain("aipig-eval-upstream");
  expect(patched).not.toContain("aipig-eval-client-key");
});

test("unpatchCliProxyPluginConfig removes only the AIPIG plugin config", () => {
  const original = [
    "plugins:",
    "  enabled: true",
    "  dir: /tmp/plugins",
    "  configs:",
    "    other-plugin:",
    "      enabled: true",
    "    cliproxy-aipig:",
    "      enabled: true",
    "      priority: 1",
    "api-keys:",
    "  - existing-key",
  ].join("\n");

  const patched = unpatchCliProxyPluginConfig(original, "cliproxy-aipig");
  const yaml = parseYaml(patched);

  expect(yaml.plugins.configs["other-plugin"].enabled).toBe(true);
  expect(yaml.plugins.configs["cliproxy-aipig"]).toBeUndefined();
  expect(yaml["api-keys"]).toEqual(["existing-key"]);
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

  const yaml = parseYaml(patched);
  expect(yaml.plugins.configs["other-plugin"].enabled).toBe(true);
  expect(yaml.plugins.configs["cliproxy-aipig"].priority).toBe(1);
  expect(yaml.plugins.dir).toBe("/tmp/plugins");
  expect(yaml.server.port).toBe(8317);
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
  expect(linux.entryArtifact).toBe("/repo/dist/src/adapters/proxy/cliproxy-entry.js");
  expect(linux.entryTarget).toBe("/opt/cliproxyapi/plugins/cliproxy-aipig-entry.js");

  const windows = createCliProxyInstallPlan({
    cpaRoot: "C:\\cliproxyapi",
    repoRoot: "C:\\repo",
    platform: "win32",
    pluginName: "cliproxy-aipig",
  });
  expect(windows.cpaBin).toBe("C:\\cliproxyapi/cli-proxy-api.exe");
  expect(windows.pluginArtifact).toBe("C:\\repo/dist/cliproxy-aipig.dll");
  expect(windows.pluginTarget).toBe("C:\\cliproxyapi/plugins/cliproxy-aipig.dll");
  expect(windows.entryArtifact).toBe("C:\\repo/dist/src/adapters/proxy/cliproxy-entry.js");
  expect(windows.entryTarget).toBe("C:\\cliproxyapi/plugins/cliproxy-aipig-entry.js");
});

test("platform helpers expose CPA executable and plugin names", () => {
  expect(cliProxyExecutableName("win32")).toBe("cli-proxy-api.exe");
  expect(cliProxyExecutableName("linux")).toBe("cli-proxy-api");
  expect(cliproxyPluginArtifactName("win32", "cliproxy-aipig")).toBe("cliproxy-aipig.dll");
  expect(cliproxyPluginArtifactName("darwin", "cliproxy-aipig")).toBe("cliproxy-aipig.dylib");
  expect(cliproxyPluginArtifactName("linux", "cliproxy-aipig")).toBe("cliproxy-aipig.so");
});
