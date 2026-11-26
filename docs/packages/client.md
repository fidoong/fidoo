---
slug: client
name: "@fidoo/client"
path: packages/client
group: 客户端与应用
order: 4
summary: 运行时中立的 TypeScript SDK，以及可靠的 stdio 重连实现。
description: Client 隐藏请求 ID、响应 Schema、订阅和恢复细节。TUI、CLI 和未来客户端只面对 workspace、run、approval、artifacts、settings、tasks 六组稳定 API。
keywords: AgentClient, SDK, stdio, 重连, afterSeq
dependencies: @fidoo/protocol, zod
---

## 包职责与入口

`AgentClient` 是面向界面的唯一任务入口。它不包含 Provider、工具或存储实现，也不判断任务是否应该完成；这些语义始终由服务端负责。

主入口 `@fidoo/client` 保持运行时中立。Node 专用 sidecar 连接通过 `@fidoo/client/stdio` 导出，避免浏览器打包 Node 子进程代码。

## SDK 分组与响应校验

```ts
const client = createAgentClient(transport);
const run = await client.run.start({ cwd, task });

for await (const event of client.run.subscribe({
  runId: run.runId,
  afterSeq: 0,
})) {
  store.apply(event);
}
```

| 属性 | 封装能力 |
| --- | --- |
| `workspace` | 校验工作区 |
| `run` | start、resume、steer、cancel、get、list、trace、subscribe |
| `approval` | 审批或拒绝指定调用 |
| `artifacts` | 按 ID、offset、limit 读取大输出 |
| `settings` | 获取设置、更新连接、发现模型 |
| `tasks` | 查询后台任务、读取输出、确认停止和订阅；停止需 taskId、runId、confirmed |

每个响应都经过 Protocol 中的 Zod Schema 解析。服务端返回结构不兼容时，Client 立即失败，而不是把未知对象交给界面产生隐蔽错误。

## stdio 分帧与请求生命周期

`StdioTransport` 管理 sidecar、NDJSON 分片、pending request 和订阅迭代器。stdin/stdout 中的每行是一条 JSON-RPC 消息，stdout 不允许混入普通日志。

- 按 `requestId` 匹配响应，不假设请求按顺序完成。
- 按 `subscriptionId` 分发 `run.event` 与 `task.event`。
- `subscription.close` 只释放事件监听，不取消 Agent 任务。
- 进程退出时拒绝未完成请求并唤醒订阅者。
- `close()` 明确关闭流与子进程，避免悬挂句柄。

## 自动重连与恢复

`ReconnectingStdioTransport` 检测 sidecar 异常退出，按指数退避重启。未知结果的命令使用原 request ID 重试，让 API 的幂等缓存返回同一份成功结果。

运行恢复使用 `run.get + afterSeq`：先获取快照，再请求缺失的持久事件，最后恢复实时订阅。多个订阅者共享恢复过程，不重复启动多个 sidecar。

正在运行的任务在恢复后继续执行；崩溃时未闭合的工具调用由服务端标记为需要对账，Client 不会自动重放写文件或 Bash。临时正文、推理和工具输出不作为恢复事实。

## 连接状态与界面责任

`onConnectionChange` 向界面提供连接状态。TUI 在断开时清理临时流并移除失效审批，但不会把任务误标为已取消；恢复后重新投影持久事件。

新增远程传输时实现 `AgentTransport`，不要修改 React 组件。HTTP、SSE、认证和重试策略属于对应传输包或应用宿主。

## StdioTransport 内部状态

StdioTransport 维护 pending requests、subscriptions、输入缓冲和 closed 状态。子进程 stdout 的任意 chunk 先拼入字符串，再按换行拆分；最后一段未完整行保留到下次 data，不能把 TCP/流式分片误当完整 JSON。

```text
stdout chunk
  → buffer += chunk
  → 按换行切分
  → 完整行 JSON.parse
  → response? 按 requestId resolve/reject
  → notification? 按 subscriptionId push
```

`AgentProtocolError` 保存 JSON-RPC code 与 data。`-32000` 被重连层识别为连接断开，其他协议错误直接交给调用方，不能把所有错误都误当断线重试。

订阅使用本地异步队列。消费者提前 `return` 时发送 `subscription.close` 并结束本地流；`abort()` 则拒绝全部 pending 并结束所有订阅，用于进程崩溃或显式关闭。

## 请求 ID 与重试安全

ReconnectingStdioTransport 在调用开始时生成一次 `client-N`，后续最多三次连接尝试都复用该 ID。这样请求在“服务端已执行、响应却丢失”时仍可由 RequestResultCache 返回原成功结果。

只有连接断开错误会重试；配置、权限、参数和模型错误不重试。达到三次或显式 close 后抛出最后错误。这个策略依赖 API 幂等语义，不能扩展成对所有未知工具的盲目重放。

## generation 与恢复共享

每次成功建立新连接时 `generation += 1`。`recoveries` 记录当前 generation 下每个 run 正在执行的恢复 Promise，`recovered` 记录已完成的 generation。

- 同一连接的多个订阅者共享一次恢复。
- 新连接使旧 generation 的恢复记录失效。
- 恢复快照仍为 running 时调用 `run.resume`，让新 Runtime 接管任务。
- 已终态任务只读取事实，不重新执行。
- 恢复失败后清理 Promise，下次可以重试。

恢复完成前，重连订阅不会直接开始读新流；恢复后从本地最大 afterSeq 接续。持久事件更新 afterSeq，临时事件不影响它。

## 后台任务订阅差异

`task.subscribe` 没有 run 序号和快照恢复。断线后只重新建立全局订阅，不重放已经错过的通知；任务真实状态仍可通过 `task.list` 和 `task.output` 查询。界面不能把临时通知当作任务事实源。TaskClient 使用显式迭代器包装响应校验，并把 return/throw 转发给底层 transport，确保 Activity 重连或卸载能真正取消旧订阅。

## 连接状态与资源释放

连接状态包括 connected、reconnecting 和 closed。`disconnect` 仅当失效 transport 仍是 current 时才清理，避免旧进程退出误删新连接。`close` 是幂等操作，停止后续重连并关闭当前 transport。

`connectAgentServer` 负责创建 Node 子进程和默认参数，`defaultServerArguments` 把 Provider、模型、Base URL、权限和 cwd 传给 server。主 AgentClient 不知道这些 Node 细节。

## 源码阅读地图

| 文件 | 实现内容 |
| --- | --- |
| `src/agent-client.ts` | 分组 SDK、订阅入口和响应 Schema 校验 |
| `src/stdio-transport.ts` | NDJSON 分帧、请求匹配、订阅和进程生命周期 |
| `src/reconnecting-stdio-transport.ts` | sidecar 重启、幂等重试、快照和事件恢复 |
| `src/stdio.ts` | Node 专用 stdio 连接入口 |
| `src/index.ts` | 运行时中立的主入口 |

真实故障测试在 `tests/api/stdio.test.ts` 和 `tests/e2e/stdio-tui.test.tsx` 中覆盖，包括 SIGKILL sidecar 后恢复待审批任务。
