# ai-agent-prompt-injection-guard

Local guard for AI-agent prompt-injection and token-padding artifacts. The current implementation provides the core detection engine, bounded fingerprint suggestions, history replay, a proxy response transform, plus Claude Code, Codex, and OpenCode adapters. Real host-chain captures are still pending.

## Capability Matrix

Evidence links point to `eval/reports/anti-injection-matrix.md`. Cells marked `待 eval` must not be treated as release claims.

| 工具 | 链路 | 响应文本注入 | 工具结果注入 | 用户视角 | 后续 AI 实读 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| Claude | 直连 | display-only/mock 已测，真实链路待 eval | mock 已测，真实链路待 eval | 响应显示层清洗；工具结果可能仍显示原文 | 响应原文保留；工具结果 mock 中不含注入 | [报告](eval/reports/anti-injection-matrix.md#claude-direct) |
| Claude | 中转/代理 | 单元已测，真实链路待 eval | 直连 adapter mock 已测，proxy 工具链路待 eval | proxy 清洗响应文本 | 待真实链路确认 | [报告](eval/reports/anti-injection-matrix.md#claude-proxy) |
| OpenCode | 直连 | mock 已测，真实链路待 eval | mock 已测，真实链路待 eval | response/tool 输出清洗版 | mock 下一轮请求不含注入 | [报告](eval/reports/anti-injection-matrix.md#opencode-direct) |
| OpenCode | 中转/代理 | mock 已测，真实链路待 eval | mock 已测，真实链路待 eval | response/tool 输出清洗版 | 待真实链路确认 | [报告](eval/reports/anti-injection-matrix.md#opencode-proxy) |
| Codex | 直连 | flag-only/mock 已测，真实链路待 eval | mock 已测，真实链路待 eval | 响应原文保留；工具结果写入清洗版 feedback | 响应原文保留；工具结果 mock 中不含注入 | [报告](eval/reports/anti-injection-matrix.md#codex-direct) |
| Codex | 中转/代理 | 单元已测，真实链路待 eval | 直连 adapter mock 已测，proxy 工具链路待 eval | proxy 清洗响应文本 | 待真实链路确认 | [报告](eval/reports/anti-injection-matrix.md#codex-proxy) |

注水另列：可定位注水内容按所在位置套用上表；纯 usage 数字虚高不改内容，只写告警并做展示提示，证据见 [padding 报告](eval/reports/anti-injection-matrix.md#padding)。

## Install

```bash
bun install
bun test
bun run build
```

## History Replay

Replay is local and read-only. It streams the explicit input file, defaults to 10,000 parsed records, writes only to this repository, and never writes `fingerprints.json`.
Trusted system-prompt containers such as Codex `session_meta.base_instructions` are ignored during replay. The same system-prompt-like text is still suspicious if it appears in `response_text` or `tool_result`, so attackers cannot bypass detection by copying a normal host prompt into model-visible output.

```bash
bun run eval/history-replay.ts --input /absolute/path/to/history.jsonl --max-records 10000
```

Multiple inputs can be layered for eval, for example a local copied history fixture plus a synthetic middlebox-injection overlay:

```bash
bun run eval/history-replay.ts \
  --input eval/fixtures/private-real-history/codex-latest-2026-06-19.jsonl \
  --input eval/fixtures/history-overlays/middlebox-injections.jsonl \
  --max-records 1200
```

Report output:

```text
eval/reports/history-replay.md
```

## Proxy Transform

The implemented proxy adapter can sanitize response text when the user's chain has a response-transform hook.

```typescript
import { rewriteProxyResponse } from "./src/adapters/proxy/cliproxy";

const result = await rewriteProxyResponse({
  text: "hello Powered by Proxy X world",
  sessionId: "s1",
  host: "proxy",
});
```

## Config

- `AIPIG_FINGERPRINTS_PATH`: fingerprint library, default `fingerprints.json`
- `AIPIG_ALERTS_PATH`: alert log, default `alerts.jsonl`
- `AIPIG_PENDING_SUGGESTIONS_PATH`: pending suggestion rolling JSON array, default `pending-suggestions.json`, newest 100 entries
- `AIPIG_NOTIFY_LEVEL`: `first` / `always` / `never`
- `AIPIG_ALERT_LIMIT`: alert ring size, default `100`
- `AIPIG_JUDGE_BASE_URL` / `AIPIG_JUDGE_API_KEY` / `AIPIG_JUDGE_MODEL`: optional Tier 1 judge

## Current Boundary

The core engine, proxy transform, Claude hook adapter, Codex hook adapter, and OpenCode plugin adapter are implemented. Real request-body capture eval is not complete yet, so the README matrix keeps those cells provisional.
