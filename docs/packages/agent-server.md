---
slug: agent-server
name: "@fidoo/agent-server"
path: apps/agent-server
group: 运行与基础设施
order: 9
summary: 将 AgentApi 暴露为本地 stdio JSON-RPC sidecar 服务。
description: Agent Server 是协议传输与进程宿主。它创建 Node Runtime 和 AgentApi，把每行 JSON 转成方法调用或订阅，并保证 stdout 只承载协议消息。
keywords: sidecar, stdio, JSON-RPC, NDJSON, 订阅
dependencies: @fidoo/api, @fidoo/core, @fidoo/node-runtime, @fidoo/protocol, commander, zod
---

## 包职责与启动方式

Agent Server 把独立的 AgentApi 宿主到本地子进程中。它负责 JSON 解析、协议错误、请求分发、订阅泵和关闭，不实现 ReAct 或工具规则。

```bash
node apps/agent-server/dist/index.js \
  --provider deepseek \
  --cwd /path/to/project \
  --stdio
```

默认只使用 stdin/stdout，不开放网络端口。stdout 仅传 JSON-RPC，所有日志必须写 stderr，否则 Client 的 NDJSON 分帧会被破坏。

## NDJSON 请求处理

`StdioServer` 使用 `readline` 接收完整行，`handleLine` 依次处理空行、JSON 解析、订阅关闭、协议校验、重复 requestId 和方法分发。

```text
line
  → JSON.parse
  → subscription.close? → 关闭指定迭代器
  → jsonRpcRequestSchema.parse
  → run.subscribe / task.subscribe? → openSubscription
  → api.call(method, params, requestId)
  → result 或标准 JSON-RPC error
```

解析错误、协议版本不兼容、无效参数、未知方法和重复 requestId 都有明确错误。请求可以并发处理，响应通过 requestId 关联，不假设顺序。

## 订阅生命周期

`run.subscribe` 与 `task.subscribe` 先返回 `subscriptionId`，随后发送 `run.event` 或 `task.event`。每个订阅保存独立 AsyncIterator，并在发送前验证公共事件 Schema。

`subscription.close` 只结束事件监听，不取消 Agent 任务。输入流关闭时释放全部订阅；`close()` 等待在途处理任务 settled，避免进程退出时遗留未处理写入。

进程异常退出后由 Client 重启并通过 `run.get + afterSeq` 恢复。Server 不在内存中虚构崩溃前状态，持久 EventStore 仍是恢复依据。

## 传输演进边界

未来 HTTP + SSE 应作为新的应用宿主复用 AgentApi，而不是在 AgentLoop 或工具中添加 HTTP 逻辑。

远程模式还需要 TLS、Bearer/OIDC、Origin allowlist、工作区 ACL 和多租户存储。本地 stdio 的权限语义不能直接等同于公网服务安全。

## StdioServer 方法级实现

| 方法 | 实现责任 |
| --- | --- |
| `listen` | 创建 readline，逐行调用 handleLine，并跟踪所有未 settled 任务 |
| `handleLine` | JSON 解析、协议校验、关闭通知、方法分发和错误响应 |
| `openSubscription` | 创建 subscriptionId、取得 iterator、先响应再启动 pump |
| `pumpSubscription` | 循环 iterator.next，Schema 校验后发送 run.event 或 task.event |
| `closeSubscription` | 从 Map 删除并调用 iterator.return，释放 API 监听 |
| `closeSubscriptions` | 关闭全部迭代器，等待相关任务完成 |
| `close` | 幂等关闭 readline、订阅和在途请求 |
| `send` / `sendError` | 序列化单行 JSON 写 stdout，保持协议输出唯一 |

`activeRequests` 只在请求处理期间保存 ID。重复活跃 ID 被拒绝，请求完成后删除；不同请求可以并发，同一 run 的一致性由 AgentApi 队列保证。

## 错误映射细节

JSON 解析失败返回 -32700；请求 Schema 或版本错误返回 -32600，并在 data 中附带当前 protocolVersion；未知方法返回 -32601。ZodError 被展开为可读的字段问题，AgentError 映射类别和 recoverable，其他错误只返回安全消息。

`requestId` 无法确定时使用 null，符合 JSON-RPC 错误响应形式。解析失败的行不会影响后续行，服务继续监听。

## 订阅泵与背压边界

`pumpSubscription` 每次等待一个 `iterator.next()` 后再写事件，不会为未知数量事件预先创建大量 Promise。写流本身的缓冲背压目前没有完整暴露到 Agent 执行层，这是未来高频远程传输需要继续处理的地方。

终态事件使 run 订阅自然结束；Task 订阅是全局长订阅，直到客户端关闭或服务关闭。关闭时先删除 Map 项，阻止 pump 继续发送，再调用 return。

## 进程配置与宿主责任

`resolveServerConfig` 解析 cwd、Provider、模型、Base URL、权限和数据目录。入口创建 NodeRuntime 后，将 observer、approval、tasks、settings 等端口交给 AgentApi。

Server 不直接读写工具事件，也不把模型流写入 stdout；所有输出都必须经过 PublicRunEvent Schema。需要调试日志时使用 stderr，避免破坏 NDJSON。

## 源码阅读地图

| 文件 | 实现内容 |
| --- | --- |
| `src/index.ts` | 进程入口、Runtime/API 组装和 stdio 启动 |
| `src/stdio-server.ts` | JSON-RPC 分发、错误、订阅与关闭 |
| `src/config.ts` | 服务进程参数和数据目录解析 |

`tests/api/stdio.test.ts` 验证分片、并发、错误和订阅；`tests/e2e/stdio-tui.test.tsx` 验证真实子进程和崩溃恢复。
