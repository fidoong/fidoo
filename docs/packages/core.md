---
slug: core
name: "@fidoo/core"
path: packages/core
group: 核心与协议
order: 1
summary: 与 Node、Provider 和界面无关的 Agent 领域模型与执行内核。
description: Core 定义任务状态、事件溯源、ReAct 循环、工具端口、权限决策、上下文预算和验证门禁。它只表达“应该怎样运行”，具体模型、文件系统和终端能力全部由端口注入。
keywords: AgentLoop, RunService, 事件溯源, ReAct, 验证, 状态机
dependencies: zod
---

## 包职责与边界

Core 是唯一不依赖具体传输、厂商 SDK、React 或 Node 文件系统的执行内核。它包含 `domain`、`application`、`context`、`ports` 和 `runtime` 五组代码。

- `domain` 定义事件、消息、计划、运行状态和验证证据。
- `application` 实现任务服务与 AgentLoop。
- `context` 构建模型请求，管理项目指令与上下文预算。
- `ports` 声明需要外部环境实现的能力。
- `runtime` 提供工具注册、调度、权限、重试和循环检测。

Core 不直接追加 JSONL、不启动 Bash、不等待终端键盘，也不读取 Provider 私有响应。

## 领域模型与事件溯源

`AgentEvent` 使用 `schemaVersion`、`eventId`、`runId`、`seq`、`timestamp`、`type` 和 `payload`。所有会改变任务事实的动作都先形成事件，再归约到 `RunState`。

```ts
export interface RunState {
  runId: string;
  status: "running" | "completed" | "failed" | "blocked" | "cancelled";
  messages: Message[];
  calls: Map<string, ToolCall>;
  results: Map<string, ToolResultEvent>;
  changedFiles: Set<string>;
  verifications: RecordedVerification[];
}
```

`replayRun` 要求序号从 1 开始且严格连续。恢复会话时不是读取另一份快照数据库，而是重放同一事件序列；这使 Trace、TUI 恢复和公共快照可以共享状态语义。

`reduceEvent` 处理消息固化、计划更新、工具结果、文件改动、验证证据和终态。`context.compacted` 也会重建消息列表，因此压缩后的上下文能够跨进程恢复。

## AgentLoop 执行实现

`RunService` 创建和恢复任务，`AgentLoop.run` 逐轮执行。每一轮先处理 Steering，再构建请求并流式调用模型；有工具调用时进入调度器，无工具调用时进入完成门禁。

```text
flushSteering
  → buildModelRequest
  → model.started → model.stream → model.completed
  → message.assistant
  → ToolScheduler.schedule
  → tool.proposed / decided / started / result
  → verificationReport
  → run.completed 或 verification.requested
```

`appendChain` 串行化事件追加。`steer()` 与正常循环共享这条写入链，避免并发产生重复 `seq`。Steering 先写 `run.steered`，对应用户消息等到当前 assistant 与工具结果闭合后再写入，保持消息单元完整。

`RunService.reconcileInterruptedCalls` 为上次进程退出前未闭合的调用补充错误结果，明确“没有自动重放”。模型恢复后必须先检查真实工作区，再决定下一步。

## 工具调度与权限

`ToolDefinition` 同时描述输入 Schema 和执行元数据：

```ts
const tool = defineTool({
  name: "example",
  inputSchema,
  effect: "read",
  risk: "low",
  concurrency: "safe",
  idempotency: "always",
  async execute(input, context) {
    return { summary: "Read complete", content: "..." };
  },
});
```

`PolicyEngine` 根据权限模式、工具选择器、路径、命令和风险返回 `allow`、`ask` 或 `deny`。`ApprovalPort` 将等待审批抽象成异步接口。

`ToolScheduler` 允许 `safe` 工具并行，`exclusive` 工具互斥。某个调用导致阻塞后，仍在队列中的工具会跳过，避免 `report_blocked` 后继续写入。

## 可信验证门禁

`verification.ts` 识别测试、类型检查、Lint、构建和通用检查命令，并生成结构化证据。`run-state.ts` 中的 `verificationReport` 同时处理普通验证与项目 required checks。

```ts
interface VerificationEvidence {
  command: string;
  exitCode: number;
  kind: "test" | "typecheck" | "lint" | "build" | "check";
  status: "passed" | "failed" | "timeout";
  durationMs: number;
  checkId?: string;
  failure?: "environment" | "timeout" | "command" | VerificationKind;
}
```

