# 独立 Agent API 与多端架构方案

## 1. 目标

将 Fidoo 设计为独立服务，为终端 TUI、现有 CLI、桌面应用、Web 和后续 IDE 提供同一套任务、审批、事件和会话能力。

核心要求：

- Agent 运行时不依赖任何客户端界面。
- 客户端不直接实例化 Provider、工具或本地存储。
- API 协议独立版本化，不把内部领域事件和厂商 SDK 类型直接暴露给客户端。
- 本地与远程共享同一套方法和事件语义，只替换传输适配器。
- 审批、安全策略、验证、恢复和预算始终由服务端强制执行。
- 现有文本/JSON CLI 保持可用，非 TTY 自动化不被 TUI 或服务传输影响。

## 2. 总体架构

```text
┌ CLI ────────────┐  ┌ TUI ────────────┐  ┌ Desktop ────────┐  ┌ Web ───────────┐
│ text/json/jsonl │  │ Ink + React     │  │ Tauri/Electron  │  │ Browser        │
└────────┬────────┘  └────────┬────────┘  └────────┬────────┘  └────────┬───────┘
         └────────────────────┴────── AgentClient ──┴────────────────────┘
                                      │
                      版本化 Agent Protocol / DTO
                                      │
                 stdio JSON-RPC       │       HTTP POST + SSE
                 （本地 sidecar）      │       （Web / 远程）
                                      ▼
                           Agent API Application
                     RunManager / ApprovalBroker / EventHub
                                      │
                           Agent Core + Node Runtime
                                      │
                  Provider / Tools / Policy / EventStore / Artifacts
```

边界说明：

- `AgentCore` 负责 ReAct、上下文、验证、恢复和状态机，不理解 JSON-RPC、HTTP、React 或 Electron。
- `Agent API Application` 负责用例、权限、会话并发、审批等待、事件广播和 DTO 映射，不直接写 HTTP。
- `fidoo-server` 负责 stdio、HTTP、SSE、认证和连接生命周期。
- `AgentClient` 是 TypeScript 客户端 SDK，TUI、桌面和 Web 不重复实现协议细节。

## 3. 包结构

```text
fidoo/
  apps/
    cli/                         # 文本 CLI、JSON CLI、命令参数和环境变量
    agent-server/                # stdio、HTTP、SSE、认证和进程管理
    web/                         # 后续浏览器客户端
    desktop/                     # 后续 Tauri/Electron 客户端
  packages/
    core/                        # domain/application/ports/context/runtime
    node-runtime/                # Provider、工具、文件、Shell、存储和组合根
    protocol/                    # 公共 DTO、方法名、事件、Zod Schema、错误码
    api/                         # RunManager、ApprovalBroker、EventHub、DTO 映射
    client/                      # AgentClient、重连、事件订阅、请求 ID 管理
    tui/                         # Ink 组件与终端交互，只依赖 client/protocol
  pnpm-workspace.yaml
```

依赖方向：

```text
apps/cli ────────────────► client ─► protocol
packages/tui ────────────► client ─► protocol
apps/desktop/web ────────► client ─► protocol

apps/agent-server ───────► api ────► core
       │                   │         ▲
       └───────────────────┴──► node-runtime
```

禁止依赖：

- `core → api/protocol/client/tui`。
- `api → agent-server`，HTTP 不能倒灌进应用服务。
- `tui → core/node-runtime`，TUI 不绕过 API 直接操作运行时。
- `client → node-runtime`，浏览器客户端不能携带 Node 工具实现。

`node-runtime` 只在服务端进程存在。未来若增加浏览器运行时，应新建独立适配器，而不是污染 Node 包。

## 4. 公共协议

### 4.1 协议原则

- 使用独立的 `protocolVersion`，从 `v1` 开始；不与内部事件 `schemaVersion` 混用。
- 公共 DTO 使用 camelCase；内部事件保持现有领域格式，由 API 层映射。
- 所有请求带 `requestId`，所有持久运行事件带 `runId + seq + eventId`。
- 持久事件可通过 `afterSeq` 重放；流式 text/reasoning delta 使用独立临时通知，不写事件库，重连时先取 `run.get` 快照再接续持久事件。
- 持久 `message.assistant` 不返回原始 `reasoningContent`、Provider 私有凭证、绝对敏感路径或密钥。原始推理只通过明确类型的 `message.reasoning.delta` 临时推送，TUI 默认提供最近 3 行预览且不落盘。
- 大输出只返回 Artifact 元数据与受限读取接口，不在事件里重复发送全文。
- 写操作和验证结果使用结构化 DTO，客户端不解析文本 diff 或命令输出猜测状态。

### 4.2 方法

