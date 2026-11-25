# Fidoo 项目工程说明

Fidoo 是一个面向本地 AI 编程的 TypeScript monorepo。终端界面、公共协议、应用服务、Agent 内核和 Node 基础设施分别位于独立包中。本文是项目级入口；具体实现进入对应的包文档。

## 一次任务如何完成

一次运行从 `run.start` 开始，以持久事件为事实源。界面只能提交命令和展示事件，不能自行决定任务已经成功。

1. **表达任务**：CLI 或 TUI 通过 AgentClient 提交 `task` 与 `cwd`，服务端返回 `runId`。
2. **构建上下文**：Core 组合系统提示、项目 `AGENTS.md`、真实计划、历史消息和工具 Schema；持久对话与每轮临时 harness 分离，稳定前缀用于 Provider 缓存复用。
3. **模型决策**：Provider 适配器把中立请求转换为厂商请求，流式正文与推理使用临时通知。
4. **工具执行**：PolicyEngine 先决定允许、审批或拒绝，ToolScheduler 再按并发语义执行。
5. **持久事实**：工具结果、文件改动、计划和模型用量按连续 `seq` 写入 EventStore。
6. **真实验证**：改动后执行相关测试和项目 required checks，记录命令、类型、退出码、耗时和失败分类。
7. **可信完成**：只有最新适用检查通过才进入 `run.completed`，最终摘要引用真实验证证据。

```text
CLI / TUI / 其他客户端
        │ AgentClient + Protocol
        ▼
AgentApi：命令队列、审批、订阅、幂等
        │ RunService + 端口
        ▼
Agent Core：上下文、ReAct、状态、验证
        │ 端口实现
        ▼
Node Runtime：Provider、工具、存储、后台任务
```

## 架构分层与依赖规则

| 层级 | 包 | 核心责任 |
| --- | --- | --- |
| 体验层 | `apps/cli`、`packages/tui`、`apps/observability` | 参数、交互、视图投影 |
| 契约层 | `packages/client`、`packages/protocol` | SDK、DTO、Schema、传输语义 |
| 应用层 | `packages/api`、`apps/agent-server` | 用例协调、审批、广播、sidecar |
| 领域层 | `packages/core` | 任务状态机、执行循环、权限与验证 |
| 基础设施层 | `packages/node-runtime`、`packages/observability` | 厂商模型、工具、存储和观测投影 |

依赖必须保持单向：

```text
apps/cli ───────────────► client ─► protocol
packages/tui ───────────► client ─► protocol
apps/agent-server ──────► api ────► core
       │                              ▲
       └──────────────► node-runtime ─┘
```

禁止出现 `core → api/client/tui`、`client → node-runtime` 或 `tui → core/node-runtime`。Node 专用 stdio 连接通过 `@fidoo/client/stdio` 子路径导出，避免浏览器携带进程实现。

## 事件与恢复模型

持久事件使用 `runId + seq + eventId`，EventStore 是唯一事实源。`message.assistant.delta`、`message.reasoning.delta` 和 `tool.output.delta` 是临时通知，不承诺重放。

断线恢复的顺序是：获取 `run.get` 快照，读取 `afterSeq` 之后的持久事件，再接入实时通知。API 在读取历史前先缓冲新事件，避免历史与实时流之间出现空窗。进程中断时未闭合的工具调用进入对账，不自动重放可能已产生副作用的操作。

后台任务使用独立的 `task.event`，不占用 run 的序号；因此主任务完成后，开发服务器退出等通知仍然可以到达界面。

## 权限与安全边界

权限配置依次来自内置策略、`~/.fidoo/policy.json`、项目 `fidoo.policy.json`、显式 `--policy` 和 CLI 模式。最后匹配的规则优先，但 `read-only` 是不能被规则放宽的硬边界。

