---
slug: observability
name: "@fidoo/observability"
path: packages/observability
group: 运行与基础设施
order: 7
summary: 把运行事件投影为可查询的 Trace、Span、指标和脱敏详情。
description: Observability 是只读投影层。它不参与任务执行，不反向修改 EventStore，而是从 canonical events 构造运行摘要、模型与工具 Span、验证阶段和聚合指标。
keywords: Trace, Span, 脱敏, 指标, 事件投影
dependencies: @fidoo/protocol
---

## 包职责与只读边界

Observability 将公共运行事件转换为调试读模型。它不影响 AgentLoop，不提供任务写入接口，也不要求 Web 消费者理解 JSONL 的物理布局。

核心输出是 RunTrace：包含运行状态、起止时间、Token、工具与文件统计，以及按时间排序的模型、工具和验证 Span。

## Trace 与 Span 投影

`projector.ts` 按事件生命周期组合 Span：

| 事件 | 投影行为 |
| --- | --- |
| `model.started/completed/failed` | 创建并完成模型 Span，记录耗时与错误 |
| `tool.proposed/started/result` | 建立工具调用、审批、执行和结果关系 |
| `verification.requested/finished` | 创建验证阶段并记录真实证据 |
| `model.usage` | 聚合总输入、输出、普通输入、缓存读取和缓存写入 Token |
| `run.completed/failed/blocked/cancelled` | 推导运行终态和未完成 Span |

每个 Span 保存 `spanId`、`kind`、`name`、`status`、`startedAt`、`endedAt`、`durationMs` 和关联 `eventIds`。未闭合 Span 在运行中显示 pending，在异常终态显示 incomplete。

```ts
interface TraceSpan {
  kind: "model" | "tool" | "verification";
  status: "success" | "error" | "running" | "incomplete";
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  eventIds: string[];
}
```

`verified` 来自真实 `run.completed` 和验证状态，不解析模型摘要文本猜测。

## 默认脱敏

`redact.ts` 在请求与结果详情进入投影前处理敏感键和值。观测需要足够调试上下文，但不能成为凭证或环境变量的旁路。

公共观测 DTO 只保存必要摘要，不保存 Provider 凭证、原始推理历史或完整大输出。Artifact 内容仍通过受限读取接口按需获取。

## 消费方式与扩展

`types.ts` 定义运行、Span 和指标结构，`events.ts` 提供事件读取辅助。Observability App 是当前消费者，未来也可以将同一读模型导出到其他分析界面。

新增事件时先更新 projector 的明确分支，再增加包含完整生命周期和异常中断的投影测试。不要只根据事件名称拼一条展示文本。

## projectRun 投影流程

`projectRun(runId, input)` 首先过滤其他 run 的事件，再按 seq 建立唯一事件序列。它同时构造列表摘要和完整详情，因此列表页与详情页不会使用两套互相矛盾的状态判断。

实现分为几个累积器：

- Run 元数据：task、cwd、status、createdAt、updatedAt、finalSummary 和 error。
- Model builders：按 iteration 建立模型调用，记录 duration、contentLength、toolCalls 和错误。
- Tool builders：按 callId 关联 proposed、approval、started 和 result。
- Verification builders：按请求与完成事件构造验证阶段。
- Messages：从公共用户、助手和工具事件构造只读消息视图。
- Metrics：累加总输入、输出、普通输入、缓存读取、缓存写入、模型调用、工具调用、失败工具、文件数和验证状态。`cacheHitRate = Σ cacheReadTokens / Σ inputTokens`，不是各轮命中率的算术平均；旧事件缺少缓存字段时按普通输入兼容。

最终 operationSpans 按 startedAt 排序，再与 run Span 组成完整 Trace。持续时间和 endedAt 都从事件 timestamp 计算，而非读取观测时的当前时间，保证离线重放结果稳定。

## 工具与审批异常状态

工具只有 proposed 没有 started 时保持未执行；started 后缺少 result 时，在运行中显示 running，在终态中标记 incomplete。被拒绝的工具显示 rejected，而不是 failed；工具结果 status=error 才记为 error 并增加 failedTools。

审批等待本身不增加工具执行耗时。工具 duration 优先使用 started 到 result 的间隔，避免把人工审批时间误算成进程执行时间。

## 验证 Span 与真实证据

`verification.requested` 创建或推进验证尝试，`verification.finished` 写入 success/error、evidence 和结束时间。完成事件的 `results` 保留真实命令和结构化检查信息。

`verified` 只在 run.completed 且 verification=passed 时为 true；not-required 会明确区分于“已通过测试”，防止无改动问答被统计成代码验证成功。

## 事件过滤与分页

`persistentEvents` 移除临时 delta，只保留可恢复事件。`paginateEvents(events, afterSeq, limit)` 先过滤 seq 大于 afterSeq 的项，再截取 limit，返回 items、total、offset 信息和下一页位置。

观测接口的分页只改变展示窗口，不修改原始数组。调用方可以用相同 afterSeq 重试，分页逻辑本身没有写副作用。

## 脱敏规则明细

`redact` 递归处理对象和数组。对象键在移除连字符并转小写后匹配敏感集合，包括 authorization、cookie、password、private_key、session_token 和 token；命中后整个值替换为 `[redacted]`。

`redactText` 额外处理：

- 完整 PEM 私钥块。
- Bearer 后的凭证。
- 满足最小长度的 `sk-`、`key-`、`token-` 形式字符串。
- `apiKey=...`、`access_token: ...`、password 和 secret 等键值文本。

脱敏是默认防线，不等于完整密钥识别系统。新增 Provider 或日志格式时应补对应样本测试，仍应优先避免把敏感值写入事件。

## 源码阅读地图

| 文件 | 实现内容 |
| --- | --- |
| `src/projector.ts` | Run、Model、Tool 和 Verification Span 投影 |
| `src/types.ts` | 观测运行、Span、指标和状态 DTO |
| `src/redact.ts` | 事件详情的默认脱敏 |
| `src/events.ts` | 观测侧事件读取与整理 |

`tests/observability/projector.test.ts` 覆盖正常完成、失败、验证和聚合指标。
