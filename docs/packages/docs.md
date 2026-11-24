---
slug: docs
name: "@fidoo/docs"
path: apps/docs
group: 客户端与应用
order: 11
summary: 独立静态工程手册，直接解析仓库 Markdown 文档。
description: Docs 不连接 Agent API，也不读取用户工作区。docs/ 下的 Markdown 是唯一内容源，React 只负责导航、搜索与排版，Vite 输出可部署到任意静态托管的站点。
keywords: 文档, Markdown, Frontmatter, Vite, React, 搜索
dependencies: react, react-dom, marked, vite
---

## 包职责与内容边界

Docs 是 `@fidoo/docs` 独立 Web 包。它不复制 Agent 实现正文到 TSX，也不需要模型密钥或 Agent 服务。

- `docs/project.md` 描述项目架构、任务生命周期、权限、验证和开发方式。
- `docs/packages/*.md` 描述每个包的职责、实现、代码示例、扩展点和源码地图。
- 原有规划文档继续保留在 `docs/`，与 Web 内容共享同一个目录。
- 页面组件只处理视觉和交互，不保存长篇技术正文。

## Markdown 与 Frontmatter 规范

每个包文档使用 Frontmatter 声明导航元数据：

```markdown
---
slug: core
name: "@fidoo/core"
path: packages/core
group: 核心与协议
order: 1
summary: Agent 领域模型与执行内核。
description: 用于包详情首页的完整摘要。
keywords: AgentLoop, RunService, 事件溯源
dependencies: zod
---

## 包职责与边界

正文使用标准 Markdown、GFM 表格和 fenced code block。
```

`slug` 必须唯一，`order` 决定导航顺序，`group` 必须是既定分组。正文使用二级标题形成页内目录；解析器为标题生成稳定锚点，搜索可以定位到具体章节。

## 构建时加载与解析

Vite 的 `import.meta.glob` 以 raw 形式读取 `docs/packages/*.md`，项目总览直接导入 `docs/project.md?raw`。这些内容在构建时进入静态产物，不需要运行时文件服务器。

```ts
const modules = import.meta.glob("../../../../docs/packages/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});
```

解析层拆分 Frontmatter 与正文，使用 Marked Lexer 生成 token。React 渲染器把 heading、paragraph、list、table、code、blockquote 和 inline token 转换为语义化元素，不把 Markdown HTML 直接注入页面。

## 搜索与 Hash 导航

搜索索引来自真实 Markdown：包元数据、正文、代码、表格和源码路径都参与匹配。搜索结果链接到 `#/packages/:slug/:section`，打开后滚动到对应二级标题。

Hash 路由使静态托管无需服务端 rewrite，同时支持浏览器前进后退和可分享链接。`Ctrl/Cmd + K` 或 `/` 打开搜索，方向键选择，Enter 打开，Esc 关闭。

## 新增或修改文档

1. 在 `docs/packages/` 新建或编辑对应 `.md` 文件。
2. 校验 Frontmatter 的 slug、group、order 和真实包路径。
3. 用二级标题组织章节，代码块标注语言，源码地图使用表格。
4. 保存后 Vite 自动更新；执行内容测试确认所有包、锚点和搜索可用。

不需要修改 React 页面，也不需要把正文同步到另一份 TypeScript 数据文件。

## 展示、部署与验证

页面支持响应式移动导航、可见焦点、代码复制和 `prefers-reduced-motion`。构建只输出静态 HTML、CSS 与 JavaScript。

```bash
pnpm docs:dev
pnpm docs:build
pnpm --filter @fidoo/docs preview
```

内容测试检查所有当前包都有 Markdown、元数据有效、章节和代码示例存在、路径真实，以及搜索和路由能正确定位。浏览器验收覆盖桌面、390px 移动端、搜索和深链接。

## Frontmatter 解析器实现

`parsePackageDocument(source, sourcePath)` 是包文档唯一入口。`parseFrontmatter` 要求文件以 `---` 开始，找到第二个分隔行后逐行按第一个冒号拆分 key 和 value。正文从 Frontmatter 结束后开始，不进入元数据。

`required` 用于 slug、name、path、group、order、summary 和 description，缺失时抛出带 sourcePath 的错误。keywords 与 dependencies 使用逗号分隔，值可以省略引号；order 必须是整数，group 必须属于三个已知分组。