- 项目配置只能收紧权限，不能通过项目文件开启 `auto` 或添加 `allow`。
- 文件工具限制工作区路径、拒绝敏感文件，并使用 revision 乐观锁与原子写入。
- Bash 不经过 shell，直接执行 `command + args`；它不是操作系统沙箱。
- 获批命令仍拥有当前用户的操作系统权限，不可信代码需要容器或系统级隔离。

详细规则见 `docs/permissions.md`。

## 可信验证配置

项目根目录可通过 `.fidoo.json` 声明必需检查。`paths` 按改动文件选择适用范围；同一检查的最新失败会覆盖旧通过记录。

```json
{
  "verification": {
    "requiredChecks": [
      {
        "id": "unit",
        "command": "pnpm",
        "args": ["test"],
        "timeoutMs": 120000,
        "paths": ["src/**", "tests/**"]
      },
      {
        "id": "types",
        "command": "pnpm",
        "args": ["typecheck"],
        "paths": ["src/**"]
      }
    ]
  }
}
```

普通改动至少需要改动后的相关验证；配置 required checks 后，适用检查必须逐一通过。验证失败会区分为测试、类型、Lint、构建、环境、命令或超时问题。

## 本地开发与标准检查

```bash
pnpm install
pnpm dev --provider deepseek --cwd /path/to/project tui
pnpm dev:observability
pnpm docs:dev
```

