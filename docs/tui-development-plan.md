# Fidoo TUI 开发方案

## 1. 目标与边界

目标是提供聚焦、单色、可扫描的终端交互体验：持续消息流、工具调用摘要、文件 diff、审批弹窗、任务状态、会话恢复和可取消执行。视觉采用黑白灰、留白与细分隔线，蓝色仅用于链接和选中态，语义颜色仅表达成功、警告和错误。

首版不做：

- 多 Agent 拓扑图、复杂分屏和鼠标拖拽。
- 在 UI 内重写 Agent 状态机或权限规则。
- 为了界面效果修改 Provider、工具、安全和验证逻辑。
- 牺牲现有 `run --output json|jsonl` 的 CI 能力。

TUI 是独立的 `@fidoo/tui` 包，只通过 `AgentClient` 和版本化公共协议访问独立 Agent API。总体服务与多端边界见 `docs/agent-api-development-plan.md`，核心运行时不依赖 UI。

## 2. 技术选择

推荐 **Ink + React + TypeScript**，测试使用 `ink-testing-library`。

原因：

- 组件模型适合消息列表、工具卡片、弹窗和状态栏。
- 与当前 TypeScript 技术栈一致，类型可以直接从 `protocol` 和 `client` 复用。
- 比手写 ANSI 更容易处理布局、重绘、终端宽度和组件测试。
- 相比直接采用大型 TUI 框架，Ink 的组件边界更贴近现有代码。

实施时再添加 `ink`、`react`、`@types/react` 和 `ink-testing-library`，本方案不预先修改依赖。

非 TTY、管道和 CI 自动回退到当前文本/JSON CLI；`NO_COLOR` 时不能只依赖颜色表达状态。

## 3. 总体架构

```text
Ink Components
  │ submit / cancel / approve / reject
  ▼
AgentController（TUI 适配层）
  ├── AgentClient.run.start / resume / cancel
  ├── AgentClient.run.subscribe
  └── AgentClient.approval.respond ◄── ApprovalDialog
          │
          ▼
独立 Agent API / AgentServer
          │
          ▼
AgentLoop / PolicyEngine / Tools / EventStore
```

关键约束：

- `AgentClient` 是唯一任务入口，React 组件不能 import core、Provider 或工具实现。
- TUI 消费公共 `run.event`，不复用当前会写 `process.stdout/stderr` 的 CLI observer。
- 审批弹窗通过 `approval.respond` 响应服务端 pending call，不在 TUI 进程直接 resolve AgentLoop 的 Promise。
- TUI 的状态是公共事件 DTO 的投影，不是第二份任务事实源，也不直接读取存储 JSONL。
- 本地 TUI 使用 stdio transport，远程终端可使用 HTTP + SSE，视图层不需要变化。

## 4. 建议目录

```text
packages/tui/src/
    index.tsx                 # renderApp、Ink 生命周期、非 TTY 回退
    agent-controller.ts       # 任务队列、事件订阅、取消、恢复
    approval-bridge.ts        # 审批弹窗与 approval.respond 的桥接
    store.ts                  # useReducer、事件到视图状态投影
    types.ts                  # ViewMessage、ToolCard、PendingApproval
    app.tsx                   # 页面级状态机
    screens/
      session-screen.tsx
      sessions-screen.tsx
      doctor-screen.tsx
    components/
      header.tsx
      message-list.tsx
      message-item.tsx
      streaming-message.tsx
      tool-call-card.tsx
      diff-view.tsx
      approval-dialog.tsx
      composer.tsx
      command-palette.tsx
      status-bar.tsx
    hooks/
      use-agent-run.ts
      use-terminal-size.ts
      use-input-history.ts
      use-stream-buffer.ts
    keymap.ts
    theme.ts
```

依赖方向：`components → store/types → agent-controller → client/protocol`。`core` 和 `node-runtime` 不 import React 或 Ink，TUI 也不 import 它们。

## 5. 首屏布局

```text
ƒ fidoo                                      deepseek / deepseek-flash
────────────────────────────────────────────────────────────────────────

you
修复当前项目的失败测试

ƒ fidoo
我先检查失败位置……

✓ 2 tool calls · glob · read_file
✓ edit_file · src/math.ts · success
  Changes
  - return left - right
  + return left + right
⠋ bash · pnpm test · running

────────────────────────────────────────────────────────────────────────
› 输入任务
Enter send · Ctrl+J newline · Esc clear · / commands
● running · 74499530 · 1 file          12.4k in / 300 out · Ctrl+O · /help
```

审批时以模态区域覆盖 Composer，不允许后台继续执行同一调用：

```text
┌───────────────────────────────────────────────────────────────────┐
│ high risk                                                         │
│ Approval required · bash                                          │
│ node -e "console.log(process.cwd())"                              │
│ Process execution requires approval                               │
│ y approve once   n / Esc reject   Ctrl+C cancel run               │
└───────────────────────────────────────────────────────────────────┘
```

