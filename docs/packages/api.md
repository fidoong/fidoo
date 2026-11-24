---
slug: api
name: "@fidoo/api"
path: packages/api
group: 核心与协议
order: 3
summary: 协调任务命令、审批、事件广播、幂等和公共 DTO 的应用服务。
description: API 层将 Core 包装成可被多种客户端消费的应用服务。它理解用例和订阅，却不理解 stdio、HTTP 或 React；所有连接生命周期都由外层应用负责。
keywords: AgentApi, RunCommandQueue, ApprovalBroker, EventHub, 幂等
dependencies: @fidoo/core, @fidoo/protocol
---

## 包职责与边界

`AgentApi` 是公共协议与 Core 之间的应用层。它拥有命令协调、执行实例、审批等待、事件映射和订阅恢复，但不关心请求来自内存函数还是 JSON-RPC。

外部通过 `AgentApiOptions` 注入 `createRunService`、EventStore、ArtifactStore、Workspace、Task 和 Settings 端口。更换 Provider 或存储不需要修改 API 分发。

## 请求编排与运行一致性

所有普通请求从 `AgentApi.call(method, params, requestId)` 进入。写命令先经过 `RequestResultCache`，再进入 `RunCommandQueue`。

```text
run.start / resume / steer / cancel / approval.respond
  → 校验 requestId 与参数指纹
  → 返回已缓存成功结果，或进入 per-run 队列
  → 执行命令
  → 仅缓存成功结果
```

- 同一 `requestId` 和相同参数得到相同成功结果。
- 同一 `requestId` 携带不同参数会明确失败。
- 失败不缓存，调用方可以修复后重试。
- 同一 run 的命令确定顺序，不同 run 可以并行。
- 队列只包围命令处理，不包围整个 Agent 执行。

`active` 保存真实 `AbortController`，`executions` 防止同一 run 出现两个执行实例。取消会中断模型与工具，而不是只写一条界面状态。

当前结果缓存是进程内实现，不能把它误认为服务崩溃后的持久幂等保证。

## 审批桥接

`ApprovalBroker` 实现 Core 的 `ApprovalPort`。工具需要审批时，Core 在 `approve()` 上等待；API 发布 `tool.approval_required`，客户端调用 `approval.respond` 后才解析对应 Promise。

审批以 `runId + callId` 定位，同一调用不能响应两次。客户端断开不会自动批准，审批也不会绕过 PolicyEngine 的硬拒绝规则。

## 事件广播与恢复

`EventHub` 只负责实时推送，EventStore 才是事实源。`streamEvents` 的关键是先订阅实时事件并缓冲，再读取历史：

```text
subscribe + buffer
  → load(runId)
  → 推送 seq > afterSeq 的持久事件
  → 缓冲事件去重并接入
  → 持续推送实时事件
  → 遇到终态关闭迭代器
```

这个顺序避免“历史读取完成前恰好追加新事件”导致漏消息。临时 delta 可以在缓冲后直接推送，但不能作为恢复依据。

`TaskHub` 使用独立异步迭代器广播后台任务启动与完成。关闭时先唤醒等待中的 `next()`，避免 `return()` 与 `next()` 相互等待。

## 公共事件映射

`event-mapper.ts` 是内部事件到公共 DTO 的唯一映射层，负责：

- `RunState` 到 `RunSnapshot` 和 `RunSummary`。
- 内部 `AgentEvent` 到 `PublicRunEvent`。
- 正文、推理和工具输出的临时通知。
- 限制敏感路径、大输出和原始推理历史进入公共协议。

内部事件可以增加实现细节，公共映射层负责维持客户端兼容；客户端不直接读取存储 JSONL。

## 进程内传输与测试

`InProcessTransport` 把 AgentClient 调用直接转给 AgentApi。它用于本地快捷路径和 contract test，不是另一套应用服务。

测试重点包括并发 resume、重复 requestId、多订阅者、审批一次响应、afterSeq 无遗漏、终态关闭、后台任务通知和进程内/stdio 语义一致。

## AgentApi 各方法实现明细