只有最新改动之后的最新结果才能满足门禁。required checks 可按 `paths` 选择适用范围，无关命令不能替代指定检查。模型提前给出最终回答时，AgentLoop 写入 `verification.requested`，将缺失检查送回下一轮；连续未完成会进入可恢复的失败状态。

完成事件携带 `results`，最终摘要补充真实命令、状态和耗时，而不是只写“验证通过”。

## 上下文与扩展点

`context-builder.ts` 按完整消息单元裁剪历史，assistant 工具调用与对应 tool results 必须一起保留或移除。原始任务、真实计划、最近轮次和 harness 状态优先保留；固定上下文本身超过预算时明确失败。

新增模型、存储或审批方式时实现对应 Port，不要在 Core 中 import 厂商 SDK。新增工具时定义 ToolDefinition，并由外部 Runtime 注册。

## 核心模块逐项说明

下表按真实源码列出模块职责。阅读某个功能时，应先确定它属于领域规则、应用编排还是外部端口，避免把适配器逻辑放进 Core。

| 模块 | 关键入口 | 实现职责与边界 |
| --- | --- | --- |
| `domain/events.ts` | `createEvent`、`EVENT_TYPES` | 定义全部内部事件联合类型；创建事件时自动附带 `schemaVersion` |
| `domain/run-state.ts` | `emptyRunState`、`reduceEvent`、`replayRun` | 建立空状态、逐事件归约、校验连续序号并重建运行 |
| `domain/messages.ts` | `Message`、`ToolObservation` | 定义 Provider 中立消息和工具观察；验证证据引用独立结构 |
| `domain/plan.ts` | `TaskPlan`、`TaskPlanUpdate` | 稳定计划 id、revision、步骤状态和完成证据 |
| `domain/errors.ts` | `AgentError`、`errorMessage` | 统一配置、Provider、预算、工具、存储等错误类别与可恢复标记 |
| `domain/verification.ts` | `classifyVerification`、`verificationMatchesCheck` | 命令识别、失败分类、required check 精确匹配和路径筛选 |
| `application/run-service.ts` | `start`、`resume`、`cancel` | 校验工作区、写初始事件、管理活跃 Loop、恢复中断调用 |
| `application/agent-loop.ts` | `run`、`steer`、`nextAssistant`、`complete` | 模型轮次、工具批次、Steering、验证门禁和终态 |
| `context/context-builder.ts` | `buildModelRequest` | 工具 Schema 转换、Token 估算、完整消息单元裁剪和压缩事件 |
| `context/project-instructions.ts` | `loadProjectInstructions` | 读取项目 `AGENTS.md`，缺失时不注入空指令 |
| `context/system-prompt.ts` | `withProjectInstructions` | 组合基础协议、required checks 和仓库指令 |
| `runtime/tool-registry.ts` | `ToolRegistry` | 注册时拒绝重复工具名，向模型和调度器提供同一工具集合 |
| `runtime/tool-scheduler.ts` | `schedule` | safe 工具共享读取通道，exclusive 工具进入互斥链 |
| `runtime/policy-engine.ts` | `evaluate` | 动态 Bash 风险、反向规则匹配和默认模式决策 |
| `runtime/permission-config.ts` | `permissionConfigSchema` | 严格校验策略字段，要求每条规则至少有一个选择器 |
| `runtime/loop-detector.ts` | `record` | 按工具名和参数识别连续重复调用，达到阈值后返回诊断 |
| `runtime/retry.ts` | `withRetry`、`backoffDelay` | 按可重试判断执行操作，支持 Retry-After 与指数退避 |
| `runtime/plan-tool.ts` | `updatePlanTool` | 校验最多一个 in_progress，保留稳定步骤 id，返回 `planUpdate` |

## 事件状态转移明细

`reduceEvent` 是唯一的 RunState 写入口。事件追加到 Store 成功后，AgentLoop 才调用它更新内存；Store 失败时不会先让界面看到一个未持久化的正式状态。

