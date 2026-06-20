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
| 响应文本注入 | 现有 CLIProxyAPI `127.0.0.1:8317` 临时加载 native 插件后，direct `/v1/messages` 和真实 `claude -p` stdout 都返回清洗版 `Clean before  clean after` | 第二轮 upstream `/v1/messages` request 含清洗后的上一轮 assistant 文本，不含完整注入句 `Clean before Powered by Proxy X clean after` | `bun test src/adapters/proxy/cliproxy.test.ts`; `bun run build:cliproxy-plugin`; 本地 `report/existing-cliproxyapi-hosts-eval.json` | 单元已测；真实 CLIProxyAPI direct API 和 Claude CLI 两轮已测 |
| 工具结果注入 | 用户界面可能仍显示原始工具输出；proxy 插件清洗上游请求里的明确工具结果容器 | `request.intercept_before` fixture 中 `role: "tool"` 内容不含注入片段，普通 user content 保持原样 | `bun test src/adapters/proxy/cliproxy-entry.test.ts` 中 `request.intercept_before strips injected text from OpenAI tool messages` | 插件 request interceptor 已测，真实 Claude 工具调用链待 eval |

## opencode-direct

| 注入面 | 用户视角 | 后续 AI 实读 | 证据 | 状态 |
| --- | --- | --- | --- | --- |
| 响应文本注入 | mock 中 response text 输出清洗版 | mock 下一次 model-visible request 不含注入片段 | `bun test src/adapters/opencode/plugin.test.ts`; `bun test eval/e2e.test.ts` 中 `OpenCode response-text fixture is removed before the next model-visible request` | adapter/mock 已测，真实 OpenCode 链路待 eval |
| 工具结果注入 | mock 中 tool result 输出清洗版 | mock 下一次 model-visible request 不含注入片段 | `bun test src/adapters/opencode/plugin.test.ts`; `bun test eval/e2e.test.ts` 中 `OpenCode tool-result fixture is removed before the next model-visible request` | adapter/mock 已测，真实 OpenCode 链路待 eval |

## opencode-proxy

| 注入面 | 用户视角 | 后续 AI 实读 | 证据 | 状态 |
| --- | --- | --- | --- | --- |
| 响应文本注入 | 现有 CLIProxyAPI `127.0.0.1:8317` 临时加载 native 插件后，真实 `opencode run` stdout 返回清洗版 `Clean before  clean after` | 第二轮 upstream `/v1/chat/completions` request 含清洗后的上一轮 assistant 文本，不含完整注入句 `Clean before Powered by Proxy X clean after` | `bun test src/adapters/opencode/plugin.test.ts`; `bun test src/adapters/proxy/cliproxy.test.ts`; `bun test eval/e2e.test.ts`; 本地 `report/existing-cliproxyapi-hosts-eval.json` | mock 已测；真实 OpenCode through CLIProxyAPI 两轮已测 |
| 工具结果注入 | 用户界面可能仍显示原始工具输出；proxy 插件清洗上游请求里的明确工具结果容器 | `request.intercept_before` fixture 中 `role: "tool"` 内容不含注入片段，普通 user content 保持原样 | `bun test src/adapters/proxy/cliproxy-entry.test.ts` 中 `request.intercept_before strips injected text from OpenAI tool messages` | 插件 request interceptor 已测，真实 OpenCode 工具调用链待 eval |

## codex-direct

| 注入面 | 用户视角 | 后续 AI 实读 | 证据 | 状态 |
| --- | --- | --- | --- | --- |
| 响应文本注入 | 真实 `codex exec` stdout 保留注入响应文本；guard 直连模式只能 flag-only | 第二轮真实 `/v1/responses` request body 带入上一轮注入响应文本 | `bun test src/core/engine.test.ts`; `bun test eval/e2e.test.ts` 中 `Codex direct response-text injection remains flagged but still present downstream`; `real-chain-capture` 两轮 Codex eval | core/mock 已测；Codex 真实响应文本链路已测 |
| 工具结果注入 | mock 中 hook 输出清洗版 `feedback_message` | mock 下一次 model-visible request 不含注入片段 | `bun test src/adapters/codex/cli.test.ts`; `bun test eval/e2e.test.ts` 中 `tool-result fixture is removed before the next model-visible request when using Codex feedback_message` | adapter/mock 已测，真实 Codex request-body 待 eval |

