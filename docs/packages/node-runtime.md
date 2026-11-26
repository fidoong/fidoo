---
slug: node-runtime
name: "@fidoo/node-runtime"
path: packages/node-runtime
group: 运行与基础设施
order: 5
summary: Core 端口在本地 Node 环境中的完整适配器与组合根。
description: Node Runtime 是服务端基础设施集合，包含模型 Provider、工作区工具、权限文件、JSONL 事件、Artifact、后台进程和项目配置。它实现 Core 端口，但不改变领域规则。
keywords: Provider, 工具, DeepSeek, EventStore, Bash, 后台任务
dependencies: @fidoo/core, @fidoo/protocol, execa, openai, fast-glob, zod
---

## 包职责与组合根

`createNodeRuntime` 是组合根：加载项目指令、`.fidoo.json`、权限策略和 Provider 配置，创建 EventStore、ArtifactStore、Workspace 和 BackgroundTaskManager，再返回可替换 observer 与 approval 的 RunService 工厂。

```text
NodeRuntimeConfig
  → loadProjectInstructions + loadRequiredChecks + loadPermissionPolicy
  → createModel(config)
  → createCodingTools(tasks, requiredChecks)
  → Core RunService
  → AgentApi 或其他服务宿主
```

设置更新会创建新的运行时组合，同时复用同一个 BackgroundTaskManager，避免切换模型时丢失后台进程记录。

## Provider 适配器

`OpenAICompatibleModel` 处理兼容端点，DeepSeek、Anthropic 和 Gemini 适配各自协议。它们把厂商流式响应转换为 Core 的中立事件：正文、推理、工具调用、完整消息和 Token 用量。每次模型调用只输出一次最终 usage，统一为总输入、输出、普通输入、缓存读取和缓存写入 token。

- Base URL 可以显式配置，DeepSeek 等兼容服务不需要修改 Core。
- `UnavailableModel` 在模型或必需密钥缺失时给出配置错误。
- `model-discovery.ts` 查询可用模型，不进入 AgentLoop。
- `model-config.ts` 管理本地连接配置，Provider 私密字段不进入公共事件。

真实在线 Provider 冒烟测试与离线 FakeModel 评测保持分离，不能用协议单元测试声称在线联调成功。

### Prompt Cache 与上下文预算

- OpenAI 兼容适配器读取 `prompt_tokens_details.cached_tokens/cache_write_tokens`，也识别 DeepSeek 的 `prompt_cache_hit_tokens/prompt_cache_miss_tokens`。仅官方 OpenAI 连接发送稳定的工作区/模型哈希 `prompt_cache_key`，不向其他兼容服务盲发该字段。
- DeepSeek 使用服务端自动磁盘缓存，本地不维护第二份 KV Cache。
- Anthropic 在 system 末尾和最后一条持久消息设置显式 `cache_control`；临时 harness 不设置断点，也不只依赖会落在动态尾部的顶层自动缓存。
- Gemini 读取 `cachedContentTokenCount`，流式 chunk 中重复出现的累计 usage 只采用最后值；显式 cachedContent 生命周期管理尚未实现。
- 组合根使用 `modelContextBudget` 计算有效输入预算，模型窗口减去输出预留后再应用用户上限。缓存命中以 Provider 返回的真实 usage 为准，本地前缀哈希只用于诊断请求稳定性。

## 工作区与文件工具

`workspace.ts` 统一解析工作区路径，拒绝逃逸和敏感文件。`read_file` 返回 revision，`edit_file` 与覆盖式 `write_file` 要求 `expected_revision`，避免读取后被其他进程修改仍直接覆盖。

文件写入使用原子替换，并返回结构化 `changedFiles`。`glob`、`grep` 和 `repo_map` 提供受限探索；大仓库优先通过仓库索引识别入口、测试和符号，而不是无边界扫描。

工具输出通过 `boundedOutput` 限制上下文体积，大内容保存为 Artifact，只在消息中保留头尾和引用。

## Bash 与真实进程生命周期