## 6. 状态与事件投影

建议视图状态：

```ts
interface TuiState {
  phase: "idle" | "starting" | "streaming" | "executing" |
    "awaiting_approval" | "verifying" | "completed" | "blocked" |
    "failed" | "cancelled";
  runId?: string;
  messages: ViewMessage[];
  activeAssistantText: string;
  toolCards: Map<string, ToolCard>;
  pendingApproval?: ApprovalRequest;
  changedFiles: Set<string>;
  remainingIterations: number;
  usage: { inputTokens: number; outputTokens: number };
}
```

事件映射：

- `message.user`：追加用户消息。
- `onTextDelta`：只更新当前流式消息；`message.assistant` 后将消息固化。
- `tool.proposed`：创建工具卡片。
- `tool.decided`：更新审批状态。
- `tool.started`：标记 running。
- `tool.result`：更新 success/error、摘要、diff 和 Artifact 引用。
- `verification.requested/finished`：更新验证状态和状态栏。
- `run.completed/blocked/failed/cancelled`：进入对应终态，恢复输入能力。

`model.usage { inputTokens, outputTokens }` 已进入持久公共事件，TUI 按多次模型请求累计并显示输入/输出 token，不读取 OpenAI SDK 的私有结构。费用与预算进度仍需后续增加中立价格配置。

为支持高质量 diff，后续应给 `ToolObservation` 增加结构化 `changes`，而不是在 React 中解析现有文本 diff。

## 7. 输入与快捷键

首版快捷键：

- `Enter`：发送任务。
- `Ctrl+J`：插入换行，比依赖终端区分 Shift+Enter 更可靠。
- `Ctrl+C`：取消当前 run；空闲时第一次提示，再按一次退出。
- `Esc`：关闭弹窗或命令面板；审批弹窗中等同拒绝。
- `y / n`：批准或拒绝当前调用。
- `↑ / ↓`：输入历史；弹窗打开时只用于弹窗选项。
- `Tab`：补全 slash command。
- `Ctrl+O`：展开或折叠当前工具输出详情。
- `Ctrl+K`：空闲时打开命令面板，方向键选择，Enter 执行，Esc 关闭。
- `Ctrl+R`：展开或折叠当前模型推理；折叠时预览最近 3 行并显示状态、耗时和字符数。

Slash commands：

```text
/new                 新会话
/resume <run-id>     恢复会话
/sessions            会话列表与选择
/trace               当前事件轨迹
/theme               主题选择与持久化
/reasoning           展开或折叠模型推理
/help                帮助
/quit                退出
```

### 主题配置

默认主题为 `next`，另提供 `graphite`、`midnight`、`light`。通过 `/theme` 或 Ctrl+K 命令面板选择后会原子写入 `~/.fidoo/tui.json`。也可以手工覆盖单个颜色：

```json
{
  "preset": "next",
  "colors": {
    "accent": "#0070f3",
    "border": "#3b3b3b",
    "muted": "#8a8a8a"
  }
}
```

TUI 包只负责主题解析与应用；CLI 负责配置文件读写，避免把 Node 文件系统耦合进可复用视图层。历史 Static 内容保留输出时的颜色，新主题应用于当前动态界面和后续内容。

## 8. 渲染与性能

- 已完成消息与工具按 seq 合并到同一个 Ink `Static` 时间线，只追加新内容；活动工具、流式回复和 Ctrl+O 输出详情保持动态。
- `onTextDelta` 与 `onReasoningDelta` 在 `AgentController` 中按 50ms 分别合批，渲染入口限制 `maxFps: 20`。完整段落和闭合代码块以连续排版追加到 Static，动态区域只保留未完成块，避免终端捕获整篇擦写产生的空白中间帧。
- `message.reasoning.delta` 是独立临时事件，不写入事件存储、不进入历史 Trace，也不与正式回答 Markdown 混合。Reasoning 面板默认预览最近 3 行并显示状态、耗时和字符数，Ctrl+R 展开最近 24 行；内存最多保留最近 64K 字符。
- Run plan 由真实运行事件推导：Inspect 随首次工具结果或回答完成，Change 随文件修改工具推进，Verify 随验证事件推进，Report 只在终态完成；未发生的修改和验证标记为 skipped，不伪造模型计划。
- `run.completed.summary` 不再作为纯文本 notice 重复输出；Agent 消息是唯一 Markdown 正文，完成通知只保留简短验证状态。
- Agent 正文使用 marked token 流式 Markdown 渲染，支持标题、粗体、列表、链接、引用、表格和代码块；代码与 Bash 命令使用独立高亮组件。
- 工具批次保留最近 2 条完整调用，更早的调用合并为一行汇总；大工具输出默认折叠，当前 Ctrl+O 限长查看最后输出；Artifact 分页读取与独立查看器作为下一步，避免把几万行文本一次性交给 Ink。
- 所有文本按终端宽度换行；80×24 是可用的最低验收尺寸。
- 非 TTY 不进入 raw mode；TUI 独占输出时禁止其他组件直接写 stdout/stderr。
- 首版保留系统终端滚动历史，不急着启用 alternate screen；全屏模式作为后续选项。
- 颜色之外增加 `running/success/error/blocked` 文本和图标，提供 ASCII fallback。