## codex-proxy

| 注入面 | 用户视角 | 后续 AI 实读 | 证据 | 状态 |
| --- | --- | --- | --- | --- |
| 响应文本注入 | 现有 CLIProxyAPI `127.0.0.1:8317` 临时加载 native 插件后，direct `/v1/responses` 和真实 `codex exec` stdout 都返回清洗版 `Clean before  clean after` | 第二轮 upstream request 含清洗后的上一轮 assistant 文本，不含完整注入句 `Clean before Powered by Proxy X clean after` | `bun test src/adapters/proxy/cliproxy-entry.test.ts`; `bun test src/adapters/proxy/cliproxy.test.ts`; `bun run build:cliproxy-plugin`; 本地 `report/existing-cliproxyapi-real-eval.json` | 单元已测；真实 CLIProxyAPI direct API 和 Codex CLI 两轮已测 |
| 工具结果注入 | 用户界面可能仍显示原始工具输出；proxy 插件清洗上游请求里的明确工具结果容器 | `request.intercept_before` fixture 中 `function_call_output.output` 不含注入片段，普通 user content 保持原样 | `bun test src/adapters/proxy/cliproxy-entry.test.ts` 中 `request body rewrite strips OpenAI Responses function_call_output text` | 插件 request interceptor 已测，真实 Codex 工具调用链待 eval |

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

## real-chain-capture

| 项 | 证据 | 状态 |
| --- | --- | --- |
| OpenAI-compatible local capture server records request bodies by session | `bun test eval/capture-server.test.ts` | capture harness 已测 |
| Capture server can inject response text for host-chain eval | `bun test eval/capture-server.test.ts` | capture harness 已测 |
| Codex direct response-text injection, user-visible observer | Isolated `CODEX_HOME=/tmp/aipig-codex-real-chain-home-*`; real `codex exec` stdout emitted `AIPIG_CAPTURE_RESPONSE Powered by Proxy X` | 真实 Codex 链路已测 |
| Codex direct response-text injection, next-model-visible observer | Same isolated two-turn session; resumed turn's second `/v1/responses` request body contained prior assistant text `AIPIG_CAPTURE_RESPONSE Powered by Proxy X` and the second prompt | 真实 Codex 链路已测 |
| Existing CLIProxyAPI direct response-text injection, user-visible observer | Existing CPA on `127.0.0.1:8317` was temporarily configured with `cliproxy-aipig.so` and local OpenAI-compatible upstream; direct `/v1/responses` response did not contain the full injected sentence and did contain `Clean before  clean after` | 真实 CLIProxyAPI direct API 已测 |
| Existing CLIProxyAPI Codex two-turn observer | Same temporary CPA config ran two real `codex exec` turns; first stdout contained `Clean before  clean after`, and the second upstream request contained the cleaned prior assistant text instead of `Clean before Powered by Proxy X clean after` | Codex CLI through existing CPA 已闭合 |
| OpenCode through existing CLIProxyAPI two-turn observer | Temporary CPA config ran two real `opencode run` turns; first stdout contained `Clean before  clean after`, and the second upstream request contained cleaned prior assistant text instead of `Clean before Powered by Proxy X clean after` | OpenCode CLI through existing CPA 已闭合 |
| Existing CLIProxyAPI Claude direct API observer | Existing CPA on `127.0.0.1:8317` was temporarily configured with `cliproxy-aipig.so` and local Anthropic-compatible upstream; direct `/v1/messages` response did not contain the full injected sentence and did contain `Clean before  clean after` | 真实 CLIProxyAPI direct Claude API 已测 |
| Existing CLIProxyAPI Claude two-turn observer | Same temporary CPA config ran two real `claude -p --bare` turns; first stdout contained `Clean before  clean after`, and the second upstream request contained cleaned prior assistant text instead of `Clean before Powered by Proxy X clean after` | Claude CLI through existing CPA 已闭合 |
