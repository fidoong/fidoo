# Fidoo Agent 核心加固开发计划

## 目标

在暂缓 Web、Desktop 和 HTTP 传输的前提下，将现有 Agent + CLI/TUI 从完整原型推进到可持续使用的消费级编码工具。优先提高任务成功率、运行一致性、故障恢复和验证可信度，不以新增 Provider 或界面数量作为阶段目标。

## 现有基础

- 独立 Core、Agent API、Client、Node Runtime 和 TUI，本地 stdio 与进程内传输共享公共协议。
- ReAct 执行、流式消息、工具审批、计划、Steering、取消和事件溯源已形成闭环。
- JSONL 事件、Artifact、会话恢复、上下文裁剪和修改后验证门禁已经可用。
- 文件工具具备工作区限制、敏感文件拒绝、revision 乐观锁和原子写入。
- TUI 已支持会话、Trace、Diff、输出查看器、主题及 append-only 历史渲染。

## P0：运行一致性

### A. Run 命令串行化

状态：首个切片已完成，包含 run 级队列、失败隔离和并发恢复回归测试。

- 在 Agent API 边界为每个 run 建立串行命令队列。
- `run.start`、`run.resume`、`run.steer`、`run.cancel` 和 `approval.respond` 按 run 确定顺序。
- 并发恢复同一 run 时只允许一个执行实例，其他请求得到明确错误。
- 队列只包围命令处理，不包围整个 Agent 执行，避免长任务阻塞事件订阅和查询。
- 失败命令不能毒化后续队列，不同 run 仍可并行。

验收：并发 `resume` 不会产生两份 `run.resumed`、两条用户消息或两个模型执行实例；取消后的 Steering 明确失败。

### B. 存储原子性与请求幂等

状态：序号/eventId 校验、跨进程追加锁和 start/resume/steer/cancel/approval 幂等已完成；CLI 快捷写路径统一仍待后续。

- EventStore 增加序号连续性、eventId 唯一性和并发追加保护。
- 为本地跨进程操作增加安全的 run 锁，处理进程崩溃后的锁恢复。
- 将请求 ID 传入应用层，为 `run.start/resume` 和审批响应提供幂等结果。
- 统一 CLI 快捷命令与 Agent API 的写入路径，禁止绕过运行协调器。

验收：响应丢失后重试不会创建重复任务；两个进程操作同一 run 不会写入重复序号。

### C. stdio 断线恢复

状态：已完成 sidecar 重启、命令重试、快照恢复、事件续传、多订阅者共享恢复和 TUI 临时流清理。

- sidecar 崩溃检测、受控重启和指数退避。
- 通过 `run.get + run.subscribe(afterSeq)` 恢复快照与持久事件。
- 重连时清理临时正文/推理 delta，持久事件按 eventId 去重。
- 恢复活跃运行和待审批状态，界面断开不等于任务取消。

验收：在模型流式输出、工具执行和审批等待期间断开连接，恢复后无重复正文、丢失事件或误取消。

## P0：编码执行与验证

### D. ToolScheduler 与命令会话

状态：安全工具并行、写入/命令互斥、Bash 流式输出、进程组超时/取消、持久后台任务和全局退出通知已完成。

- 按 `concurrency` 调度工具：安全读取可并行，写入和执行保持互斥。
- 保持 tool result 与调用的确定性顺序，限制每个工具的输出和资源预算。
- Bash 增加流式输出、后台任务、停止/重启和进程组取消。
- 长任务状态通过公共事件暴露，TUI 不直接管理子进程。

验收：并发读取缩短探索耗时；取消命令后无残留子进程；开发服务器可跨模型轮次管理。

### E. 改动安全与结构化 Diff

状态：mutation 快照、结构化变更、统一 Diff、按文件/run 撤销、原子多文件补丁、移动和删除已完成；可选 Git worktree 隔离仍未实现，当前不强制目标目录为 Git 仓库。

