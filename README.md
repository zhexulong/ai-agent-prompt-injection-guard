# AI Agent Prompt Injection Guard

AIPIG is a local guard for AI-agent prompt-injection banners, proxy-added response text, suspicious tool-result text, and token-padding artifacts.

The main supported deployment path is a CLIProxyAPI response interceptor. When Claude Code, OpenCode, or Codex talks through CLIProxyAPI, AIPIG can remove known injected response text before the client stores it and before the next model request reads it back.

## What It Does

- Strips known response-text injections in CLIProxyAPI responses.
- Flags or rewrites tool-result injections in direct host adapters where the host exposes a safe hook.
- Keeps positive and negative fingerprints in one `fingerprints.json` file.
- Suggests bounded regex fingerprints after repeated same-session patterns.
- Writes alert and pending-suggestion logs locally.
- Provides a real-chain eval for Claude and OpenCode through CLIProxyAPI.

## Quick Start

Prerequisites:

- Bun
- Go toolchain, for building the native CLIProxyAPI plugin bridge
- CLIProxyAPI v7 with plugin support

Install dependencies and build the plugin:

```bash
npm install
bun run aipig -- build-plugin
```

Create a config file:

```bash
bun run aipig -- init --config .opencode/aipig.jsonc
```

Edit `.opencode/aipig.jsonc` and set:

```jsonc
{
  "cliproxy": {
    "cpaRoot": "/absolute/path/to/cliproxyapi",
    "port": 8317,
    "pluginName": "cliproxy-aipig"
  }
}
```

Check the install plan:

```bash
bun run aipig -- cliproxy doctor --config .opencode/aipig.jsonc
bun run aipig -- cliproxy diff --config .opencode/aipig.jsonc
```

Install:

```bash
bun run aipig -- cliproxy install --config .opencode/aipig.jsonc --write
```

Install copies the native plugin and bundled JS entry into CLIProxyAPI `plugins/`, writes a runtime `.opencode/aipig.jsonc` under the CLIProxyAPI directory, patches `config.yaml`, and waits for CLIProxyAPI hot reload. It does not restart CPA by default.

Rollback commands:

```bash
bun run aipig -- cliproxy uninstall --config .opencode/aipig.jsonc --write
bun run aipig -- cliproxy restore --config .opencode/aipig.jsonc --backup /path/to/config.yaml.aipig-backup-... --write
```

## Config Files

AIPIG uses its own config file instead of putting guard settings into `opencode.json`.

Config files are loaded in this order, with later files overriding earlier files:

1. Linux/macOS global: `~/.config/opencode/aipig.jsonc` or `aipig.json`
2. Windows global: `%APPDATA%\opencode\aipig.jsonc` or `aipig.json`
3. Custom config dir: `$OPENCODE_CONFIG_DIR/aipig.jsonc` or `aipig.json`
4. Project config: `.opencode/aipig.jsonc` or `aipig.json`
5. Explicit file: `AIPIG_CONFIG=/path/to/aipig.jsonc` or `--config /path/to/aipig.jsonc`

Important environment overrides:

- `AIPIG_CONFIG`: explicit `aipig.jsonc` or `aipig.json` path
- `AIPIG_FINGERPRINTS_PATH`: fingerprint library, default `fingerprints.json`
- `AIPIG_ALERTS_PATH`: alert log, default `alerts.jsonl`
- `AIPIG_PENDING_SUGGESTIONS_PATH`: pending suggestion rolling JSON array, default `pending-suggestions.json`
- `AIPIG_NOTIFY_LEVEL`: `first`, `always`, or `never`
- `AIPIG_ALERT_LIMIT`: alert ring size, default `100`
- `AIPIG_CLIPROXY_CPA_ROOT`: CLIProxyAPI directory
- `AIPIG_CLIPROXY_PORT`: CLIProxyAPI port, default `8317`
- `AIPIG_JUDGE_BASE_URL`, `AIPIG_JUDGE_API_KEY`, `AIPIG_JUDGE_MODEL`: optional Tier 1 judge

