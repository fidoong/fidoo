# Fidoo 权限策略配置

Fidoo 使用本地工具级权限控制。策略配置决定工具调用是自动允许、需要审批还是直接拒绝；它不是操作系统沙箱。

## 1. 配置文件与优先级

按以下顺序加载：

1. 内置策略：`ask`
2. 用户全局配置：`~/.fidoo/policy.json`
3. 项目配置：工作区根目录 `fidoo.policy.json`
4. 显式配置：`--policy <path>`，相对路径以工作区为基准
5. CLI 模式：`--read-only` 或 `--yes`

所有命中的配置来源都会合并，规则按加载顺序追加，**最后一条匹配规则优先**。CLI 模式优先于配置文件中的 `mode`。`read-only` 是硬边界，任何 allow 规则都不能放行写入或执行工具。

项目配置属于仓库内容，只能收紧权限：不允许 `mode: "auto"` 或 `action: "allow"`。需要放宽权限时，使用用户全局配置或显式 `--policy` 文件。

## 2. 示例

```json
{
  "version": 1,
  "mode": "ask",
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

- `ask`：低风险自动允许，中风险和高风险逐次审批。
- `auto`：低风险和中风险自动允许，未命中显式规则的高风险命令直接拒绝。
- `read-only`：所有非 read 工具直接拒绝，不能被规则覆盖。

每次批准仍然只作用于一个 `runId + callId`。规则、审批原因和工具结果均进入事件轨迹。

## 5. 安全边界

allow 只代表 Fidoo 不再次询问，不会提升或限制子进程的操作系统权限。获批 Bash 命令仍可访问当前用户可访问的文件、网络和凭据。文件工具的工作区限制、敏感文件拒绝、revision 乐观锁和原子写入仍然有效，但 Bash 不受这些文件工具约束。

需要不可信代码隔离时，应另用容器、Seatbelt/seccomp、独立用户和网络策略，不能仅依赖此 JSON 配置。