- mutation 前快照，支持按文件和按 run 撤销；外部后续修改会阻止覆盖。
- 统一新增、修改、删除的结构化变更模型和标准 unified diff。
- `apply_patch` 支持跨文件 revision 预校验、统一写入和写入失败回滚。
- `workspace_status` / `workspace_diff` 读取当前 run 的变更，不依赖 Git。
- 可选 Git worktree 隔离，不强制目标目录为 Git 仓库。

### F. 可信验证与真实评测

状态：结构化验证结果、失败分类、项目 required checks、路径作用域、完成证据和 `run_required_checks` 工具已完成；多场景真实评测集与指标汇总仍待后续。

- 项目级 required checks、相关测试选择和结构化测试结果。
- 区分测试、类型、Lint、构建、环境和超时失败。
- 建立 bug fix、跨文件重构、新增功能、依赖升级、长会话和故障恢复评测集。
- 记录任务成功率、错误完成率、回归率、迭代数、Token/费用和人工接管率。

项目可在根目录 `.fidoo.json` 声明必需检查。`paths` 用于按改动文件选择检查；同一检查的最新失败会覆盖旧通过记录，任何改动后都必须重新满足适用检查。

```json
{
  "verification": {
    "requiredChecks": [
      {
        "id": "unit",
        "command": "pnpm",
        "args": ["test"],
        "timeoutMs": 120000,
        "paths": ["src/**", "tests/**"]
      },
      {
        "id": "types",
        "command": "pnpm",
        "args": ["typecheck"],
        "paths": ["src/**"]
      }
    ]
  }
}
```

验收：最终回复引用真实验证证据；离线评测与可选真实 Provider 冒烟测试分开执行。

## P1：大项目与长会话

### G. 上下文与仓库智能

- 使用模型匹配的 tokenizer，分别管理输入、输出和工具 Schema 预算。
- 语义压缩保留决策、修改、失败原因和当前证据，并支持结构化 checkpoint。
- 增量仓库索引、Tree-sitter AST 和 LSP 定义/引用/诊断。
- 编辑后立即获取诊断，并推荐变更影响范围内的测试。

### H. Prompt Cache 与成本观测

状态：稳定/临时上下文拆分、工具 Schema 复用、前缀诊断哈希、模型上下文预算、估算校准、统一缓存 usage、TUI/观测指标和 OpenAI/DeepSeek/Anthropic/Gemini 协议适配已完成。真实在线命中率、延迟与费用对比仍需按 Provider/模型做可选冒烟和评测。

- 持久消息只追加，动态 harness 独立传递，缓存断点不落在动态尾部。
- 命中率按累计 cacheReadTokens / inputTokens 计算，同时观察缓存写入和总 token，避免只优化比例。
- Anthropic 使用 system 与最后一条持久消息的显式断点；DeepSeek/OpenAI 使用服务端自动缓存能力。
- 后续补模型匹配的 tokenizer、真实编程任务对照评测和可选显式 Gemini cachedContent。

### I. Provider 与安全

- 流式中途故障恢复、Retry-After、能力探测、费用和运行预算。
- 可选操作系统沙箱、网络控制、环境变量最小化及事件/Artifact 密钥脱敏。
- 审批超时、会话级授权和项目信任机制。

## P2：消费级终端体验

- 会话搜索/重命名、全屏 Diff、滚动与复制模式、后台任务通知。
- 键位配置、NO_COLOR、80×24、中文宽字符和超长代码行专项验收。
- 长会话与大仓库的内存、渲染和索引性能基准。

## 当前执行顺序

1. Run 命令串行化与并发恢复回归测试。
2. EventStore 原子追加、跨进程锁和请求幂等。
3. stdio 自动重连与活跃审批恢复。
4. ToolScheduler 与 Bash 命令会话。
5. 结构化验证与真实任务评测。

每个切片必须通过 `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build` 和 `pnpm eval:offline`，并增加对应的真实故障场景，不能只验证 happy path。