```text
workspace.validate   校验并描述工作区，不启动模型
run.start            创建任务，立即返回 runId
run.resume           追加用户指令并恢复任务
run.steer            活跃运行中追加指导，下一模型轮次生效
run.cancel           请求取消任务
run.get              查询任务快照
run.subscribe        订阅 afterSeq 之后的事件
run.list             分页查询会话
run.trace            获取审计轨迹，按权限脱敏
approval.respond     批准或拒绝指定 callId
artifact.read        按 Artifact ID 分页读取受限内容
task.list/output/stop 查询输出或停止后台任务
task.subscribe       订阅全局后台任务启动与完成通知
config.get           获取可公开的 Provider、权限和预算配置
session.close        关闭客户端订阅，不取消任务
```

### 4.3 示例

启动任务：

```json
{
  "protocolVersion": "v1",
  "requestId": "req-1",
  "method": "run.start",
  "params": {
    "workspaceId": "workspace-1",
    "task": "修复失败测试",
    "permissionMode": "manual"
  }
}
```

事件通知：

```json
{
  "protocolVersion": "v1",
  "method": "run.event",
  "params": {
    "runId": "run-1",
    "seq": 42,
    "eventId": "event-42",
    "type": "tool.finished",
    "data": {
      "callId": "call-1",
      "name": "bash",
      "status": "error",
      "summary": "Failed: pnpm test (exit code 1)"
    }
  }
}
```

审批响应：

```json
{
  "protocolVersion": "v1",
  "requestId": "req-2",
  "method": "approval.respond",
  "params": {
    "runId": "run-1",
    "callId": "call-1",
    "decision": "approved",
    "scope": "once"
  }
}
```

### 4.4 公共事件

首版只暴露稳定、客户端真正需要的持久事件：

```text
run.started / run.resumed / run.steered
message.user / message.assistant
tool.proposed / tool.approval_required / tool.started / tool.result
verification.requested / verification.finished
plan.updated
context.compacted
run.completed / run.blocked / run.failed / run.cancelled
model.usage
```

`message.assistant.delta`、`message.reasoning.delta` 与 `tool.output.delta` 是独立的临时通知，用于降低流式显示延迟，不承诺重放。客户端必须能仅凭快照和持久事件重建正确界面；恢复历史时不重建原始推理。后台任务使用独立的全局 `task.event` 通知，不占用 run 的事件序号。

内部事件可以继续演进；公共映射层负责兼容，不允许客户端直接消费存储 JSONL。

## 5. 传输设计

### 5.1 本地：stdio JSON-RPC

用于桌面 sidecar、TUI 和本地服务进程：

- 每行一个 JSON-RPC 2.0 消息，stdout 只传协议，日志只能写 stderr。
- 方法调用使用 `requestId + protocolVersion: "v1"` 的 request/response，Agent 事件使用 notification。
- `run.subscribe` 先返回 `subscriptionId`，随后发送 `run.event`，结束时发送 `run.end`。
- 客户端提前结束订阅时发送 `subscription.close`；它只释放事件监听，不取消任务。
- 子进程崩溃后客户端可重新启动并依据 `afterSeq` 恢复订阅。
- Node 专用连接位于 `@fidoo/client/stdio`，主 Client 入口保持运行时中立。
- 不开放端口，默认继承当前用户权限。

### 5.2 Web / 远程：HTTP POST + SSE

- `POST /v1/rpc`：所有命令和查询。
- `GET /v1/runs/:id/events?afterSeq=42`：SSE 事件流与重连。
- SSE 持久事件包含 `id: runId:seq`、`event` 和 `data`；临时 delta 不设置持久事件 ID，代理和浏览器更容易处理。
- 审批请求通过 SSE 到达，审批响应走 HTTP POST。
- 心跳只用于保活，不进入 Agent 事件轨迹。

WebSocket 不是首版必需；只有明确需要高频双向消息或多人实时协作时再增加传输适配器。

## 6. 服务端运行模型

### RunManager

- 每个 run 只有一个命令写入队列，保证 `start/resume/cancel/approval.respond` 顺序确定。
- 多个客户端可以订阅同一 run，事件广播不改变 canonical event 的顺序。
- API 进程重启后通过 EventStore 恢复；未决副作用仍按现有对账规则处理。
- 客户端断开不自动取消任务，是否取消由显式命令或租约策略决定。

### ApprovalBroker

- 以 `runId + callId` 管理 pending Promise。
- 同一调用只允许一次有效响应，重复响应返回明确错误。
- 客户端断开不自动批准；超时后保持 pending 或按配置拒绝。
- `scope=once/session` 仍由 PolicyEngine 约束，客户端不能提交任意扩大权限的规则。

### EventHub

- 内存订阅只负责实时推送，EventStore 才是事实源。
- 推送失败不回写内部事件，也不影响 Agent 执行。
- 客户端重连先获取快照并读取 `afterSeq` 后的持久事件，再接入实时流，避免竞态漏事件；临时 delta 不作为恢复依据。

## 7. 安全与多租户边界