| 事件 | 对 RunState 的修改 |
| --- | --- |
| `run.started` | 保存原始 task 与规范化 cwd |
| `run.resumed` | 状态回到 running，清除旧 finalSummary 和 error |
| `message.user` | 追加用户消息；若有 steeringId，则从待处理 Steering 队列删除 |
| `message.assistant` | 追加完整助手消息，流式 delta 不在此处存储 |
| `context.compacted` | 用摘要和指定数量的最近消息替换当前消息列表 |
| `plan.updated` | 替换为最新 revision 的完整计划 |
| `tool.proposed` | 按 callId 保存原始调用，供恢复时识别未闭合副作用 |
| `tool.result` | 保存结果、追加 ToolMessage、累计 changedFiles 和 verifications |
| `verification.requested` | 增加 attempt，并追加 source=harness 的用户消息 |
| `run.completed` | 设置 completed 和 finalSummary |
| `run.failed/cancelled` | 设置终态和 error |
| `run.blocked` | 设置 blocked，同时记录 finalSummary 与 error |

`tool.result` 中只要存在 `changedFiles` 就推进 `lastMutationSeq`；验证证据无论成功失败都进入 `verifications`。这样最新失败不会被旧成功覆盖。

## 上下文裁剪算法细节

`buildModelRequest` 每轮先把 ToolRegistry 中的 Zod Schema 用 `z.toJSONSchema` 转为模型工具参数，再追加一条 harness 消息。Harness 包含工作区、改动文件、是否需要验证、当前计划和剩余迭代数。

Token 当前采用 `JSON.length / 4` 的中立估算，而非厂商 tokenizer。估算同时计入系统提示、工具 Schema 和消息，避免只裁剪正文却忽略工具定义。

超预算时执行以下步骤：

1. 用 `messageUnits` 把带 toolCalls 的 assistant 与其连续 ToolMessage 绑定为同一单元。
2. 从最新单元向前尝试保留，候选始终包含压缩摘要和 harness。
3. 如果候选超预算则停止向前扩展，再从最旧保留单元继续收缩。
4. 摘要保留原始任务、当前计划和省略数量。
5. 如果一条都没有省略，或固定系统/工具/最新调用链仍超预算，抛出可恢复的 budget 错误。

这保证模型不会看到“assistant 发起了调用，但对应工具结果被单独裁掉”的破损协议。语义摘要目前主要保存任务与计划，还没有完整提炼所有历史决策，这是后续长会话增强点。

## 完成、失败与取消路径

`complete()` 在写完成事件前后都检查 Steering 版本。如果最终响应期间收到新指导，本轮不能直接完成，必须再进入模型轮次。

- 无改动且无需适用检查：写入 `verification.finished`，完成原因为 not-required。
- 有改动且检查通过：完成事件包含真实 `results`。
- 检查缺失或最新失败：写 `verification.requested`，最多两次完成后拒绝。
- 超过最大迭代：写可恢复 `run.failed`，不是静默停在 running。
- AbortSignal 触发：活跃 run 由 AgentLoop 写 `run.cancelled`。
- `report_blocked` 成功执行：写 `run.blocked`，后续排队工具不再执行。

## 端口调用契约

`ModelPort.stream` 返回 AsyncIterable，事件包括 text、reasoning、usage 和 message.completed。Provider 流结束却没有完整消息，或完整消息正文与工具调用均为空，AgentLoop 会明确判定 Provider 失败。

`EventStore.append/load/list` 分别负责追加、单 run 重放和会话列表；`ArtifactStore.save/read` 负责大输出的保存与分页；`WorkspacePort.assertDirectory` 在任务事件创建前返回规范化目录；`ApprovalPort.approve` 必须响应取消信号。

这些接口是适配器契约，不允许把 Node 的 `Buffer`、厂商 SDK 响应或 React 状态加入 Core 公共类型。

## 源码阅读地图

| 文件 | 实现内容 |
| --- | --- |
| `src/application/agent-loop.ts` | ReAct 主循环、Steering、事件追加与完成门禁 |
| `src/application/run-service.ts` | 创建、恢复、取消和中断工具对账 |
| `src/domain/run-state.ts` | Canonical RunState、事件重放和验证报告 |
| `src/domain/verification.ts` | 检查识别、required checks 匹配和结构化证据 |
| `src/context/context-builder.ts` | 模型请求、消息单元裁剪和上下文预算 |
| `src/runtime/tool-scheduler.ts` | 读取并行、写入互斥与阻塞后的调度 |
| `src/runtime/policy-engine.ts` | 工具风险、规则匹配和权限决策 |
| `src/ports/` | 模型、存储、审批、工作区与工具抽象 |

重点测试位于 `tests/application/agent-loop.test.ts`、`tests/domain/run-state.test.ts`、`tests/domain/verification.test.ts` 和 `tests/application/tool-scheduler.test.ts`。
