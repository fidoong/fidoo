---
slug: tui
name: "@fidoo/tui"
path: packages/tui
group: 客户端与应用
order: 6
summary: 基于 Ink + React 的终端界面，只消费 Client 与公共事件。
description: TUI 将 Agent 事件投影成终端视图，不拥有第二份任务状态机。它采用 append-only 历史、独立动态输入区和合批流式渲染，兼顾长会话可读性与终端刷新稳定性。
keywords: Ink, React, Markdown, Static, 审批, 终端
dependencies: @fidoo/client, @fidoo/protocol, ink, react, marked
---

## 包职责与数据方向

TUI 只依赖 `@fidoo/client` 和 `@fidoo/protocol`。React 组件不能 import Core、Provider 或工具实现，审批也不能直接 resolve 服务端 Promise。

```text
AgentClient events
  → AgentController
  → TuiStore projection
  → useSyncExternalStore
  → Ink components

keyboard intent → AgentClient command
```

`AgentController` 管理任务命令、事件订阅、delta 合批、Artifact 和后台任务通知。Store 将公共事件归约为 phase、消息、工具卡片、真实计划、pendingApproval、Token 和运行中任务数。

## 事件投影与恢复

`tool.proposed` 创建工具卡片，`tool.started` 更新运行状态，`tool.result` 添加结果、改动文件和 Artifact。`plan.updated` 直接保存真实 TaskPlan；只有旧会话没有计划时，才回退到 Inspect/Change/Verify/Report 的事件投影。

`run.completed/blocked/failed/cancelled` 驱动终态并恢复输入。恢复会话时只重放公共持久事件，不重建原始推理或临时输出。

断线时清理未固化正文、思维链和失效审批；sidecar 重连后使用快照与 afterSeq 继续，避免重复正文。

## 流式 Markdown 与 append-only 渲染

`timeline.ts` 按 seq 合并消息、计划和工具轨迹。`MessageList` 将完整内容交给 Ink `Static`，只追加新块；活动区域只保留正在生成的正文和工具，避免终端整篇擦写产生闪烁。

- 正文与 reasoning delta 分别合批，Ink 渲染入口限制 `maxFps`。
- 正式回答出现后隐藏临时思维链，不与 Markdown 正文混合。
- Markdown 支持标题、粗体、列表、链接、引用、表格和代码块。
- 工具批次保留最近调用，更早调用折叠为摘要。
- Bash 临时输出只显示最近 6 行，完整内容进入 Artifact 查看器。
- 品牌和输入从第 0 列开始，中间正文保留两列留白。

大输出默认折叠，Ctrl+O 按 Artifact ID 分页读取，避免把数万行一次性交给 Ink。

## 输入、审批与命令

| 操作 | 行为 |
| --- | --- |
| Enter | 空闲时发送任务；运行时发送 Steering |
| Ctrl+J | 插入换行 |
| Ctrl+C | 取消当前 run；空闲时按退出流程处理 |
| Esc | 关闭弹窗；审批中等同拒绝 |
| y / n | 批准或拒绝当前工具调用 |
| ↑ / ↓ | 输入历史或弹窗选项 |
| Ctrl+O | 打开输出与 Artifact 查看器 |
| Ctrl+K | 打开命令面板 |
| Ctrl+R | 展开或折叠推理预览 |

Slash 命令覆盖 `/new`、`/resume`、`/sessions`、`/trace`、`/theme`、`/reasoning`、`/artifact`、`/settings`、`/mode` 和 `/help`。审批通过公共 `approval.respond` 返回服务端，不在 TUI 内修改权限。

状态栏显示当前 manual、acceptEdits/EDIT、plan 或 auto。Composer 聚焦时 Shift+Tab 循环模式；`/mode` 提供带说明的选择器。Plan 到达 awaiting_plan 后自动打开审批界面，可选择 Approve & Edit、Approve & Auto、Approve & Review manually 或 Revise；所有结果均通过公共 API 和持久事件生效。

## 主题与进程边界

TUI 负责主题解析和颜色应用，CLI 通过 `onThemeChange` 注入配置保存，避免视图包直接依赖 Node 文件系统。历史 Static 内容保留输出时颜色，新主题应用于动态区域和后续内容。

