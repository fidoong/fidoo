# Fidoo 权限策略配置

Fidoo 使用本地工具级权限控制。策略配置决定工具调用是自动允许、需要审批还是直接拒绝；它不是操作系统沙箱。

## 1. 配置文件与优先级

按以下顺序加载：

1. 内置策略：`ask`
2. 用户全局配置：`~/.fidoo/policy.json`
3. 项目配置：工作区根目录 `fidoo.policy.json`
4. 显式配置：`--policy <path>`，相对路径以工作区为基准
5. CLI 模式：`--read-only`、`--dont-ask`、`--dangerously-bypass-permissions`

所有命中的配置来源都会合并，规则按加载顺序追加，**最后一条匹配规则优先**。CLI 模式优先于配置文件中的 `mode`。`read-only` 是硬边界，任何 allow 规则都不能放行写入或执行工具。

项目配置属于仓库内容，只能收紧权限：不允许 `mode: "auto"` 或 `action: "allow"`。需要放宽权限时，使用用户全局配置或显式 `--policy` 文件。

## 2. 示例

```json
{
  "version": 1,
  "mode": "manual",
  "rules": [
    {
      "action": "allow",
      "tools": ["bash"],
      "commands": ["git status", "git diff*"],
      "reason": "Allow read-only repository inspection"
    },
    {
      "action": "allow",
      "tools": ["edit_file", "write_file"],
      "paths": ["src/**", "tests/**"],
      "reason": "Allow changes inside product and test sources"
    },
    {
      "action": "deny",
      "effects": ["write"],
      "paths": ["src/generated/**"],
      "reason": "Generated files must not be edited"
    },
    {
      "action": "deny",
      "tools": ["bash"],
      "commands": ["git push*", "rm *"],
      "reason": "Remote writes and recursive deletion require a separate workflow"
    }
  ]
}
```

启动时指定额外可信策略：

```bash
fidoo --policy ./company-policy.json
```

查看最终模式、来源和规则数：

```bash
fidoo doctor
```

无效 JSON、未知字段、无匹配条件的空规则或缺失的显式配置都会导致启动失败，不会静默退回宽松策略。

## 3. 规则匹配

每条规则必须包含 `action` 和至少一个选择器：

- `tools`：工具名，例如 `bash`、`edit_file`，支持 `*`。
- `effects`：`read`、`write`、`execute`、`network`。
- `risks`：`low`、`medium`、`high`，Bash 风险在动态分级后匹配。
- `commands`：仅匹配 Bash，针对 `command + args` 的原始空格连接文本。
- `paths`：匹配工具输入的工作区相对 `path`。
- `reason`：可选，进入审批原因和工具事件，便于审计。

不同选择器之间是 AND，同一选择器的多个值是 OR。命令通配符的 `*` 可以匹配空格；路径通配符中 `*` 不跨目录，`**` 跨目录，`**/*.test.ts` 同时匹配根目录和子目录测试文件。

## 4. 默认模式

- `manual`：低风险读取自动允许，编辑、执行和网络按规则审批。
- `auto`：需要模型审查的操作进入 AutoReviewPort；不再按风险等级直接放行。
- `read-only`：所有非 read 工具直接拒绝，不能被规则或后续模式切换覆盖。
- `plan` / `acceptEdits`：行为语义见下一节，不属于宽松的全局自动执行开关。

每次批准仍然只作用于一个 `runId + callId`。规则、审批原因和工具结果均进入事件轨迹。

## 5. 安全边界

allow 只代表 Fidoo 不再次询问。未启用 OS 沙箱时，获批 Bash 命令仍可访问当前用户可访问的文件、网络和凭据；沙箱能力则由所选后端和配置决定。文件工具的工作区限制、敏感文件拒绝、revision 乐观锁和原子写入仍然有效，但 Bash 不受这些文件工具约束。

需要不可信代码隔离时，应启用下述 OS 沙箱，并视风险选择容器或独立用户，不能仅依赖权限 JSON 配置。

## 6. Agent 行为模式

行为模式与 `read-only`、`dontAsk` 等硬约束分离。v2 不保留旧 ask、旧 auto 或 --yes 别名，配置和 CLI 统一使用下述模式。

| 模式 | 行为 |
| --- | --- |
| `plan` | 只允许读取、规划、用户问答和受控只读命令；完成时进入 awaiting_plan，批准后选择 manual、acceptEdits 或 auto |
| `manual` | 读取自动允许，编辑、执行和网络按规则审批 |
| `acceptEdits` | 自动接受工作区内文件编辑工具；普通 Bash、撤销、外部路径和高危操作仍需审批 |
| `auto` | 需要审查的操作调用独立模型 AutoReviewPort；失败回退人工审批，dontAsk 下直接拒绝 |

