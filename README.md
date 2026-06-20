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

Install dependencies and build:

```bash
npm install
bun run build
bun run build:cliproxy-plugin
```

Create a config file:

```bash
mkdir -p .opencode
cp examples/aipig.config.example.jsonc .opencode/aipig.jsonc
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
bun run cliproxy:doctor -- --config .opencode/aipig.jsonc
bun run cliproxy:install -- --config .opencode/aipig.jsonc
```

`cliproxy:install` is dry-run by default. To copy the plugin and update CLIProxyAPI `config.yaml`:

```bash
bun run cliproxy:install -- --config .opencode/aipig.jsonc --write
```

Restart CLIProxyAPI after installing.

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

| Tool | Path | Response Text Injection | Tool Result Injection | Evidence |
| --- | --- | --- | --- | --- |
| Claude | Direct adapter | Display-layer mock covered | Mock covered | [matrix](eval/reports/anti-injection-matrix.md#claude-direct) |
| Claude | CLIProxyAPI | Real `/v1/messages` and Claude CLI two-turn covered | Proxy tool-result path pending | [matrix](eval/reports/anti-injection-matrix.md#claude-proxy) |
| OpenCode | Direct adapter | Mock covered | Mock covered | [matrix](eval/reports/anti-injection-matrix.md#opencode-direct) |
| OpenCode | CLIProxyAPI | Real OpenCode two-turn covered | Proxy tool-result path pending | [matrix](eval/reports/anti-injection-matrix.md#opencode-proxy) |
| Codex | Direct adapter | Real direct response text is flagged but retained by host | Mock covered | [matrix](eval/reports/anti-injection-matrix.md#codex-direct) |
| Codex | CLIProxyAPI | Real direct API and Codex CLI two-turn covered | Proxy tool-result path pending | [matrix](eval/reports/anti-injection-matrix.md#codex-proxy) |

Usage-only token padding is not rewritten. It is logged and surfaced as an alert.

## Real Chain Eval

The real-chain eval temporarily adds local eval keys/upstreams to CLIProxyAPI, restarts CPA, runs two turns per enabled host, writes a local report, then restores the original CPA config and restarts CPA again.

```bash
bun run build:cliproxy-plugin
bun run eval:real-chain -- --config .opencode/aipig.jsonc
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

Run the standard checks:

```bash
bun test
bun run build
bun run build:cliproxy-plugin
```

Run everything used by `verify`:

```bash
bun run verify
```

`verify` runs unit/integration tests and the Bun build. It does not run the real-chain eval or native plugin build.