## 9. 分阶段实施

### T1：可用的单屏闭环（已完成）

- 已提供独立 `agent-server --stdio` 和 `agent tui`；TTY 默认进入 TUI，非 TTY 保持现有行为。
- 实现 `AgentController`、事件 reducer、消息流、Composer、状态栏。
- 实现工具卡片、编辑 diff、审批弹窗、Ctrl+C 取消和 `report_blocked` 展示。
- 实现输入历史、Ctrl+O 工具输出折叠、`/new`、`/help` 和 `/quit`。
- 复用现有工作区预检；启动失败直接显示配置错误，不创建空会话。

验收：真实完成“提交任务 → 审批编辑 → 查看 diff → 测试验证 → completed”，blocked 返回退出码 2 的语义不变。

### T2：会话与长任务体验（当前优先级）

已完成：`/sessions`、`/resume <run-id>`、`/trace`、中断会话恢复后续跑、持久 `model.usage`、token 状态栏、40ms delta 批量刷新、长消息/工具列表限长、多行粘贴和 Unicode 输入。

视觉重构已完成：`ƒ fidoo` 静态品牌时间线、响应式双栏 Welcome、聚焦输入面板、编辑器式工具轨迹、流式 Markdown、代码/命令高亮、命令建议与 Tab 补全、Ctrl+K 命令面板、主题选择、代码评审 diff 和新版审批/状态栏。

后续继续：Artifact 查看、费用与预算进度、验证清单、完整断线重连和更多终端尺寸验收。Web、桌面和 HTTP 传输暂缓，优先完善 Agent + TUI 的真实使用闭环。

验收：长会话中可取消并恢复，未决副作用仍进入对账；80 列终端不出现布局失控。

### T3：开发效率与可定制性

- 已完成命令面板和主题持久化；后续增加键位配置、会话搜索、结构化 diff 全屏视图。
- 可选 alternate screen、鼠标点击和复制模式。
- 后续 IDE 复用 `client/protocol`，不共享终端专用组件或 `agent-controller`。

## 10. 测试方案

- `store`：每种公共 RunEvent 的视图投影、流式消息固化、blocked 状态。
- `approval-bridge`：多个 callId 不串单，拒绝、取消和重复响应安全。
- Ink 组件：消息、工具卡片、审批弹窗、80×24 布局、无颜色模式。
- Controller：Fake Transport + 公共事件，覆盖发送、流式输出、审批、取消、恢复；另用 stdio contract test 验证真实服务。
- 回归：非 TTY JSON/JSONL 输出不受 Ink 污染。
- 端到端：真实 fixture 仓库完成测试修复；无效 cwd 在模型请求前显示错误。

标准检查仍执行 `pnpm build`、`pnpm typecheck`、`pnpm lint`、`pnpm test` 和 `pnpm eval:offline`，新增 TUI 测试后必须覆盖真实键盘事件，而不只验证组件能渲染。

## 11. 最小第一刀

第一刀只实现以下文件，避免一次铺开全部组件：

```text
packages/tui/src/index.tsx
packages/tui/src/agent-controller.ts
packages/tui/src/store.ts
packages/tui/src/app.tsx
packages/tui/src/components/message-list.tsx
packages/tui/src/components/tool-call-card.tsx
packages/tui/src/components/approval-dialog.tsx
packages/tui/src/components/composer.tsx
packages/tui/src/components/status-bar.tsx
tests/tui/store.test.ts
tests/tui/session-screen.test.tsx
tests/e2e/stdio-tui.test.tsx
```

完成 T1 并验证真实任务后，再增加会话管理、命令面板和高级视觉效果。这样可以最大程度复用刚修复的运行时可靠性，而不是同时维护两套 Agent 行为。

## 12. 本地热重启与调试

```bash
pnpm dev --provider deepseek --cwd /真实项目 tui
pnpm dev:debug --provider deepseek --cwd /真实项目 tui
pnpm dev:once --provider deepseek --cwd /真实项目 tui
pnpm build:watch
pnpm test:watch tests/tui
```

`pnpm dev` 监听 `apps/*/src` 和 `packages/*/src`。保存文件后，先通过 SIGTERM 让 CLI 取消活跃任务、卸载 Ink 并关闭 sidecar，再构建和重启 CLI 与 `agent-server`，避免构建日志与 Ink 同时输出。构建失败后保留监听，下一次保存会重试。

这是热重启而非保留状态的 React HMR；界面投影会重置，EventStore 中的持久事件不会删除。`/quit` 结束整个开发监听会话。`dev:debug` 为 CLI 和子进程分配随机 Inspector 端口，调试地址写 stderr。stdio stdout 仍只能传 JSON-RPC。