解析结果是带类型的 PackageDoc，包含 body、sourcePath、headings 和 sections。Vite loader 按 order 排序，`findPackage` 按唯一 slug 查询。

## 标题、章节与锚点

`extractHeadings` 使用 Marked Lexer，只选择 depth=2 的标题。`headingId` 去除 Markdown 标记，把空白和标点统一为连字符，同时通过 Unicode Letter/Number 保留中文；重复标题追加 `-2` 等序号。

`splitSections` 按行首 `## ` 切分正文，每段保留标题、内容和对应锚点。搜索因此可以返回“源码阅读地图”而不是只返回整个包。

`parseRoute` 解析 `#/packages/:slug/:section`，`packageHref` 对 slug 和 section 编码；浏览器 hashchange 后 App 更新路由并滚动到对应标题。

## Markdown Token 渲染明细

`MarkdownView` 使用 `useMemo` 缓存 Lexer 结果。渲染器不使用 `dangerouslySetInnerHTML`，Markdown 中的原始 HTML 被当作代码文本处理。

| Token | React 输出 |
| --- | --- |
| heading | h1/h2/h3/h4；二级标题带稳定 id |
| paragraph/text | p + 行内 token |
| code | CodeSample，包含语言、复制按钮和 pre/code |
| list/list_item | ul/ol、任务 checkbox、嵌套块和有序编号 |
| table | table/thead/tbody，支持列对齐和横向滚动 |
| blockquote | blockquote，内部递归渲染块 token |
| hr | 水平分隔线 |
| strong/em/del/codespan | 对应语义化行内元素 |
| link | a；外部 HTTP 链接使用新窗口与 noreferrer |
| image | 带 alt 和 lazy loading 的 img |
| html | 安全的文本/代码展示，不执行 HTML |

`nextKey` 根据 token 类型、原文和出现次数生成稳定 key，避免使用数组下标导致 CodeSample 的复制状态错位。

## 搜索算法与结果结构

`searchPackages` 把查询按空白拆成多个 term，并要求每个 term 都命中同一包摘要或同一 Markdown 章节。匹配不区分大小写，中文直接按子串匹配。

空查询只返回包入口，便于浏览；非空查询同时返回包入口和章节结果，最多 12 条。`sectionSummary` 去掉标题、Markdown 标记和多余空白，优先选择第一段普通正文作为结果摘要。

搜索弹窗维护 query 与 selected，ArrowUp/Down 移动，Enter 修改 hash，Escape 关闭。结果使用真实链接，支持鼠标和键盘。

## 应用状态与页面职责

`App` 保存 route、searchOpen 和 mobileOpen。全局快捷键不会拦截输入框中的 `/`；路由变化时更新 document.title，包章节使用 requestAnimationFrame 等待 DOM 后滚动。

`OverviewPage` 的架构图和包卡片从解析后的元数据生成，项目正文来自 `docs/project.md`。`PackagePage` 渲染 doc.body、页内目录、依赖和原始 sourcePath。`Sidebar`、`SearchDialog` 与 `CodeSample` 分别负责导航、搜索和复制，不解析 Markdown 正文。

## 内容测试与故障保护

测试直接读取磁盘 Markdown，校验所有包路径和 sourcePath 真实存在，每包至少有四个章节、代码块和源码地图。另覆盖 Frontmatter 错误、未知分组、Unicode 锚点、搜索无结果和路由解析。

这些约束防止“导航里有包，但内容仍为空”或“正文改了 TS，却忘记修改 Markdown”的漂移。新增包时需要同时增加包目录和对应文档，测试中的预期包清单也应有意识地更新。

## 源码阅读地图

| 文件 | 实现内容 |
| --- | --- |
| `src/content/packages.ts` | 从 Markdown 文件生成包文档集合 |
| `src/content/markdown.ts` | Frontmatter、正文、标题和元数据解析 |
| `src/lib/search.ts` | Markdown 全文查询与章节定位 |
| `src/lib/router.ts` | 可分享的 Hash 路由解析 |
| `src/components/markdown.tsx` | Marked token 到 React 元素的安全渲染 |
| `src/pages/` | 项目总览与包详情页面 |
| `src/styles.css` | 工程手册视觉和响应式布局 |
