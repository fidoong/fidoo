---
slug: protocol
name: "@fidoo/protocol"
path: packages/protocol
group: 核心与协议
order: 2
summary: 跨进程共享的 DTO、Zod Schema、方法名和事件契约。
description: Protocol 是客户端与服务端之间的稳定语言。它将内部领域事件与公共 API 解耦，让进程内调用、stdio 和未来的远程传输保持相同输入、输出和错误语义。
keywords: JSON-RPC, DTO, Zod, 公共事件, 协议版本
dependencies: zod
---

## 包职责与边界

Protocol 只保存公共契约，不执行任务、不启动进程，也不引用 Core 的内部事件类型。调用方同时获得 TypeScript 类型和运行时 Zod 校验，避免跨进程数据只靠类型断言。

公共协议版本 `PROTOCOL_VERSION` 与内部事件 `EVENT_SCHEMA_VERSION` 分开演进。前者约束客户端兼容性，后者约束本地持久事件格式。

## 方法与 DTO

`methods.ts` 定义工作区、运行、审批、Artifact 和设置接口；`tasks.ts` 定义后台任务。每个方法都有明确的参数 Schema 与结果 Schema。

```ts
export const runStartParamsSchema = z.object({
  task: z.string().min(1),
  cwd: z.string().min(1),
});

export const runSnapshotSchema = z.object({
  runId: z.string(),
  status: z.enum(["running", "completed", "failed", "blocked", "cancelled"]),
  changedFiles: z.array(z.string()),
  verified: z.boolean(),
});
```

主要方法包括：

| 方法组 | 方法 | 用途 |
| --- | --- | --- |
| Workspace | `workspace.validate` | 在模型请求前验证工作区 |
| Run | `start/resume/steer/cancel/get/list/trace` | 任务生命周期与历史 |
| Subscription | `run.subscribe` | 从 `afterSeq` 恢复并持续订阅 |
| Approval | `approval.respond` | 对指定 `runId + callId` 做出一次决策 |
| User input | `input.respond` | 提交 `request_user_input` 的结构化答案 |
| Artifact | `artifact.read` | 分页读取受限大输出 |
| Task | `task.list/output/stop/subscribe` | 管理持久后台任务 |
| Settings | `settings.get/update/models` | 读取连接、更新设置、发现模型 |

## JSON-RPC 与传输语义

本地 stdio 使用 JSON-RPC 2.0 信封，每行一条完整消息。请求必须同时携带 `protocolVersion` 和 `requestId`，事件通知使用 `method` 与 `params`。

```json
{
  "jsonrpc": "2.0",
  "protocolVersion": "v1",
  "requestId": "req-1",
  "method": "run.start",
  "params": {
    "cwd": "/workspace",
    "task": "修复失败测试"
  }
}
```

`AgentTransport` 只要求 `call` 与 `subscribe`，另有可选连接状态监听。进程内、stdio 和未来 HTTP 适配器都必须遵守同一接口，不能把某个传输的私有字段泄露到视图层。

## 持久事件与临时通知

公共运行事件保留 `runId`、`seq` 和 `eventId`，用于去重、恢复和排序。以下 delta 属于临时通知：

- `message.assistant.delta`：正在生成的正式正文。
- `message.reasoning.delta`：默认不进入持久历史的推理预览。
- `tool.output.delta`：命令 stdout/stderr 的实时片段。

客户端必须能只依靠 `run.get` 和持久事件重建正确界面。`isTransientRunEvent` 与 `isTerminalRunEvent` 统一临时事件和订阅终态判断。

后台任务使用全局 `task.event`，不占用任何 run 的序号，因此任务通知与主运行恢复可以独立处理。

## 新增公共方法的步骤

1. 在 `methods.ts` 或对应领域文件中声明参数和结果 Schema。
2. 导出推导类型，并把方法名加入 `API_METHODS`。
3. 在 API 层实现分发和权限语义。
4. 在 Client 添加类型化方法并解析响应。
5. 同时补进程内与 stdio contract test。