## Windows

The config loader supports `%APPDATA%\opencode\aipig.jsonc`.

The native plugin build script emits:

- Linux: `dist/cliproxy-aipig.so`
- macOS: `dist/cliproxy-aipig.dylib`
- Windows: `dist/cliproxy-aipig.dll`

Windows real-chain verification is not complete yet. The install paths are implemented, but Windows should be validated on a real Windows host before calling it release-ready.

## Current Coverage

| Tool | Path | Response Text Injection | Tool Result Injection | User View | Next AI Turn | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Claude Code | CLIProxyAPI | Removed before Claude stores it | Not covered on the proxy path yet | Injected banners are stripped from responses | Cleaned response text is carried forward | [matrix](eval/reports/anti-injection-matrix.md#claude-proxy) |
| Claude Code | Direct hooks | Can be hidden from display only | Removed before Claude reads tool output | Tool-output injections are removed; response banners may only be hidden on screen | Tool results are cleaned; response text may still remain in host context | [matrix](eval/reports/anti-injection-matrix.md#claude-direct) |
| OpenCode | CLIProxyAPI | Removed before OpenCode stores it | Not covered on the proxy path yet | Injected banners are stripped from responses | Cleaned response text is carried forward | [matrix](eval/reports/anti-injection-matrix.md#opencode-proxy) |
| OpenCode | Direct plugin | Removed by the plugin | Removed by the plugin | Injected response and tool-result text are removed | Cleaned content is sent onward | [matrix](eval/reports/anti-injection-matrix.md#opencode-direct) |
| Codex | CLIProxyAPI | Removed before Codex receives it | Not covered on the proxy path yet | Injected banners are stripped from responses | Cleaned response text is carried forward | [matrix](eval/reports/anti-injection-matrix.md#codex-proxy) |
| Codex | Direct hooks | Alert only; Codex cannot rewrite assistant responses here | Replaced for the model with hook feedback | Response banners can still appear; tool-result replacements are surfaced through hook feedback | Response banners may remain; tool results are cleaned | [matrix](eval/reports/anti-injection-matrix.md#codex-direct) |

Usage-only token padding is not rewritten. It is logged and surfaced as an alert.

## Real Chain Eval

The real-chain eval temporarily adds local eval keys/upstreams to CLIProxyAPI, waits for hot reload, runs two turns per enabled host, writes a local report, restores the original CPA config, and waits for hot reload again.

```bash
bun run aipig -- build-plugin
bun run eval:real-chain -- --config .opencode/aipig.jsonc
```

Use `--restart` only if hot reload is unavailable in your CPA build:

```bash
bun run eval:real-chain -- --config .opencode/aipig.jsonc --restart
```

The report path defaults to `report/real-chain-eval.json`. `report/` is local evidence and should not be committed.

## History Replay

Replay is local and read-only. It streams explicit input files, defaults to 10,000 parsed records, writes only to this repository, and never writes `fingerprints.json`.

```bash
bun run eval/history-replay.ts --input /absolute/path/to/history.jsonl --max-records 10000
```

You can layer a copied local fixture with synthetic injection overlays:

```bash
bun run eval/history-replay.ts \
  --input /absolute/path/to/copied-history.jsonl \
  --input eval/fixtures/history-overlays/middlebox-injections.jsonl \
  --max-records 1200
```

Report output:

```text
eval/reports/history-replay.md
```

Trusted system-prompt containers such as Codex `session_meta.base_instructions` are ignored during replay. The same system-prompt-like text is still suspicious if it appears in `response_text` or `tool_result`.

## Development

Run checks:

```bash
./node_modules/.bin/tsc --noEmit
bun run verify
bun run build:cliproxy-plugin
npm run pack:audit
```

`verify` runs unit/integration tests and the Bun build. It does not run the real-chain eval or native plugin build.
`pack:audit` runs `npm pack --dry-run --json` and fails if the package would include tests, eval data, reports, private history, or local build artifacts. It does not publish.