Bash 不经过 shell，直接执行 `command + args`，不支持隐式管道、重定向、变量展开或命令替换。

```ts
const subprocess = execa(input.command, input.args, {
  cwd,
  shell: false,
  reject: false,
  all: true,
  detached: process.platform !== "win32",
});
```

macOS/Linux 使用独立进程组。取消或超时先向进程组发送 SIGTERM，5 秒后升级 SIGKILL，确保孙进程不会遗留在本地。stdout/stderr 通过临时 `tool.output.delta` 实时推送，最终输出仍进入工具结果与 Artifact。

前台、后台任务和 required checks 在执行前统一调用 `CommandExecutor.prepare`。它生成最小环境变量、run 专属 HOME/TMPDIR 和平台命令：macOS Seatbelt 使用 `sandbox-exec -f`，Linux/WSL2 Bubblewrap 使用只读系统挂载与网络命名空间。执行结果通过 `ExecutionObservation` 记录 direct/seatbelt/bubblewrap、网络策略和降级 warning；`required` 不可用会失败，`auto` 不允许静默降级。配置读取只信任 `<FIDOO_HOME>/execution.json`，防止仓库自行关闭隔离。

Windows 环境读取按大小写不敏感处理 PATH/SystemRoot 等变量，同时隔离 USERPROFILE、TMP 和 TEMP。直接命令的强制清理由 `taskkill /pid <pid> /t /f` 完成。与 Claude Code 的平台策略一致，原生 Windows 不提供文件/网络沙箱；需要隔离时，把整个 Fidoo CLI/server 放进 WSL2，此时进程平台为 Linux，直接复用 Bubblewrap 后端，不经过 `wsl.exe` 跨宿主转发。

识别为验证的命令会附带 `VerificationEvidence`，包括检查类型、状态、退出码、耗时和失败分类。匹配项目 required check 时还写入 `checkId`，并使用项目配置的超时时间。

## 持久后台任务

`bash(background: true)` 启动持久任务。BackgroundTaskManager 将元数据写入 `task.json`、输出写入 `output.log`，记录进程组与真实退出码。

`task_list`、`task_output`、`task_stop` 是 Agent 工具；公共 API 同时提供 `task.list/output/stop/subscribe`。任务状态区分运行、自然退出、失败和人工停止，轮询不会把稍后得到的真实 exitCode 抢先抹掉。

服务重启后可以查询记录并停止仍存活的进程组，但不会假装恢复已经丢失的内存流。

## 存储、权限与项目验证

`FileEventStore` 使用进程内追加队列、跨进程文件锁、连续 seq 和 eventId 唯一校验；锁实现处理死进程遗留锁。`MemoryEventStore` 保留相同约束，供测试使用。

权限策略按内置、用户、项目和显式文件合并。项目策略只能收紧，CLI `read-only` 是不可覆盖的硬边界。策略不是操作系统沙箱，获批 Bash 仍拥有当前用户权限。

`.fidoo.json` 的 `verification.requiredChecks` 由 `project-verification.ts` 严格读取，未知字段、无效 JSON 和重复 id 会启动失败。

## 工具注册与完整工具矩阵

`createCodingTools(tasks, requiredChecks)` 返回固定顺序的工具列表，`updatePlanTool` 由组合根额外放在最前。ToolRegistry 会拒绝重名工具，因此新增工具必须同时检查模型描述、Schema、风险与测试。

