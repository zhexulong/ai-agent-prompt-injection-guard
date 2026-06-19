# Anti-Injection Matrix Report

This report is the evidence source for the README matrix. Capability cells remain provisional until a real host path is exercised and the user-visible and next-model-visible observations are recorded separately.

## claude-direct

| 注入面 | 用户视角 | 后续 AI 实读 | 证据 | 状态 |
| --- | --- | --- | --- | --- |
| 响应文本注入 | mock 中 `MessageDisplay.displayContent` 为清洗版 | mock 下一轮 request 仍含原始响应注入片段 | `bun test src/adapters/claude/cli.test.ts`; `bun test eval/e2e.test.ts` 中 `Claude direct response-text injection can be hidden from display but remains downstream` | adapter/mock 已测，真实 Claude Code transcript / request-body 待 eval |
| 工具结果注入 | mock 中 hook 输出清洗版 `updatedToolOutput` | mock 下一次 model-visible request 不含注入片段 | `bun test src/adapters/claude/cli.test.ts`; `bun test eval/e2e.test.ts` 中 `Claude tool-result fixture is removed before the next model-visible request` | adapter/mock 已测，真实 Claude Code request-body 待 eval |

## claude-proxy

| 注入面 | 用户视角 | 后续 AI 实读 | 证据 | 状态 |
| --- | --- | --- | --- | --- |
| 响应文本注入 | 测试覆盖 proxy transform 清洗 | 待真实链路 eval | `bun test src/adapters/proxy/cliproxy.test.ts` | 单元已测，真实链路待 eval |
| 工具结果注入 | 直连 Claude adapter 已测；proxy 组合链路待 eval | 待真实链路 eval | `bun test src/adapters/claude/cli.test.ts`; `bun test eval/e2e.test.ts` | adapter/mock 已测，proxy 组合待 eval |

## opencode-direct

| 注入面 | 用户视角 | 后续 AI 实读 | 证据 | 状态 |
| --- | --- | --- | --- | --- |
| 响应文本注入 | mock 中 response text 输出清洗版 | mock 下一次 model-visible request 不含注入片段 | `bun test src/adapters/opencode/plugin.test.ts`; `bun test eval/e2e.test.ts` 中 `OpenCode response-text fixture is removed before the next model-visible request` | adapter/mock 已测，真实 OpenCode 链路待 eval |
| 工具结果注入 | mock 中 tool result 输出清洗版 | mock 下一次 model-visible request 不含注入片段 | `bun test src/adapters/opencode/plugin.test.ts`; `bun test eval/e2e.test.ts` 中 `OpenCode tool-result fixture is removed before the next model-visible request` | adapter/mock 已测，真实 OpenCode 链路待 eval |

## opencode-proxy

| 注入面 | 用户视角 | 后续 AI 实读 | 证据 | 状态 |
| --- | --- | --- | --- | --- |
| 响应文本注入 | adapter/mock 与 proxy transform 均可清洗 | 待真实链路 eval | `bun test src/adapters/opencode/plugin.test.ts`; `bun test src/adapters/proxy/cliproxy.test.ts`; `bun test eval/e2e.test.ts` | mock 已测，真实链路待 eval |
| 工具结果注入 | adapter/mock 已测；proxy 组合链路待 eval | 待真实链路 eval | `bun test src/adapters/opencode/plugin.test.ts`; `bun test eval/e2e.test.ts` | adapter/mock 已测，proxy 组合待 eval |

## codex-direct

| 注入面 | 用户视角 | 后续 AI 实读 | 证据 | 状态 |
| --- | --- | --- | --- | --- |
| 响应文本注入 | 原文保留，仅 flag-only | 原文保留 | `bun test src/core/engine.test.ts`; `bun test eval/e2e.test.ts` 中 `Codex direct response-text injection remains flagged but still present downstream` | core/mock 已测，真实 Codex request-body 待 eval |
| 工具结果注入 | mock 中 hook 输出清洗版 `feedback_message` | mock 下一次 model-visible request 不含注入片段 | `bun test src/adapters/codex/cli.test.ts`; `bun test eval/e2e.test.ts` 中 `tool-result fixture is removed before the next model-visible request when using Codex feedback_message` | adapter/mock 已测，真实 Codex request-body 待 eval |

## codex-proxy

| 注入面 | 用户视角 | 后续 AI 实读 | 证据 | 状态 |
| --- | --- | --- | --- | --- |
| 响应文本注入 | 测试覆盖 proxy transform 清洗 | 待真实链路 eval | `bun test src/adapters/proxy/cliproxy.test.ts` | 单元已测，真实链路待 eval |
| 工具结果注入 | 直连 Codex adapter 已测；proxy 组合链路待 eval | 待真实链路 eval | `bun test src/adapters/codex/cli.test.ts`; `bun test eval/e2e.test.ts` | adapter/mock 已测，proxy 组合待 eval |

## padding

| 注入面 | 用户视角 | 后续 AI 实读 | 证据 | 状态 |
| --- | --- | --- | --- | --- |
| 可定位注水内容 | 按所在响应 / 工具路径清洗或提示 | 按所在响应 / 工具路径清洗或保留边界处理 | `bun test eval/e2e.test.ts` 中 Claude/Codex/OpenCode response/tool fixtures；`bun test src/core/engine.test.ts` 中 high-confidence strip | mock 已测，真实链路待 eval |
| 纯 usage 数字虚高 | 不改文本，仅提示 / 告警 | 不改文本 | `bun test src/core/engine.test.ts` 中 usage-only tests | 核心已测 |

## history-replay

| 项 | 证据 | 状态 |
| --- | --- | --- |
| 候选 regex 支持样本 / 额外命中 / 人工判定列 | `bun test eval/history-replay.test.ts`; sample run writes `eval/reports/history-replay.md` | 已有离线 replay |
| 不修改历史文件、不写历史目录旁边、不自动写 `fingerprints.json` | CLI 固定输出 `eval/reports/history-replay.md`; tests cover no confirmed write path | 已有边界 |
