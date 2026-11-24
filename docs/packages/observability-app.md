---
slug: observability-app
name: "@fidoo/observability-app"
path: apps/observability
group: 客户端与应用
order: 10
summary: 本地运行 Inspector，由 Node 查询服务与 React Trace Web UI 组成。
description: Observability App 提供运行列表、事件时间线、消息、Artifact 和 Trace 查看。它是只读开发工具，与 Agent TUI 分离，不通过浏览器直接执行本地工具。
keywords: Inspector, Vite, Trace UI, 运行列表, Artifact
dependencies: @fidoo/api, @fidoo/core, @fidoo/node-runtime, @fidoo/observability, @fidoo/protocol, react, vite
---

## 包职责与进程划分

Observability App 由两个入口组成：

- `src/server`：读取本地 EventStore，构造观测读模型，提供只读 HTTP 查询。
- `src/web`：React + Vite 单页应用，只通过 `/v1/observability` 获取数据。

浏览器不直接访问任意文件路径，也不接收 Bash 或审批写入能力。这保持 Inspector 的只读边界。

## 本地服务与开发代理

```bash
pnpm dev:observability
# Web: http://127.0.0.1:5173
# API: http://127.0.0.1:4173
```

开发时 Vite 将 `/v1/observability` 代理到 Node 服务。生产构建输出 `dist/server` 与 `dist/web`，`fidoo-inspect` 启动本地服务并托管静态页面。

`server/source.ts` 使用 `@fidoo/observability` 的 projector 生成 RunTrace，并支持读取其他进程追加的事件和 afterSeq 重放。

## Web 功能与组件

| 模块 | 功能 |
| --- | --- |
| `runs-page.tsx` | 运行列表、状态、时间、模型与工具聚合指标 |
| `run-detail-page.tsx` | 单次运行详情和视图切换 |
| `trace-view.tsx` | Span 时间线、持续时间和关联详情 |
| `events-view.tsx` | 公共事件序列调试 |
| `messages-view.tsx` | 用户、助手与工具消息阅读 |
| `artifacts-view.tsx` | 查看受限大输出 |

`app-shell.tsx` 提供整体导航，`theme-toggle.tsx` 只改变观测 Web 主题，不写 TUI 主题配置。

## 只读安全边界

Inspector 不提供 `run.start`、审批响应或命令执行，避免只读观测界面扩大成未鉴权控制面。Artifact 通过 ID 和受限接口读取，而不是把本地路径交给浏览器。

若未来提供远程观测，需要独立认证和授权；当前本地监听不等于可以直接暴露到公网。

## HTTP 查询路由明细

所有 API 位于 `/v1/observability`，只允许 GET 和 HEAD；其他方法返回 405 与 `Allow: GET, HEAD`。

| 路由 | 查询参数 | 实现 |
| --- | --- | --- |
| `/runs` | q、status、offset、limit | FileObservabilitySource.listRuns，并附加当前页聚合 summary |
| `/runs/:runId` | 无 | 返回完整 RunProjection |
| `/runs/:runId/events` | afterSeq、limit | 返回持久事件分页 |
| `/runs/:runId/stream` | afterSeq | 以 SSE 轮询持久事件，支持 Last-Event-ID |
| `/runs/:runId/artifacts/:id` | offset、limit | 返回受限 Artifact 分页 |

runId 只允许字母、数字、下划线和连字符，Artifact ID 只允许 8 到 64 位小写哈希字符。数值参数必须是安全整数并位于指定范围内，错误映射为 400；不存在资源映射为 404。

列表 summary 聚合 active、completed、failed、blocked、cancelled、Token、工具数和失败工具数。它基于当前查询页，不应被误解为全部存储的全局统计。

## SSE 增量实现

`/stream` 设置 `text/event-stream`、禁用缓存和代理缓冲，每 750ms 调用一次 `getEvents(lastSeq, 1000)`。每条事件使用 `id: runId:seq`、事件类型和 JSON data，随后推进 lastSeq。

- 浏览器重连时从 Last-Event-ID 的最后一段恢复 seq。
- 持久事件出现终态后清理 timer 并结束响应。
- 轮询错误发送 `stream.error`，保留 lastSeq 供客户端诊断。
- 每 15 秒写一行注释心跳，不进入 Agent 事件。
- `polling` 防止上一轮慢查询与下一轮并发。
- request close 清理轮询和心跳 timer。

这是只读观测流，与 Agent API 的未来远程传输无关，不承载审批或写命令。

## FileObservabilitySource

`listRuns` 从 FileEventStore 获取摘要，可按状态与 q 过滤，再分页；需要指标时读取相应事件并调用 `projectRun`。`getRun` 加载单个 run 的全部公共事件后投影；`getEvents` 先映射再过滤临时事件；`readArtifact` 委托 FileArtifactStore。

观测读取发生在请求时，不维护另一份持久数据库。因此其他进程追加 JSONL 后，下次轮询能看到新事件。

## 静态站点与安全头

非 API 路径由 `serveStatic` 处理，无扩展名路径回退 index.html。解析后的真实目标必须仍在 webRoot 内，路径穿越返回 403。HTML 使用 no-cache，带哈希静态资源使用一年 immutable。

响应设置 CSP、nosniff、no-referrer、same-origin CORP 和禁止 frame。默认 CSP 只允许同源脚本、样式和连接，降低观测详情被注入的风险。

## Web 数据请求与页面状态

`src/web/lib/api.ts` 的每个请求接受 AbortSignal。运行列表在 q/status 改变时取消旧请求，避免慢响应覆盖新筛选；详情页按 runId 获取投影，事件和 Artifact 分页独立加载。

`RunsPage` 负责筛选和聚合卡片，`RunDetailPage` 负责当前标签和详情数据，Trace/Events/Messages/Artifacts 组件只处理各自读模型。主题通过 localStorage 保存并应用到根元素。

## 源码阅读地图

| 文件 | 实现内容 |
| --- | --- |
| `src/server/server.ts` | 本地只读观测 HTTP 服务 |
| `src/server/source.ts` | 事件存储到观测读模型的查询入口 |
| `src/web/features/runs/runs-page.tsx` | 运行列表和聚合指标 |
| `src/web/features/runs/run-detail-page.tsx` | 单运行详情与视图切换 |
| `src/web/features/runs/trace-view.tsx` | Span 时间线与详情 |
| `src/web/lib/api.ts` | 浏览器观测 API 客户端 |

`tests/observability/server.test.ts` 使用真实服务验证只读查询、跨进程追加和事件恢复。