| 工具 | 输入与实现 | 副作用与结果 |
| --- | --- | --- |
| `read_file` | path、offset、limit；解析真实路径并校验工作区 | 返回带行号内容、revision、分页信息，不写文件 |
| `glob` | 安全 glob、忽略规则与结果上限 | 返回匹配路径，不执行内容读取 |
| `grep` | 正则、路径范围与上下文参数 | 返回匹配位置和内容，限制结果规模 |
| `repo_map` | `buildRepoIndex` 扫描入口、包配置、测试和符号 | 返回文本仓库索引，供后续聚焦读取 |
| `edit_file` | path、old_string、new_string、expected_revision | 唯一精确替换、revision 校验、原子写入、changedFiles |
| `write_file` | path、content、可选 expected_revision | 已存在文件必须匹配 revision，新文件准备安全父目录 |
| `bash` | command、args、cwd、timeout_ms、background | 前台执行或持久后台任务，流式输出和验证证据 |
| `task_list` | 可选 runId | 读取持久任务并按开始时间倒序 |
| `task_output` | taskId、offset、limit | 流式读取日志并返回 nextOffset |
| `task_stop` | taskId | 停止整个进程组并持久 stopped 状态 |
| `update_plan` | 标题与稳定步骤列表 | 返回计划更新，由 AgentLoop 写 `plan.updated` |
| `report_blocked` | 具体阻塞原因 | 工具成功后 AgentLoop 写 `run.blocked` |
| `apply_patch` | 多文件、多个精确替换及各自 expected_revision | 全部预校验后统一写入，写入失败回滚 |
| `move_file` | source_path、target_path、源 revision | 工作区内重命名/移动，不覆盖已有目标 |
| `delete_file` | path、expected_revision | 只删除普通文件并保留恢复快照 |
| `workspace_status` | 当前 runId | 返回新增/修改/删除、增删行与 canUndo |
| `workspace_diff` | 可选 paths | 返回首次 Agent 修改前的标准 unified diff |
| `undo_file` / `undo_run` | path 或当前 runId | 高危审批后恢复，外部修改会拒绝 |
| `run_required_checks` | checkIds、onlyAffected | 逐条执行项目检查并返回 verifications |
| `read_many_files` | 最多 20 个 paths、共享分页 | 并行读取，保留每文件 revision |
| `list_directory` | path、limit | 只列直接子项，目录带 `/` |
| `read_image` | PNG/JPEG/WebP/GIF path | 魔数校验、5 MiB 限制、Artifact 图片引用 |
| `delegate_task` | 聚焦的只读研究 task | 独立子 run、只读工具、无嵌套代理 |
| `web_search` | query、limit | Tavily/Brave/SearXNG 结构化结果 |
| `web_fetch` | 公开 URL、max_chars | 限制重定向、类型、大小和私网目标 |

所有工具通过 `ToolContext` 获得 runId、根 cwd、AbortSignal、ArtifactStore 和 onOutput。工具不能自行绕过 context.cwd 访问另一项目。

## 文件写入与并发安全

`prepareWritePath` 同时检查逻辑路径和真实父目录，防止通过符号链接把写入引到工作区外。`atomicWrite` 先写同目录临时文件，再 rename 到目标，避免读取方看到半截内容。

revision 是当前文件内容的 SHA-256。编辑前如果磁盘 revision 与 `expected_revision` 不一致，工具失败并要求重新读取。这把“模型基于旧内容覆盖新改动”变成显式冲突，而不是静默丢失。

`edit_file` 要求 old_string 能唯一匹配；零处或多处都失败。`write_file` 对已有文件同样要求 revision，新建文件则检查路径安全性。

## 工作区路径与敏感文件

`resolveWorkspacePath` 只做逻辑解析，`resolveExistingPath` 进一步使用 realpath 检查真实路径。`assertInsideWorkspace` 要求目标等于根目录或以根目录加分隔符开头，避免 `/project-other` 被误判为 `/project` 内部。

敏感名称包括 `.env`、常见证书私钥、凭据和 SSH 私钥；这些规则主要保护专用文件工具。Bash 是独立执行能力，其权限由 PolicyEngine 和审批控制，不共享文件工具的全部路径检查。

`workspaceIgnore` 读取 `.gitignore` 并形成匹配器；`assertSafeGlob` 拒绝绝对路径与 `..` 分段。

## Bash 前台执行细节

前台 Bash 使用 `all: true` 合并 stdout/stderr 供最终结果读取，同时分别监听两个流并调用 `onOutput`。`maxBuffer` 为 10 MiB，`boundedOutput` 再把发送给模型的内容限制为 16 KiB，大输出完整保存 Artifact。