单次启动可使用 `fidoo --mode plan|manual|acceptEdits|auto`。项目策略不能启用 auto 或 acceptEdits。

Plan 完成不会直接写 run.completed，而是产生 `plan.awaiting_approval`。`plan.respond` 必须携带当前 revision，过期计划会被拒绝；批准后写入 `plan.approved` 和 `mode.changed` 并恢复原 run，拒绝则保持 plan，携带反馈继续规划。运行中通过 `mode.get/set` 读取和切换，所有变化都进入事件重放。

Auto Reviewer 只接收当前任务、原始任务背景、工具参数、风险和沙箱等必要信息，不能调用工具，不保存隐藏推理。当前任务始终取最新用户指令，避免恢复会话后按旧任务拒绝。审查产生 `permission.review.started/completed/failed`，Reviewer usage 计入模型用量。超时、断流和非法 JSON 默认 ask；相同工具连续三次 out_of_scope 后明确 blocked，防止无限换参数重试。

`--dont-ask` 将所有需要询问的操作变成拒绝；需要用户输入或计划审批时明确 blocked，不会无人值守挂起。`--dangerously-bypass-permissions` 只绕过普通提示，不能覆盖 read-only、plan 或组织 deny，且必须启用 `sandbox=required`，否则启动失败。

TUI 直接停止后台进程时也必须提交所属 runId 和显式确认。服务端通过 `RunService.evaluateAction` 使用重放后的当前模式、规则和 dontAsk 求值；前端确认框不能绕过 read-only、plan 或 deny。

## 7. OS 沙箱与环境变量隔离

前台 Bash、`background=true` 后台任务和 `run_required_checks` 共用 `CommandExecutor`。所有命令都使用最小环境变量：默认只继承 PATH、语言、终端、CI 等安全值，API Key、TOKEN、SECRET 和其他变量不会自动传入；HOME 与 TMPDIR 指向 `<FIDOO_HOME>/sandboxes/<runId>/` 下的独立目录；Windows 同时隔离 USERPROFILE、TMP 和 TEMP，并按大小写不敏感读取 PATH 等系统变量。

受信任配置位于 `<FIDOO_HOME>/execution.json`，项目仓库不能通过自带文件关闭沙箱或放开网络：

```json
{
  "mode": "auto",
  "network": "deny",
  "environment": {
    "allow": ["NPM_CONFIG_LOGLEVEL"],
    "set": { "CI": "true" }
  }
}
```

- `mode=auto`：默认。macOS 使用 Seatbelt，Linux/WSL2 使用 Bubblewrap；原生 Windows 或其他后端不可用时降级为 direct，并在 ToolResult 写入明确 warning。
- `mode=required`：没有可用后端时直接拒绝执行，不降级；原生 Windows 会提示把整个 Fidoo 放入 WSL2。
- `mode=off`：不启用 OS 文件/网络沙箱，但环境变量隔离仍然生效。
- `network=deny`：默认禁止子进程网络；`allow` 只能在受信任配置中设置。

单次运行可用 `fidoo --sandbox required` 或 `fidoo-server --sandbox required` 覆盖 mode。`fidoo doctor` 的 `execution` 字段展示模式、网络、实际后端和是否降级，不展示环境变量值。

Seatbelt 只放开系统只读路径、运行时安装目录、当前工作区和 run 专属目录；父目录仅允许遍历所需的目录读取，不放开其中文件内容。Bubblewrap 使用只读系统挂载、工作区/run 目录可写、独立 `/tmp` 和网络命名空间。

Windows direct 使用 `taskkill /pid <pid> /t /f` 强制清理进程树。与 Claude Code 一致，原生 Windows 不提供文件/网络沙箱；需要沙箱时，在 WSL2 发行版内安装 Node、pnpm 和 Bubblewrap，并从 WSL2 启动整个 Fidoo CLI/server。这样所有工具调用、路径和进程生命周期都留在同一个 Linux 环境中，不经过 `wsl.exe` 跨宿主转发。

当前实现不包含统一 CPU/内存限额和按域名放行；这些场景仍需要容器资源策略、独立用户或企业网络策略。`.github/workflows/windows.yml` 提供原生 Windows direct CI；WSL2 的 Bubblewrap 行为仍需在对应环境专项验收。