不要先让某个界面发送私有字段再补协议；这会破坏多端共享同一语义的目标。

## 公共 DTO 字段明细

`RunSnapshot` 是客户端恢复时使用的最小任务视图：`runId`、原始 `task`、规范化 `cwd`、状态、改动文件数组、是否验证、最终摘要与错误。它不包含内部 Map、完整消息历史或工具私有对象；需要历史时分别调用 `run.trace` 或订阅事件。

`RunSummary` 面向会话列表，额外提供 `createdAt` 和 `updatedAt`。`ArtifactReference` 只暴露内容哈希形式的 id、名称与字节数；`ArtifactPage` 增加 offset、limit、totalLines、content 和可选 nextOffset。

`ProviderSettings` 与设置更新参数位于 `providers.ts`，公共设置只包含界面需要展示的连接状态。API Key 只用于更新输入，不应作为查询结果回显。`modelContextWindow` 和 `modelContextBudget` 按 Provider/模型计算上下文窗口，默认预留 8192 个输出 token，并允许用户预算进一步收紧；未知 custom 模型保守使用 100K 窗口。

## 公共事件清单

| 分类 | 事件 | 客户端用途 |
| --- | --- | --- |
| 运行 | `run.started/resumed/steered` | 建立或恢复任务上下文 |
| 消息 | `message.user/assistant` | 追加持久消息 |
| 模型 | `model.usage` | 按 iteration 累计总输入、输出、普通输入、缓存读取和缓存写入 Token |
| 上下文 | `context.compacted` | 展示历史压缩并恢复视图状态 |
| 计划 | `plan.updated` | 渲染真实步骤、revision 和证据 |
| 工具 | `tool.proposed/approval_required/decided/started/result` | 工具卡片、审批、输出与改动 |
| 验证 | `verification.requested/finished` | 验证状态和结构化结果 |
| 终态 | `run.completed/failed/blocked/cancelled` | 结束订阅并恢复输入 |

`tool.decided` 当前是内部事件到公共映射中用于展示审批决策的数据之一；客户端不能把它当作执行结果，真正结果仍以 `tool.result` 为准。

## JSON-RPC 错误与关闭语义

`json-rpc.ts` 定义标准 `code`、`message` 和可选 `data`。服务侧使用 -32700 表示解析失败、-32600 表示无效请求、-32601 表示方法不存在；Zod 校验失败转换为参数错误，AgentError 的类别与可恢复信息放入扩展数据。

请求 ID 在同一个活跃连接中不能重复。订阅请求先返回 subscriptionId，之后的事件通知通过该 ID 找到本地迭代器。`subscription.close` 是通知而非任务命令，因此没有响应，也不会取消模型。

## Schema 兼容与演进纪律

新增可选字段通常向后兼容，修改字段含义、删除字段或放宽服务端而旧客户端仍严格校验都可能破坏兼容。Zod 默认对象策略与具体 Schema 必须一起评审，不能只依靠 TypeScript 编译通过。

`publicRunEventSchema` 在 Client 订阅入口再次解析，形成“服务端映射 + 客户端校验”双边界。内部事件增加字段时，应先决定它是否属于公共协议，而不是直接导出整个内部对象。

协议测试应覆盖默认值，例如 `afterSeq=0`、`run.list limit=50`、Artifact 最大分页 1000，以及无效 ID、越界分页和缺失必需字段。

## 源码阅读地图

| 文件 | 实现内容 |
| --- | --- |
| `src/methods.ts` | 公共方法参数、结果 DTO 与 Zod Schema |
| `src/events.ts` | 公共运行事件、临时通知和终态判断 |
| `src/json-rpc.ts` | JSON-RPC 2.0 请求、响应、通知与错误结构 |
| `src/transport.ts` | 传输接口、订阅方法和连接状态 |
| `src/tasks.ts` | 后台任务元数据、输出分页和全局事件 |
| `src/providers.ts` | Provider 定义、模型设置和连接参数 |

协议行为由 `tests/api/in-process.test.ts` 与 `tests/api/stdio.test.ts` 跨传输验证。