定时器调用 `unref()`，不让超时计时器本身阻止进程退出。`finally` 清理 timeout、强制终止 timer 和 abort listener，避免长会话累积监听器。

退出状态同时检查自定义 timedOut、execa timedOut、exitCode 和 failed。内容包含命令、退出码、状态、原始输出和 JSON 格式 VerificationEvidence，供模型准确理解失败。

## 验证识别与失败分类

`classifyVerification` 支持 pnpm/npm/yarn/bun 脚本、`exec/dlx`、npx/pnpx、Node test、Python pytest/unittest、Go、Cargo、Make 和常见直接可执行工具。

失败分类先判断 timeout，再识别 126/127、ENOENT、模块缺失等环境问题；普通非零退出归入对应 test/typecheck/lint/build。通用 check 的失败使用 command 类别。

`requiredCheckForCommand` 要求 executable、args 数组和 cwd 精确匹配。仅有相似命令文本不会冒充必需检查；匹配后证据带 checkId，Core 按 ID 验收。

## 后台任务状态机与持久化

任务目录为 `<FIDOO_HOME>/tasks/<taskId>/`，包含 `task.json`、`task.lock` 和 `output.log`。目录权限 0700，文件权限 0600。

```text
start
  → running + task.started
  → waitForExit → exited | failed + task.finished
  → stop → stopped + task.finished
```

`waitForExit` 先等待进程，再结束日志流，最后检查当前状态。如果 stop 已写 stopped，自然退出不能覆盖它。`persist` 在文件锁内重读记录，已有 stopped 时也拒绝其他状态覆盖。

`refreshExitedTasks` 只处理持久记录中仍标 running、进程已消失且不在 active/stopping 集合的任务。active 任务留给真实 waitForExit 写 exitCode，避免轮询抢先写 exited 导致退出码丢失。

无 root 的 Manager 用于测试或纯内存场景，输出在内存最多保留最后 1 MiB；文件模式按行流式分页，不把整个日志一次性读入内存。

直接 API 停止任务时必须提供 taskId、runId 和 `confirmed: true`。AgentApi 先校验任务归属，再通过 RunService.evaluateAction 应用当前权限；read-only、plan、dontAsk 和显式 deny 不会因 TUI 确认而失效。

## 子代理适配器

`RunServiceSubagent` 在启动前生成 childRunId 并触发 onStarted，再以只读 RunService 启动独立 run。`RunOrigin` 保存 parentRunId、parentCallId 和 explore 类型；子代理只注册 effect=read 的工具，不能 Bash、写入或嵌套委托。返回父级前包含状态与摘要，父级生命周期事件由 Core AgentLoop 统一追加。

## EventStore 与文件锁

`FileEventStore.append` 先进入进程内 Promise 队列，再通过 `<run>.lock` 跨进程互斥。锁内重新加载现有事件，检查 eventId 唯一、seq 必须等于当前长度 + 1，然后追加一行 JSONL。

`withFileLock` 处理等待、释放和遗留锁恢复。跨进程测试会启动两个真实 Node 进程竞争同一 run，验证最终序号连续且无重复 eventId。

`load` 按行解析并校验事件，`list` 从存储构造会话摘要。MemoryEventStore 使用相同连续性检查，避免单元测试中的假存储放宽约束。

## Artifact 内容寻址

`FileArtifactStore.save` 对内容计算哈希，Artifact ID 与内容关联。`read` 要求 runId、合法哈希前缀和分页参数，返回行分页与 nextOffset。Artifact 读取不是任意文件读取，不能通过 `../` 或绝对路径逃逸。

MemoryArtifactStore 提供同一接口，供 AgentLoop 和工具测试验证截断、保存与读取闭环。

## Provider 流式适配明细

`openProviderStream` 统一发起带 AbortSignal 的 HTTP 请求并检查响应；`readSse` 按 SSE 边界读取 data 和 event，处理流式分片。Provider 适配器再将各自事件映射为中立 ModelEvent。

