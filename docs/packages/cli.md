---
slug: cli
name: "@fidoo/cli"
path: apps/cli
group: 客户端与应用
order: 8
summary: 面向用户的命令入口，统一文本、JSON、JSONL 与 TUI 启动方式。
description: CLI 负责参数、环境变量、工作区预检、配置持久化和进程生命周期。TTY 默认进入 TUI；非 TTY 保留可脚本化输出，避免 Ink 和交互提示污染自动化管道。
keywords: CLI, 命令行, JSONL, TTY, 配置
dependencies: @fidoo/api, @fidoo/client, @fidoo/core, @fidoo/node-runtime, @fidoo/protocol, @fidoo/tui, commander
---

## 包职责与运行模式

`apps/cli` 是 `fidoo` 可执行入口。它解析命令和配置，选择进程内 API、文本输出或 stdio + TUI，并把用户操作交给 AgentClient。

| 模式 | 用途 | 输出约束 |
| --- | --- | --- |
| TTY / `tui` | 本地交互编码 | Ink 独占终端输出 |
| `run --output text` | 人工阅读与脚本调用 | 正文 stdout，诊断 stderr |
| `run --output json` | 一次性机器结果 | 最终 RunSnapshot |
| `run --output jsonl` | 流式机器事件 | 每行一个公共事件 |
| `sessions/trace/doctor` | 历史、审计和环境检查 | 不启动无关模型请求 |

## 命令与配置解析

`config.ts` 合并命令行、环境变量和本地配置，解析 Provider、模型、Base URL、权限、数据目录和工作区。无效 cwd 或模型配置在创建任务前失败。

```bash
fidoo --provider deepseek --model deepseek-chat tui
fidoo run "修复失败测试" --output text
fidoo run "解释架构" --output json
fidoo sessions
fidoo trace <run-id>
fidoo doctor
```

`--read-only` 与 `--yes` 是显式权限模式。高风险命令不会因为使用 TUI 而绕过审批；无效策略文件也不会静默退回宽松配置。

## 公共事件输出

`output.ts` 将公共事件映射为 text、JSON 或 JSONL。文本模式把工具状态写 stderr，助手正文写 stdout；JSONL 保留机器可读事件并避免临时正文与完整消息重复输出。

退出码区分成功、失败、blocked 和取消。CI 不应解析人类可读颜色或 TUI 文本，而应使用 JSON/JSONL。

## TUI 与 sidecar 生命周期

TUI 模式创建 stdio sidecar，处理取消、退出、连接设置和主题保存。`tui-config.ts` 独立读写 `~/.fidoo/tui.json`，通过 `onThemeChange` 注入，保持 TUI 包不直接写配置文件。

CLI 拥有交互进程，但不拥有 Agent 领域状态。EventStore 与公共运行事件仍然是任务事实源。

当前 `run/resume` 可复用进程内 API；`cancel/sessions/trace` 仍有本地 EventStore 快捷路径。后续应统一迁移到公共 API，避免本地与远程语义分叉。

## CLI 启动与命令分发流程

`src/index.ts` 使用 Commander 注册全局选项和子命令。无子命令时根据 TTY 与配置决定 TUI 或帮助；`run` 走任务执行，`tui` 启动交互，`sessions/trace` 只读历史，`doctor` 输出环境诊断。

```text
process.argv
  → Commander options
  → resolveRuntimeConfig
  → LocalWorkspace / Policy / Model 预检
  → 文本 run、TUI 或只读命令
  → renderFinal + process.exitCode
```

文本任务先创建 Node Runtime、AgentApi、InProcessTransport 和 AgentClient，再启动 run 并消费事件。这样 CLI 与 TUI 使用同一 API 语义，而不是直接调用 AgentLoop。

## 配置优先级与校验细节

`resolveRuntimeConfig` 将显式选项交给 `resolveProviderConnection`，与 `FIDOO_*` 和已保存连接合并。模型缺失、Provider 必需 API Key 缺失都会给出具体环境变量提示。

额外校验包括：

- `--thinking` 只允许 DeepSeek，值只能是 enabled 或 disabled。
- `--yes` 与 `--read-only` 互斥。
- `--max-iterations` 必须是 1 到 200 的整数。
- cwd 通过 `resolve` 规范化，FIDOO_HOME 默认是 `~/.fidoo`。
- `allowUnconfigured` 仅供设置或诊断等无需模型的入口使用。

`serverArguments` 将最终配置显式传给 sidecar，包括 Base URL、策略、权限模式和 DeepSeek thinking。API Key 通过受控进程环境传递，不拼进命令参数和 Trace。

## 输出渲染分支

`renderPublicEvent` 在 JSONL 模式输出结构化事件，但跳过 `message.assistant.delta`，避免与完整助手消息重复。文本模式的工具提议、拒绝和结果写 stderr，正文 delta 写 stdout。

`renderFinal` 在 JSON 模式序列化最终 RunSnapshot；JSONL 不再额外写一行摘要。文本模式在结束后输出 runId 和终态，failed、blocked、cancelled 使用 stderr 和对应退出码。

这些分支保证 shell 管道可以只消费 stdout 正文，诊断仍可在终端看到。

## TUI 配置读写

`readTuiConfig` 在文件缺失时返回默认主题，存在时通过 `parseThemePreference` 严格校验。`writeTuiConfig` 创建权限受限目录，先写临时文件再 rename，防止异常退出留下半个 JSON。

主题错误不会修改 Agent 配置；Provider 设置与终端外观分别持久化。

## 源码阅读地图

| 文件 | 实现内容 |
| --- | --- |
| `src/index.ts` | 命令注册、参数解析、模式选择和退出码 |
| `src/config.ts` | Provider、模型、工作区、权限与环境变量解析 |
| `src/output.ts` | 公共事件到 text、JSON、JSONL 的渲染 |
| `src/tui-config.ts` | 终端主题配置的读取和原子保存 |

相关测试位于 `tests/cli/` 和 `tests/e2e/stdio-tui.test.tsx`，同时验证非 TTY 输出不受 Ink 污染。