完整回归命令：

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm eval:offline
```

`pnpm dev` 是保存后构建并重启的热重启流程，不是保留界面状态的 React HMR。文档站点使用 Vite 开发服务器，内容和样式保存后自动更新。

## 关键场景端到端实现

### 修改一个已存在文件

1. 模型调用 `read_file`，Node Runtime 校验路径并返回内容与 revision。
2. `edit_file` 检查 expected_revision、唯一匹配和真实父目录，再原子替换文件。
3. 工具结果带 changedFiles，Core 写入 `tool.result` 并推进 lastMutationSeq。
4. API 映射公共事件，TUI 更新工具卡片与文件数，Observability 建立工具 Span。
5. 模型给出完成回答时，验证门禁检查最新改动后的真实验证。
6. 缺少验证则写 `verification.requested` 并继续下一轮；通过后完成事件携带 results。

### 执行需要审批的 Bash

1. PolicyEngine 对 Bash 动态分级：识别验证命令为 medium，其他命令默认 high，再应用最后匹配规则。
2. ask 模式下需要审批，AgentLoop 写 `tool.approval_required` 并等待 ApprovalPort。
3. API ApprovalBroker 保存 pending Promise，TUI 只显示公共审批请求。
4. 用户按 y/n 后调用 `approval.respond`，Broker 解析指定 callId。
5. AgentLoop 写 `tool.decided`；批准后执行，拒绝则生成错误工具结果。
6. 取消信号同时中断等待与活跃进程，客户端断开不会自动批准。

### sidecar 崩溃后恢复

1. StdioTransport 检测到子进程退出，拒绝 pending 并结束订阅。
2. ReconnectingStdioTransport 进入 reconnecting，清理旧连接并指数退避启动新 sidecar。
3. TUI 清除临时正文、推理和失效审批，但保留已持久历史。
4. 新连接 generation 递增，同一 run 的多个订阅共享一次恢复。
5. Client 调用 run.get；若仍为 running，则 run.resume 让新 Runtime 对账并接管。
6. 订阅从最大 afterSeq 继续，EventStore 与 API 缓冲共同保证不丢持久事件。

### 启动开发服务器

1. Agent 调用 `bash(background=true)`，BackgroundTaskManager 创建独立进程组和任务目录。
2. 元数据写 task.json，stdout/stderr 追加 output.log，API 发布全局 task.started。
3. 主 Agent run 可以继续完成，后台任务不受其终态影响。
4. TUI 通过 task.subscribe 刷新任务数，收到退出通知时展示 exitCode。
5. `task_output` 分页读取日志，`task_stop` 停止整个进程组并持久 stopped。

## 模型前缀缓存与成本指标

Core 将请求拆为稳定 system/tools、只追加的持久 `messages` 和每轮临时 `runtimeMessages`。工具 Schema 只生成一次，模型请求携带静态、会话和完整请求哈希；哈希仅用于诊断，不代表服务端实际命中。

Provider 适配器统一返回总输入、普通输入、缓存读取、缓存写入和输出 token。OpenAI/DeepSeek 使用自动缓存，Anthropic 使用 system 与最后一条持久消息的显式缓存断点，Gemini 采集隐式缓存用量。TUI `/status` 和 Observability 按累计 token 计算缓存命中率，同时保留缓存写入量，避免用高命中率掩盖总成本上升。

## 本地数据与文件布局

默认数据目录是 `~/.fidoo`，可用 FIDOO_HOME 覆盖。运行事件、Artifact、后台任务、Provider 设置、权限和 TUI 主题分别保存，界面不会把全部内容塞进一个状态文件。

| 数据 | 逻辑位置 | 说明 |
| --- | --- | --- |
| Run events | 数据目录下的运行事件 JSONL | 带连续 seq 和唯一 eventId，是任务事实源 |
| Event lock | 每个 run 对应锁文件 | 跨进程追加互斥与遗留锁恢复 |
| Artifacts | 内容寻址 Artifact 存储 | 保存大工具输出，按行分页读取 |
| Background tasks | `tasks/<taskId>/task.json` | 进程、状态、时间和退出码 |
| Background output | `tasks/<taskId>/output.log` | 持续追加 stdout/stderr |
| Provider connection | 数据目录中的模型连接配置 | 由 Node Runtime 管理，不进入公共 Trace |
| Permission policy | 用户或项目策略 JSON | 决定 allow/ask/deny，不是系统沙箱 |
| TUI theme | `~/.fidoo/tui.json` | 由 CLI 原子写入，与 Agent 设置分离 |

## 扩展工具与交互能力

除基础读取、编辑和 Bash 外，当前运行时还提供以下能力：

| 能力 | 工具与实现约束 |
| --- | --- |
| 原子多文件修改 | `apply_patch` 预校验全部 revision，写入失败回滚 |
| 重构文件操作 | `move_file`、`delete_file` 保留路径、revision 和变更记录 |
| 变更审查 | `workspace_status`、`workspace_diff` 使用快照，不依赖 Git |
| 安全撤销 | `undo_file`、`undo_run` 检测外部修改并要求高危审批 |
| 项目检查 | `run_required_checks` 按影响范围执行并返回多条结构化证据 |
| 用户澄清 | `request_user_input` 通过 `input.respond` 和 TUI 问答组件完成 |
| 图片理解 | `read_image` 使用 Artifact 引用和 Provider 多模态消息 |
| 只读子代理 | `delegate_task` 使用独立 runId、上下文和只读工具集 |
| 批量与目录读取 | `read_many_files`、`list_directory` 减少重复探索调用 |
| 联网信息 | `web_search` 支持 Tavily/Brave/SearXNG，`web_fetch` 读取选定的公开 URL |

WebSearch 的 Key 只从 `FIDOO_SEARCH_API_KEY` 等受控环境输入，项目配置只保存 provider 与 baseURL。WebFetch 默认拒绝 localhost、私网、非 HTTP(S)、非文本和超大响应。真实在线搜索与 Provider 多模态仍需按环境做冒烟验收，离线测试使用模拟 HTTP 服务。

## 当前范围与后续方向

当前优先完善 Agent + TUI。文档 Web 与只读 Observability 不代表 Agent Web 控制台；HTTP + SSE、Agent Web 和 Desktop 仍暂缓。子 Agent 当前只用于只读研究，不允许嵌套 delegation、写入或命令执行。

后续核心工作包括多场景真实编程评测、错误完成率与 Token 指标、模型匹配的 tokenizer、仓库语义索引、可选 Git worktree 和操作系统沙箱。完整优先级见 `docs/core-hardening-plan.md`。