| 适配器 | 主要处理 |
| --- | --- |
| OpenAICompatibleModel | OpenAI Chat Completions 兼容请求、工具调用增量、usage 与 finish |
| DeepSeekModel | 复用兼容协议并处理 reasoning/thinking 配置 |
| AnthropicModel | Anthropic 消息、内容块和工具输入差异 |
| GeminiModel | Gemini 内容、函数调用与用量差异 |
| UnavailableModel | 未配置时直接抛配置错误，不发送请求 |

模型发现通过 `discoverProviderModels` 使用已保存或当前输入的连接。`NodeSettingsManager.updateSettings` 先校验 Provider、模型、URL 和必需密钥，再创建新运行时，最后按需持久化；新组合失败时不应把无效配置当作已保存成功。

## 权限文件与审批适配器

`loadPermissionPolicy` 合并内置、用户、项目和显式策略，记录规则来源。项目文件被降权，不能放宽到 auto 或 allow；显式配置路径缺失、未知字段和空规则会启动失败。

`InteractiveApproval` 用于直接终端审批，`RejectApproval` 是非交互服务默认拒绝实现，真正 TUI 审批由 API 的 ApprovalBroker 注入。

## 变更快照与撤销实现

`WorkspaceChangeManager` 在首次 mutation 前保存 before 内容、beforeRevision 和 lastRevision。记录位于 `<FIDOO_HOME>/changes/<runId>/<path-hash>/`，包含 record.json、before.txt 和 change.lock；纯内存 Manager 用于测试。

`workspace_status` 对比 before 与当前文件，计算 added/modified/deleted、增删行和 unified diff。新增后又被删除的文件不会留下无效变更。`afterMutation` 更新 lastRevision，undo 前要求当前 revision 仍等于 lastRevision；用户或外部进程的后续修改会阻止覆盖。

`undoRun` 先检查全部记录再恢复，避免已知冲突造成部分撤销。`apply_patch` 则先计算全部目标内容，写入异常时恢复本批已写文件。两条路径解决不同的原子性边界。

## WebSearch 配置与 WebFetch 安全

`.fidoo.json` 的 `search` 只允许 provider 和 baseURL，API Key 从 `FIDOO_SEARCH_API_KEY` 注入。仅设置环境 Key 时默认 Tavily；SearXNG 必须提供 baseURL。Tavily、Brave 和 SearXNG 的响应统一为 title/url/snippet。

`web_fetch` 手动处理最多五次重定向，每个目标都重新校验。默认拒绝 URL 凭证、localhost、私网 IP、非文本内容和超过 1 MiB 的响应；HTML 去除脚本、样式和头部后转换为有界纯文本。DNS 检查不能替代完整网络沙箱，企业环境仍应使用出口代理和网络策略。

## 源码阅读地图

| 文件 | 实现内容 |
| --- | --- |
| `src/composition-root.ts` | Node 运行时依赖装配与 RunService 工厂 |
| `src/project-verification.ts` | `.fidoo.json` 读取、严格校验与必需检查 |
| `src/adapters/tools/bash.ts` | 直接进程执行、流式输出、验证证据和进程组终止 |
| `src/adapters/tasks/background-task-manager.ts` | 后台任务元数据、日志、进程组和持久化 |
| `src/adapters/subagents/run-service-subagent.ts` | 只读子代理、childRunId 回调和 RunOrigin 持久化 |
| `src/adapters/storage/file-event-store.ts` | JSONL 事件追加、锁、序号和恢复 |
| `src/adapters/storage/file-artifact-store.ts` | 内容寻址的大输出 Artifact |
| `src/adapters/models/` | 中立流到各厂商 API 的适配 |
| `src/adapters/system/workspace.ts` | 工作区边界、敏感文件与路径安全 |

真实进程测试位于 `tests/tools/bash-policy.test.ts`、`tests/tools/background-tasks.test.ts` 和 `tests/storage/file-event-store.test.ts`。