TTY 下 CLI 默认进入 TUI；非 TTY 不进入 raw mode，继续使用文本或 JSON 输出。TUI 独占输出时，其他组件不能直接向 stdout/stderr 写日志。

## AgentController 状态与请求协调

Controller 内部除了 TuiState，还维护 execution、generation、responding、pendingDelta、pendingReasoning 和唯一 deltaTimer。

| 方法 | 实现细节 |
| --- | --- |
| `submit` | 忽略空输入和活跃阶段重复提交；已有 runId 时 resume，否则 start；从 afterSeq 开始 consume |
| `respond` | 使用 responding 防止双击重复审批；提交 pendingApproval 的 runId + callId |
| `steer` | 只允许活跃 run；调用公共 steer，不直接修改 AgentLoop |
| `cancel` | 调用 run.cancel，由服务端中断真实执行 |
| `newSession` | 仅终态可用；增加 generation 并恢复初始视图 |
| `loadSession` | 并行 run.get + run.trace，逐事件重建；中断 run 先显示为可恢复 idle |
| `readArtifact` | 强制当前 runId，按页调用公共 Artifact API |
| `consumeTasks` | 全局任务事件到达后重新 task.list，完成时显示状态和 exitCode |

generation 用于隔离旧请求和旧订阅。新会话或恢复另一会话后，旧 consume 即使稍后收到事件也会直接退出，不会写入新界面。

连接进入 reconnecting 时清除 delta timer、正文、推理和 responseActive；连接恢复后重新刷新任务。界面通知连接状态，但不自行把 run 标为取消。

## Store 事件投影明细

所有持久事件先经过 `event.seq <= current.lastSeq` 去重；临时 delta 在此判断之前处理，因为它们的 seq 不代表可恢复位置。

| 事件 | 视图状态变化 |
| --- | --- |
| `message.assistant.delta` | 进入 pendingDelta 后经 appendStreamingText 合批追加 |
| `message.reasoning.delta` | 进入独立 reasoningText，限制内存并记录活跃状态 |
| `tool.output.delta` | 追加到对应工具 output，只保留最后 16K 字符 |
| `run.resumed` | 清理临时流、验证状态和错误，恢复 running |
| `run.steered` | steeringPending +1，显示下一模型轮次生效提示 |
| `message.user` | 追加用户消息，带 steeringId 时减少 pending 数 |
| `message.assistant` | 固化正文、清空 streamingText、结束 reasoning |
| `model.started/completed/failed` | 更新 iteration、模型调用数、耗时、失败数和 active |
| `model.usage` | 当前 contextTokens 使用最新总输入值，累计普通输入、缓存读取、缓存写入与输出；兼容旧事件缺省字段 |
| `plan.updated` | structuredClone 完整真实计划，防止引用共享修改 |
| `tool.proposed` | 按 callId 和 seq 创建 proposed 工具卡片 |
| `tool.approval_required` | 创建 PendingApproval，phase 进入 awaiting_approval |
| `tool.decided` | 记录 approved/rejected，并清除匹配的 pendingApproval |
| `tool.started` | 设置 running 和 startedAt |
| `tool.result` | 计算 durationMs，更新输出、Artifact 和 changedFiles |
| `verification.requested/finished` | 更新 verificationStatus 与真实证据 notice |
| 终态事件 | 清理 pendingApproval 和临时流，结束 reasoning |

`run.completed` 不再把 finalSummary 当作新正文重复追加，避免同一回答出现两次。

## 流式 Markdown 分段算法

`splitStreamingMarkdown` 将已经完整的段落和闭合代码块放入 complete，把当前未完成块留在 rest。这样 Static 可以尽早追加稳定内容，而不需要等整篇回答完成。

`appendStreamingText` 管理 streamingText 与 streamingBlocksStarted；正式 `message.assistant` 到达时，如果已开始分段，就以累计的流式正文为准完成最后一块，否则使用持久消息内容。该分支处理 Provider 正文 delta 与完整消息之间的差异。

正文与推理共享一个 50ms timer，但分别使用 pending 字符串。flush 时先应用正文再应用推理，只 emit 一次，减少 React 重渲染。

## Timeline 与 Static 去重

`buildTimeline` 只把 success/error 工具放入历史，running/proposed 工具留在 currentTools。消息与已完成工具按 seq 排序，同序号时工具先于消息，符合 tool.result 在下一轮 assistant 之前的持久顺序。