| 方法 | 参数校验与执行路径 | 返回与副作用 |
| --- | --- | --- |
| `workspace.validate` | `workspaceValidateParamsSchema` → WorkspacePort | 返回规范化路径或校验错误，不创建 run |
| `run.start` | request 幂等 → run 队列 → 新建 AbortController → RunService.start | 立即返回 runId；执行 Promise 在后台等待并持续发布事件 |
| `run.resume` | 读取状态、拒绝活跃实例、RunService.resume | 追加可选用户任务并恢复执行 |
| `run.steer` | 要求对应 active controller → RunService.steer | 写入待处理指导，下一安全边界生效 |
| `run.cancel` | run 队列 → AbortController.abort → 执行 Promise | 返回取消后的公共快照 |
| `run.get` | EventStore.load → replayRun | 返回最新公共快照，不启动执行 |
| `run.list` | EventStore.list | 按公共 Summary 映射会话 |
| `run.trace` | EventStore.load | 返回映射后的公共持久事件 |
| `approval.respond` | 参数 Schema → 幂等/队列 → ApprovalBroker.respond | 只解析指定 pending 调用 |
| `artifact.read` | ArtifactStore.read | 按受限 id 和分页参数读取 |
| `task.list/output/stop` | AgentTaskPort | 查询、分页读取或停止真实进程组 |
| `settings.get/update/models` | AgentSettingsPort | 读取、替换 RunService 工厂或发现模型 |

`settings.update` 成功后替换 `runService` 字段，新任务使用新连接；已开始任务仍由原执行实例完成，避免中途改变模型上下文语义。

## RequestResultCache 内部实现

缓存键是 `method:requestId`，参数指纹是 `JSON.stringify(params)`。 entry 同时保存 Promise 和 settled 标记，因此并发的相同请求在第一次完成前也共享同一 Promise，而不是重复执行。

只有成功 Promise 被保留；失败时仅当 Map 中仍是同一个 entry 才删除，避免旧失败误删新请求。容量默认 1000，超过后按插入顺序淘汰已 settled 项，未完成项不会被驱逐。

该实现解决连接重试和重复响应，不提供跨服务进程崩溃后的持久幂等；持久化幂等需要把 requestId 结果写入独立存储。

## RunCommandQueue 与失败隔离

队列按 runId 保存 Promise 尾链。新命令接在上一命令的 settled 结果之后，因此上一命令抛错不会毒化后续队列。空闲后删除对应尾链，避免长时间使用积累空 run 键。

并发恢复同一 run 时，除了命令顺序还检查 active executions；已经在执行的 run 不会创建第二个 AgentLoop。

## EventHub 与 PublicEventStream

`EventHub.publish` 更新每个 run 已见到的最大 seq，再同步通知监听器；`publishTransient` 只通知，不推进持久序号。`sequence(runId)` 为 delta 提供当前位置，但不把 delta 变成可恢复事件。

`PublicEventStream` 是单消费者有界语义由调用方控制的异步队列：

- 有等待中的 `next()` 时，`push()` 直接解析该 Promise。
- 没有等待者时进入数组队列。
- `close()` 设置 closed 并唤醒等待者返回 done。
- 关闭后的 push 被忽略，防止终态之后继续输出。

`AgentApi.subscribe` 返回显式 iterator 包装，`return/throw` 都先关闭 stream，再终止内部迭代器，确保订阅监听器被释放。

## ApprovalBroker 取消与重复响应

`approve()` 创建 pending entry，并监听 AbortSignal。取消时等待者得到拒绝结果并清理 pending，不让 Promise 永久悬挂。`respond()` 找不到 callId 时抛配置错误，重复响应不会再次改变工具执行。

审批原因和决定由 AgentLoop 写入 `tool.decided`，Broker 本身不写事件，保持职责单一。

## 源码阅读地图

| 文件 | 实现内容 |
| --- | --- |
| `src/agent-api.ts` | 公共方法分发、执行实例、订阅和任务协调 |
| `src/run-command-queue.ts` | 按 run 串行、跨 run 并行的命令队列 |
| `src/request-result-cache.ts` | 基于 requestId 的成功结果幂等缓存 |
| `src/approval-broker.ts` | 跨客户端审批等待、响应与拒绝 |
| `src/event-hub.ts` | 运行事件广播、临时通知与异步流 |
| `src/event-mapper.ts` | 内部事件到公共 DTO 的唯一映射层 |
| `src/task-hub.ts` | 后台任务全局通知订阅 |