- 本地 HTTP 默认只监听 `127.0.0.1`，远程监听必须显式配置。
- 远程模式使用 TLS、Bearer/OIDC 身份和 Origin allowlist，不能把无认证 API 暴露到公网。
- Web 不直接提交任意宿主机路径；先由管理员注册 `workspaceId` 和根目录 ACL。
- Artifact 使用受限 ID 和分页读取，禁止通过 `../` 或绝对路径读取任意文件。
- 公共 DTO 默认移除原始推理、Provider 凭证、环境变量和敏感绝对路径。
- API 认证不能替代工具审批；高危命令仍按 PolicyEngine 处理。
- 本地权限规则的分层配置、匹配语义和项目配置降权保护见 `docs/permissions.md`。
- 多用户场景使用独立凭证、预算、会话命名空间和存储隔离，单用户 JSONL 不直接充当多租户数据库。

## 8. 持久化演进

- 当前本地单用户继续使用 JSONL + 文件 Artifact。
- API 多客户端阶段建议增加 SQLite EventStore，保留同一端口接口。
- 多实例或团队远程服务再考虑 PostgreSQL 和对象存储。
- 公共协议只依赖 `runId/seq/eventId`，不依赖 JSONL、SQLite 或 PostgreSQL 的物理布局。

## 9. 客户端 SDK

```ts
const client = createAgentClient({ transport });

const run = await client.run.start({ workspaceId, task, permissionMode: "ask" });

for await (const event of client.run.subscribe(run.runId, { afterSeq: 0 })) {
  store.apply(event);
}

await client.approval.respond({ runId: run.runId, callId, decision: "approved" });
```

SDK 负责：

- 请求 ID、协议版本校验和结构化错误。
- 事件去重、乱序检测、断线重连和 afterSeq 恢复。
- 不实现界面状态，不自行判断任务是否完成。
- 不导出 Node Provider 或工具实现。

TUI、桌面和 Web 各自将事件投影成自己的视图状态。

## 10. 分阶段迁移

### A1：提取包与协议（已完成）

- 将当前代码迁移到 `core`、`node-runtime`、`protocol`、`api`、`client`。
- 先提供进程内 transport，让现有 CLI 通过 AgentClient 调用 API。
- 用 contract tests 保证方法、错误和事件顺序，不改变现有工具行为。

### A2：独立 stdio 服务与 TUI（已完成）

- 实现 `apps/agent-server` 的 `agent-server --stdio` 和流式 JSON-RPC。
- 实现 `@fidoo/client/stdio` 子进程连接、分片 NDJSON、结构化错误和订阅生命周期。
- TUI 作为独立 `@fidoo/tui` 包，只通过 AgentClient 工作。
- 完成消息、工具卡片、diff、审批、取消、恢复和 blocked 的端到端验收。
- 活跃任务通过 AbortSignal 取消，由唯一 AgentLoop 写入取消事件，避免并发序号冲突。

构建后可运行：

```bash
node apps/cli/dist/index.js --provider deepseek --cwd /真实项目 tui
node apps/agent-server/dist/index.js --provider deepseek --cwd /真实项目 --stdio
```

TTY 下无子命令的 `agent` 默认进入 TUI；非 TTY 保持文本帮助及 `run --output text|json|jsonl`。`run/resume` 仍可使用进程内 API；`cancel/sessions/trace` 暂时保留本地 EventStore 快捷路径，尚未统一迁移到远程协议。

### A3：Agent + TUI 企业级完善（当前优先级）

- 完成会话列表、历史恢复、轨迹查看、续跑和长任务交互。
- 加强断线恢复、Artifact、模型用量、预算、并发与持久化可靠性。
- 保持 `run/resume`、stdio 和公共协议的同一语义，增加真实故障与回归测试。
- HTTP + SSE 暂缓，不在此阶段引入 Web 传输。

### A4：HTTP、Web 与桌面（暂缓）

- Agent + TUI 达到完整可消费体验后，再增加 HTTP + SSE、Web 和桌面客户端。
- Web 复用 AgentClient，不共享 Ink 组件；桌面以 sidecar 启动 stdio 服务。
- 根据真实并发需求引入 SQLite，而不是提前替换 JSONL。

## 11. 验证策略

- Protocol：Zod 兼容性、必填字段、错误码、旧版本客户端拒绝策略。
- Contract：同一组请求在 in-process、stdio、HTTP/SSE 三种 transport 下得到相同语义。
- API：单写队列、多订阅者、审批一次响应、断线重连、afterSeq 无遗漏无重复。
- 安全：无效 workspace、Artifact 路径穿越、未认证远程访问、审批权限绕过。
- TUI/Desktop/Web：各自完成同一真实 fixture 修复任务，不通过共享内存获取结果。
- 回归：现有 `pnpm build/typecheck/lint/test/eval:offline` 及原 JSON CLI 全部保持通过。

## 12. 最小可交付切片

第一轮不同时实现所有客户端，按以下顺序落地：

1. 提取 `protocol + api + client`，保留进程内 transport。
2. 抽出独立 `agent-server --stdio`。
3. 将 TUI 接入 AgentClient，验证审批和事件恢复。
4. 增加 HTTP + SSE，最后才开发 Web。

这样从第一步起就避免 TUI 绑定 runtime，同时让每个阶段都有可运行、可验证的交付物。