连续工具合并为一个 `tools-<first>-<last>` 块；遇到消息时先 flush 工具，再追加消息。返回 `entries`、当前活动工具和最后完成工具，分别服务 Static、动态区域和 Ctrl+O。

`appendOnly(previous, next)` 按 id 找出新增项，只返回新增数组；没有新增时保留原引用。Ink Static 因此不会重复渲染已有历史。

## 组件与功能模块

| 模块 | 功能实现 |
| --- | --- |
| `app.tsx` | 页面级对话框状态、快捷键分发、设置加载、会话/Trace/Artifact 操作 |
| `components/conversation/message-list.tsx` | Static 历史、活动 Markdown、工具组和 ReasoningPanel 组合 |
| `components/conversation/markdown.tsx` | Marked token 到 Ink Text/Box 的块级与行内渲染 |
| `components/conversation/code.tsx` | 代码、命令和 diff 行的终端高亮 |
| `components/conversation/tool-call-card.tsx` | 参数摘要、运行状态、耗时、输出尾部、Artifact 与改动 |
| `components/conversation/plan-panel.tsx` | 真实 TaskPlan 状态、当前说明和完成证据 |
| `components/conversation/reasoning-panel.tsx` | 最近 3 行预览、展开后 24 行、状态和耗时 |
| `components/input/composer.tsx` | 草稿、历史、多行、Slash 建议、Tab 补全和提交 |
| `components/dialogs/approval-dialog.tsx` | 风险、命令、原因和 y/n/Esc 操作提示 |
| `components/dialogs/output-dialog.tsx` | 短输出本地分页，大输出按 Artifact API 加载 |
| `components/dialogs/sessions-dialog.tsx` | 会话列表、选择和恢复 |
| `components/dialogs/settings-dialog.tsx` | Provider 连接、模型发现、校验和保存 |
| `components/dialogs/user-input-dialog.tsx` | 多题单选、多选、自由输入、答案校验和提交状态 |
| `components/dialogs/trace-dialog.tsx` | 公共事件轨迹查看 |
| `components/dialogs/status-dialog.tsx` | 运行、上下文、缓存命中率、缓存读写、模型调用与验证状态 |
| `components/layout/status-bar.tsx` | phase、runId、文件数、上下文、Token、Provider 和后台任务 |
| `components/layout/spinner.tsx` | 使用共享 animation clock，避免每个 Spinner 独立定时器 |
| `runtime/viewport.ts` | `visibleTail` 限制输出可见尾部 |
| `runtime/plan.ts` | 旧会话缺少真实计划时的兼容回退投影 |

## 主题、宽度与测试边界

`parseThemePreference` 校验 preset 和单颜色覆盖，`applyTheme` 修改包内可变语义色对象。CLI 负责持久化，TUI 只接收 ThemePreference。

`useTerminalColumns` 跟踪终端宽度；布局需要覆盖 80×24、中文宽字符、超长代码行和 NO_COLOR。状态不能只靠颜色区分，必须同时有文本或图标。

测试分层为 Store 纯函数、Controller Fake Transport、Ink 组件帧、真实键盘和 stdio E2E。渲染回归同时比较中间帧与最终帧，确保历史不重复、不清屏闪烁。

## 源码阅读地图

| 文件 | 实现内容 |
| --- | --- |
| `src/runtime/agent-controller.ts` | 客户端命令、delta 合批、恢复和任务通知 |
| `src/runtime/store.ts` | 公共事件到终端视图状态的投影 |
| `src/runtime/timeline.ts` | 按事件顺序构造可追加历史块 |
| `src/components/conversation/markdown.tsx` | 终端 Markdown token 渲染 |
| `src/components/conversation/tool-call-card.tsx` | 工具状态、diff、输出和验证摘要 |
| `src/components/input/composer.tsx` | 任务输入、历史、命令和 Steering |
| `src/components/dialogs/` | 审批、会话、Trace、设置、主题与输出查看器 |
| `src/theme/` | 主题预设、语义颜色和终端应用 |

测试同时覆盖 reducer、真实键盘、中间帧和最终帧，以及 stdio 子进程端到端任务，不能只验证组件可以渲染。
