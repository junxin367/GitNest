# GitNest LSP 代码分析与请求链设计


## 1. 目标

GitNest 为当前选中的 Workspace 条目提供只读代码分析能力，支持：

- 查看 Git 变动代码及其直接相关的调用关系、请求链和关系图。
- 查看当前 Workspace 条目中的全部受支持代码及其调用关系、请求链和关系图。
- 从 React/Vue 前端中的 `fetch`、Axios 等请求位置，追溯到 Java Spring 后端路由，再继续展开到 Controller、Service、Repository 等服务端调用。
- 通过外部 Language Server Protocol（LSP）进程增强文档符号和调用层级信息。
- 在未安装 LSP Server 时使用内置静态分析器降级，仍然能够生成请求链和基础调用图。
- 通过只读 MCP 服务，把跨仓库、跨端的链路与影响面事实提供给 Codex，使改动当下就能查到完整调用链，并在每次结果中说明可信度与新鲜度。

首版语言范围：

- JavaScript、TypeScript、JSX、TSX、Vue SFC。
- Java，重点支持 Spring MVC、Spring Boot 和 Spring WebFlux 常见路由注解。

## 2. 范围定义

### 2.1 当前分析对象

“当前打开的 Workspace 项目”具体定义为当前 `WorkspaceDetailsDto.selectedTarget` 指向的那一个 Repository/Worktree（当前 `Workspace` 模型没有 `entries`/`selectedEntryId`）：

- `workspace-meta-repository`：分析该条目拥有的全部 Repository/Worktree，可跨前端与后端仓库建立请求链。
- `workspace-directory`：分析该条目下已被 GitNest 识别的全部 Repository/Worktree。
- `standalone-repository`：只分析该仓库当前 Worktree。

同一路径被多个仓库或条目覆盖时，按规范化绝对路径去重。不会扫描未属于当前条目的其他 Workspace 数据。

### 2.2 变动范围

“变动代码”包括 Git staged、unstaged、untracked 和 conflicted 文件。分析过程：

1. 从当前条目的各 RepositoryTarget 读取 Git 变更文件。
2. 只读取受支持且未超过大小限制的变动文件。
3. 从最近一次完整或增量索引中补充与变动节点直接相连的一跳调用者、被调用者、前端请求、后端路由。
4. 没有可复用索引时，仅展示能够从变动文件本身确定的关系，并明确标记结果可能不完整。

### 2.3 全部范围

“全部代码”由用户显式点击触发，不在 Workspace 打开或应用启动时自动运行。扫描受最大文件数、单文件大小、并发数、忽略目录和取消信号控制。

## 3. 方案选择

采用“外部 LSP + 内置框架分析器”的混合方案。

### 3.1 不采用纯外部 LSP

标准 LSP 可以提供符号和 Call Hierarchy 等语言语义，但不能稳定表达：

- `axios.get("/api/users")` 与 `@GetMapping("/api/users")` 的 HTTP 语义匹配。
- Spring 类级 `@RequestMapping` 与方法级路由组合。
- Vue SFC、请求封装器、Controller 到 Service 的业务链路。

同时，Java LSP 初始化成本较高且依赖本机 Java/JDT LS 环境，不能成为功能可用性的唯一前提。

### 3.2 不采用纯静态分析

纯静态规则无法可靠处理类型解析、重载、跨包引用和框架生成代码，也不符合用户要求的 LSP 能力。

### 3.3 混合方案

- 内置分析器始终负责文件发现、函数/方法索引、前端 HTTP 请求、Spring 路由和基础调用边。
- 外部 LSP 按需启动，补充文档符号和调用层级；启用静态降级时，LSP 失败不阻断内置分析结果。
- 页面明确展示每种语言当前使用“LSP 增强”还是“内置分析”。

## 4. 架构

### 4.1 `@gitnest/code-analysis`

新增独立包，包含：

- `CodeAnalysisEngine`：执行文件发现、增量索引、关系解析、请求链生成和结果裁剪。
- `SourceInventory`：只读遍历受支持文件，遵守忽略规则、文件数和文件大小上限。
- `SourceParser`：解析 JS/TS/Vue/Java 中的声明、调用、前端请求和后端路由。
- `GraphBuilder`：生成稳定节点 ID、调用边、HTTP 匹配边和请求链。
- `CodeGraphQuery`：对内存快照执行请求链查询、节点搜索、子图收集和诊断查询的纯函数集合，不依赖 Electron、React 与文件系统，供 Desktop Renderer 与 MCP 服务共用。
- `AnalysisCache`：在指定缓存目录保存文件指纹和分析快照。
- `ExternalLanguageServerPool`：使用 `spawn(command, args)` 和 stdio JSON-RPC 管理外部 LSP；禁止 `shell: true`。

该包不依赖 Electron、React 或 Workspace UI。

### 4.2 Application 层

新增 `CodeAnalysisService`：

- 从 `WorkspaceRuntimeService` 读取当前 Workspace 和当前条目。
- 将 RepositoryTarget 解析为规范化 Worktree 根目录。
- 在变动范围内读取各目标的 Git 变更列表。
- 从 `AppSettingsService` 提供的公共配置构造分析预算。
- 保证同一时刻只有一个分析任务运行；新任务可取消旧任务。
- 将进度和完成事件广播给 Renderer。
- 设置映射（`CodeAnalysisSettingsDto` → `CodeAnalysisSettings`）与 `resolveAnalysisContext` 从 Electron/Main 依赖中分离，使 MCP 进程与主进程服务对“当前条目根目录”“设置摘要”使用同一份实现。

### 4.3 Main、Preload 与 Contracts

新增类型化 IPC：

- `code-analysis:get-state`
- `code-analysis:start`
- `code-analysis:cancel`
- `code-analysis:get-snapshot`
- `code-analysis:state-changed`

Renderer 不能传入任意文件系统根路径，也不能传入任意命令。分析根目录始终由 Main 从当前 Workspace 解析；LSP 命令只来自已持久化并通过 Main 校验的设置。

### 4.4 Renderer

Activity Rail 增加“代码分析”入口，使用独立全页视图。页面包含：

- 顶部：当前 Workspace 条目、分析范围、重新分析、取消、更新时间和 LSP 状态。
- 摘要：文件数、符号数、调用边数、请求链数、跳过文件数。
- 左栏：请求链和入口列表，可按 HTTP 方法、路径、语言、是否涉及变动过滤。
- 中栏：关系图；默认显示选中请求链或选中节点附近有限深度子图。
- 右栏：节点详情、文件位置、关系来源、置信度和链路步骤。

关系图使用受控 SVG 渲染，不引入大型图形依赖。默认最多渲染 160 个节点、320 条边；超过限制时围绕选中节点裁剪并提示。

## 5. 数据模型

### 5.1 节点

节点类型：

- `file`
- `class`
- `function`
- `method`
- `client-request`
- `server-endpoint`

每个节点至少包含：

- 稳定 ID。
- 名称、语言、节点类型。
- 规范化相对路径和行列位置。
- 所属 RepositoryTarget。
- 是否为 Git 变动代码。
- 框架元数据，例如 HTTP method、route、Spring annotation。
- 分析来源：`builtin`、`lsp` 或 `merged`。
- 置信度：`exact`、`probable`、`heuristic`。

### 5.2 边

实际生成的边类型：

- `contains`
- `calls`
- `http-request`
- `rpc-request`
- `references`

`references` 来自支持 `textDocument/references` 的 Language Server，用于表达类、接口、字段、常量、变量和枚举成员的使用关系。引用查询使用独立请求预算，并限制单个符号保留的引用数量；不把引用边计入 HTTP/RPC 执行链。

`http-request` 只在 HTTP 方法兼容且规范化路由匹配时生成。动态路径按以下方式归一：

- 前端模板表达式、字符串拼接中的动态段转换为 `:param`。
- Spring `{id}` 转换为 `:param`。
- Query String 不参与路由主路径匹配，但保留在详情中。

### 5.3 请求链

请求链由一个前端请求节点、一个后端 Endpoint 节点和后端可达调用子图组成。每一步保留文件位置、关系类型和置信度。无法唯一匹配后端 Endpoint 时展示多个候选，不静默选择。

### 5.4 内置分析 Profile

跨进程关系由具名 Profile 提取和配对，链路记录 `profileId`、传输类型和稳定操作键。HTTP/Spring 链使用 `web-http`；公司 CLI/SVR RPC 链使用 `fai-cli-rpc`。

`fai-cli-rpc` 的关系身份是两端共同引用的完整协议符号，例如 `fai.app.ScResDef.Protocol.Cmd.ADD_RES`。`@Cmd`、`@HdCmd`、代理工厂、目录名以及 `Cli`/`Svr` 类名只作为封装来源或辅助证据，不参与跨端主键匹配。因此新增或替换封装层时，只需让 extractor 找到协议符号，无需复制 Profile 或写死框架包名。

该 Profile 按以下方式建链：

- 无方法体且带协议命令注解的方法作为 CLI RPC 边界。
- 有方法体且带同类协议命令注解的方法作为 SVR RPC 边界。
- Java import 用于把简单类名解析成完整协议符号，避免不同服务中相同数字命令或相同方法名误连。
- 普通调用边和 LSP 精确目标负责保留 CLI facade、adapter、proxy、SVR dispatcher、service 等中间封装。
- 同一个操作存在多个合法 SVR 入口时保留所有候选，并把链标记为 `ambiguous`。
- Profile 版本进入解析缓存与快照配置摘要，规则变化会使旧索引失效。

## 6. LSP 生命周期

- 默认按需启动，只有执行分析或请求符号增强时才启动。
- TypeScript 默认命令：`typescript-language-server --stdio`。
- Java 默认命令：`jdtls`，GitNest 自动追加独立 `-data` 目录到应用数据目录。
- 当状态为“未安装”时，页面提供安装按钮、安装中状态和失败反馈。安装成功后自动重新检测并重新分析。
- TypeScript Language Server 安装到 GitNest 应用数据目录，并把受管可执行文件路径写回设置；不写入 Workspace。
- Java 优先复用 VS Code、VS Code Insiders、Cursor 或 Windsurf 中已有的 Red Hat Java 扩展；确实缺失时，通过受支持编辑器 CLI 安装固定扩展 `redhat.java`。
- 每个当前 Workspace 条目、每种语言最多一个会话。
- 初始化、请求和退出均有超时；失败后记录可执行错误，并根据“静态分析降级”设置继续或阻断。
- 空闲会话在 5 分钟后关闭；切换 Workspace 条目时关闭不再使用的会话。
- 应用退出时发送 `shutdown`/`exit`，超时后终止子进程。

## 7. 设置

设置页新增“LSP 与代码分析”分区：

- 启用代码分析。
- 默认查看范围：变动代码 / 全部代码。
- 静态分析降级。
- TypeScript、Java、Vue、Python、Go、Kotlin、C#、Rust LSP：启用、命令、参数。
- 最大文件数，默认 `5000`，范围 `100～50000`。
- 源码总量上限，默认 `128 MiB`，范围 `16～1024 MiB`。
- 单文件上限，默认 `768 KiB`，范围 `64～4096 KiB`。
- 关系图节点上限，默认 `50000`，范围 `5000～200000`。
- 关系图边上限，默认 `100000`，范围 `10000～400000`。
- 请求链上限，默认 `5000`，范围 `100～50000`。
- 分析诊断上限，默认 `2000`，范围 `100～20000`。
- 读取并发数，默认 `4`，范围 `1～4`。
- 默认关系深度，默认 `8`，范围 `1～12`。
- LSP 请求超时，默认 `8000 ms`，范围 `1000～60000 ms`。
- 忽略目录列表。
- 每种语言单独配置 LSP 文档数、单文档符号数、调用层级请求数、引用请求数、文档请求数和单符号引用数。Java 默认分别为 `80 / 5000 / 40 / 1000 / 40 / 500`，其他语言默认分别为 `120 / 5000 / 50 / 50 / 50 / 500`。
- LSP 文档数范围为 `1～5000`，单文档符号数范围为 `100～20000`，三类语义请求数范围为 `0～10000`，单符号引用数范围为 `1～5000`。
- MCP 服务（`codeAnalysis.mcp`）：`enabled`（默认开启）、`allowSourceSnippets`（默认开启）、`maxResponseKb`（默认 `256`，范围 `64～1024`）。数据目录不作为设置项，由 `app.getPath("userData")` 决定，仅在设置页展示实际路径；`--data-dir` 只用于测试与隔离。
- 自动刷新（`codeAnalysis.autoRefresh`）：`enabled`（默认开启）、`debounceMs`（默认 `1500`，范围 `200～30000`）。
- MCP 服务开关只控制 MCP 进程的工具响应，不影响 GUI 分析能力。
- 设置页左侧提供独立的 MCP 分组，展示服务开关、源码片段权限、响应上限、数据目录、Codex 注册状态与操作；MCP 保存只提交 `codeAnalysis.mcp`，不覆盖未保存的 LSP 与代码分析草稿。
- 设置页展示可复制的 `codex mcp add GitNest_code_lsp ...` 注册命令、等价的 `config.toml` 片段，以及“一键注册 / 卸载”按钮；按钮调用本机固定参数的 `codex mcp add|remove`（不经 shell 拼接），回读结果并展示，不修改其他 MCP 配置。开发版或入口文件缺失时禁止注册并隐藏无效的复制命令。
- MCP 响应上限、源码片段可见性和启用状态变化都不需要重建分析缓存；运行中的 MCP 进程每次工具调用前重读设置，关闭服务或源码片段后立即生效。

修改设置不会自动触发全量分析。影响分析结果的设置变化后，页面提示缓存需要重建。

## 8. 性能与资源控制

- 全量分析只能手动触发。
- 默认忽略 `.git`、`node_modules`、`.pnpm`、`target`、`dist`、`build`、`temp`、`test-results`、`.idea`、覆盖率和缓存目录。
- 文件发现使用异步目录遍历，不跟随目录符号链接。
- 读取并发默认 4，最多 4。
- 每处理一批文件主动让出事件循环，避免阻塞 Electron Main。
- LSP 文档按“显式优先文件、变动文件、生产代码、规范路径”的稳定顺序选择，避免目录遍历顺序决定覆盖范围。
- 文档、调用层级和引用请求在入选文件之间轮转分配，避免前几个文件耗尽整轮请求预算。
- 达到文档、符号或语义请求预算时，具体语言状态明确显示跳过文件数和耗尽的预算。
- 按文件 `mtime + size` 建立指纹，未变化文件复用缓存结果。
- 缓存按 Workspace ID、条目 ID 和设置摘要隔离。
- 变动分析优先复用完整索引；没有完整索引时不隐式触发全量扫描。
- 页面只渲染当前可见子图，不把完整图一次性传给 SVG 布局。
- 所有长操作支持 `AbortSignal`；切换 Workspace 条目或用户取消时停止后续读取和 LSP 请求。
- MCP 查询不重新分析、不启动 LSP 进程，只读取已持久化快照；单次响应体积受 `mcpMaxResponseKb` 约束，子图受 `maxNodes`/`maxEdges` 约束。
- MCP 进程按 `workspaceId + scope + configurationKey` 缓存已解析快照，最多 2 份，依据文件 `mtime + size` 失效；新鲜度检查最多覆盖 200 个根目录，每个 5 秒超时。
- JSON-RPC 消息大小、缓冲区、符号递归深度、名称长度等防御性协议上限属于内部安全边界，不作为可关闭或无限制的用户设置。

## 9. 数据安全

- 对 Workspace 目录只执行 `stat`、`readdir` 和 `readFile`。
- 不创建 `.gitnest`、`.metadata`、索引、日志或临时文件。
- 缓存位于 `app.getPath("userData")/cache/code-analysis`。
- Java JDT LS 数据位于 `app.getPath("userData")/runtime/lsp/jdtls`。
- 日志只记录规范化后的相对路径、计数、阶段和错误类型，不记录源码内容。
- LSP 进程使用参数数组启动，禁止 Shell 拼接。
- 安装器只允许固定语言、固定包名和固定参数；Renderer 不能提交任意安装命令。TypeScript 使用 `typescript-language-server@6` 与 `typescript@6`，Java 使用 `redhat.java`。
- MCP 进程只读 GitNest 数据目录；新鲜度探测执行 `git status --porcelain=v2`，必要时用只读 `git diff --name-only` 排除仅索引时间戳变化，设置 `GIT_OPTIONAL_LOCKS=0`，不写入 GitNest 数据、缓存或 Workspace 文件。
- MCP 工具接受当前项目的绝对 `projectPath`，只用于只读归属匹配；`workspaceId` 必须属于匹配的项目。不得把该路径用于任意源码读取，也不接受 Git 命令或 shell 参数；节点位置在返回值中拆分为根目录绝对路径与被分析仓库内相对路径。
- MCP 入口脚本位于 asar 之外，随安装包一起分发；启动不使用 shell 拼接。
- “一键注册 / 卸载”只调用固定的 `codex mcp add GitNest_code_lsp` 与 `codex mcp remove GitNest_code_lsp` 参数，不经 shell 拼接，不提交任意命令；该按钮是 MCP 唯一能改动应用之外状态的路径，且写入内容可回读、可用同一按钮撤销。

## 10. 错误与降级

- 单个文件读取或解析失败：跳过该文件，结果带 Warning。
- 达到文件数上限：返回部分结果并明确显示截断。
- LSP 未安装、启动失败或超时：启用静态降级时由内置分析继续并展示具体语言状态；关闭静态降级时，相关语言的 LSP 不可用会使分析失败。
- 缓存损坏：删除对应缓存条目并重建，不影响 Workspace。
- Workspace 条目在分析期间切换：取消旧任务，不把旧结果应用到新条目。
- 所有分析器都不可用：页面展示阻断错误和设置入口。
- MCP 读取到损坏或不兼容快照：返回 `snapshot-unavailable` 并说明重建方式，不修改缓存文件。
- MCP 服务在 GitNest 设置中被关闭：所有工具返回 `mcp-disabled`，不返回分析数据。
- MCP 无法定位数据目录或 Git 不可用：分别返回 `data-unavailable` 与 `freshness: unknown`，其余查询继续可用。

## 11. MCP 服务

### 11.1 问题与目标

代码分析已经能算出“这次改动牵动哪些链路”，但这份答案目前只存在于 GitNest 窗口里：人能看到，Codex 看不到。Codex 在多仓库工作区里改代码时，恰好有三个困难落在这份数据上：

1. **跨仓库的边不在任何单个文件里。** `axios.get("/api/users")` 与 `@GetMapping("/api/users")`、CLI 协议符号与 SVR 处理方法之间的对应关系，靠跨二十多个仓库的文本搜索既慢又不可靠，Codex 通常只能猜或漏。
2. **影响面判断缺依据。** 改一个 Service 方法会影响哪些入口、是否越过 HTTP/RPC 边界，没有图时只能给出“可能”级别的说法，用户还得回 GitNest 手工核对。
3. **人和 Agent 看的不是同一张图。** 排查问题时双方讲的是各自推出来的链路，容易对不上。

因此 MCP 的目标不是“让 Codex 也能看图”，而是：**把 GitNest 已经算好、且与界面同源的跨仓库跨端事实，变成 Codex 在改动当下可直接查询的少量工具，并让每次回答都带上“这张图有多可信”。**

成立条件：

1. 用户在 GitNest 中对某个 Workspace 条目执行过代码分析，持久化目录中存在该条目的快照。
2. 用户在 Codex 中提问，Codex 调用 `gitnest` MCP 工具。
3. MCP 服务返回该快照中的请求链、节点、边和子图，并在结果中标注范围、生成时间、完整性和新鲜度。
4. 快照缺失或过期时返回明确状态与下一步指引，不用空结果冒充“没有关系”。

### 11.2 能解决 / 不能解决

能解决：

- 跨仓库跨端定位：给定路由、符号、文件或节点，返回前端请求 → 后端 Endpoint → 后续调用/实现的完整链路。
- 影响面：给定节点或“当前变动”，返回上游入口与下游实现，标出 HTTP/RPC 跨端边，直接回答“只改前端够不够”。
- 大仓导航：在通读源码之前定位“该看哪个仓库的哪个方法”，避免无效搜索。
- 结论可核查：每条边带 `confidence`（exact/probable/heuristic）与来源，每个结果带完整性、诊断与新鲜度。
- 省 token：只取相关子图；完整快照实测量级为数十 MB，不可能整体交给模型。

不能解决（必须在结果里说清楚，而不是假装完整）：

- 未分析的代码不在图里：受范围（变动/全部）、文件数、单文件大小、忽略目录与语言支持限制。
- 只有静态可达关系：反射、动态路由、字符串拼接、代码生成、DI 装配、配置化路由等只能给 heuristic 或缺失。
- 没有运行时信息：没有真实流量、调用次数、耗时、数据流或字段级依赖。
- 不替代读源码：图是地图不是地形，改代码前仍要读真实文件；工具返回值同时给出绝对路径正是为此。
- 跨端匹配可能不唯一：`ambiguous` 会列出候选，不静默挑一个。

### 11.3 设计原则

1. 意图优先：工具按“要回答的问题”设计（追踪请求、评估影响、定位符号），不把节点/边的内部结构原样丢给模型。
2. 同源同实现：GUI 与 MCP 走同一个查询层、同一份快照，避免出现两张图。
3. 有界输出：任何工具都不返回完整图；结果必须可裁剪、可解释、带截断原因。
4. 诚实优先：快照过期、结果被截断、匹配不唯一、分析不完整都必须显式返回，宁可说“不确定”。
5. 只读：MCP 不写 Workspace、不写 GitNest 数据、不改设置、不启动 LSP、不做 Git 写操作。
6. 零摩擦接入：一条命令可注册，不要求安装 Node，不要求 GitNest 正在运行。

### 11.4 进程与接入

MCP 服务是由 MCP 客户端拉起的 stdio 进程，不依赖 GitNest 窗口正在运行，也不监听任何端口。

- 入口脚本：`resources/mcp/gitnest-mcp.mjs`，由 `apps/desktop/mcp.vite.config.ts` 单独构建为单文件；仓库没有 MCP SDK，JSON-RPC 协议层为自实现（`packages/mcp-server/src/protocol.ts`），除 `node:*` 外全部依赖内联，`extraResources` 把它放在 `app.asar` 之外。该入口不能挂在 main 构建里：main 会把共享包代码拆到 `out/main/chunks`，而安装后只随附 `resources/mcp`，入口一旦保留相对 import 就会以 `ERR_MODULE_NOT_FOUND` 启动失败。扩展名必须是 `.mjs`，因为安装后的 `resources/mcp` 没有 `package.json` 声明模块类型，`.js` 会被当作 CommonJS 重新解析并告警。
- `electron-builder.yml` 需要同时满足两条：`extraResources` 提供 `resources/mcp/gitnest-mcp.mjs`；`files` 排除 `out/main/mcp/**`，避免同一产物又被塞进 `app.asar`（发布审计脚本 `scripts/audit-windows-release.mjs` 会校验 `resources/mcp/gitnest-mcp.mjs` 存在、内容无相对 import，且 asar 白名单不含该目录）。
- 启动方式：复用现有 `ELECTRON_RUN_AS_NODE` 机制，用应用自身可执行文件以 Node 模式运行入口脚本，因此不要求用户安装 Node。
- `--data-dir` 省略时使用 `app.getPath("userData")`（当前安装实测为 `%APPDATA%\@gitnest\desktop`，由应用包名决定）；设置页展示实际路径，该参数只用于测试和隔离，进程对它只读。
- 注册方式：一条 `codex mcp add` 命令（本机 Codex CLI 已确认提供该子命令），设置页生成该命令并提供复制：

```powershell
codex mcp add GitNest_code_lsp --env ELECTRON_RUN_AS_NODE=1 -- "<安装目录>\GitNest.exe" "<安装目录>\resources\mcp\gitnest-mcp.mjs" --data-dir "<用户数据目录>"
```

等价的 `~/.codex/config.toml` 写法（`[mcp_servers.GitNest_code_lsp]` 与 `[mcp_servers.GitNest_code_lsp.env]`）在同一处展示；`codex mcp remove GitNest_code_lsp` 可撤销。

```toml
[mcp_servers.GitNest_code_lsp]
command = "<GitNest 安装目录>\\GitNest.exe"
args = [
  "<GitNest 安装目录>\\resources\\mcp\\gitnest-mcp.mjs",
  "--data-dir",
  "<用户数据目录>"
]

[mcp_servers.GitNest_code_lsp.env]
ELECTRON_RUN_AS_NODE = "1"
```

- 设置页提供“一键注册”按钮：调用本机 `codex` 执行固定的 `mcp add` / `mcp remove` 参数（不经 shell 拼接），完成后用 `codex mcp get GitNest_code_lsp` 回读校验并展示结果；失败时展示 stderr 与可复制命令。除该按钮外不修改任何用户配置，也不写入 Workspace。

### 11.5 数据来源与复用边界

MCP 进程只读以下持久化数据：

- `workspaces/catalog.json`：`activeWorkspaceId` 与工作区列表。
- `workspaces/items/<workspaceId>.workspace.json`：`groups` / `selectedTarget` 与 Repository/Worktree 根路径；MCP 按既有文件约定只读 JSON，并在内存中调用 `migrateWorkspaceDocument`，不触发 Store 的回写迁移。
- `settings/app-settings.json`：`codeAnalysis` 设置。
- `gitnest-state/code-analysis/<sha256(workspaceId) 前 24 位>/`：按 scope 命名的 `snapshot-changed.json` / `snapshot-workspace.json` 与指针 `snapshot-latest.json`。快照按 workspace + scope 组织，与“条目”无关。

读取规则：

- 快照通过 `@gitnest/code-analysis` 的只读 `loadSnapshotFromDirectory()` 加载，由它完成 schema 校验、设置键与根目录匹配；MCP 依次尝试当前目录与 legacy 目录，不调用会执行迁移回写的 `AnalysisSnapshotCache.load()`。
- 设置映射抽到 `packages/code-analysis/src/settings-mapping.ts`（`codeAnalysisSettingsFromPersisted`），主进程与 MCP 共用同一实现。该映射包含 MiB/KiB→字节的单位换算，而快照配置键由映射后的字节数算出；两处口径一旦不一致，所有既有快照会被静默判为不匹配。
- MCP 进程不启动 LSP、不写缓存、不改设置、不写 Workspace、不执行任何 Git 写操作。

### 11.6 查询层

新增 `packages/code-analysis/src/graph-query.ts`：对 `CodeAnalysisSnapshot` 的纯函数查询，不依赖 Electron、React 和文件系统。

- `findRequestChains(snapshot, filter)`、`resolveRequestChain(snapshot, reference)`、`toRequestChainSteps(snapshot, chain)`。
- `searchGraphNodes(snapshot, filter)`。
- `collectSubgraph(snapshot, options)`：按方向、深度、边类型和节点类型收集子图，并返回截断原因。
- `listGraphDiagnostics(snapshot, filter)`、`analyzeChangeImpact(snapshot, options)`。

Desktop Renderer 现有的筛选与裁剪逻辑（`codeAnalysisNavigation.ts` 的请求链过滤与节点搜索、`CodeRelationGraph.tsx` 的子图裁剪与 120/160/320 上限）在同一模块中收敛为可复用纯函数，GUI 与 MCP 服务调用同一实现。迁移后 GUI 的可见上限数值保持不变。

### 11.7 工具面

2026-09-23 基于 `getRecognitionList` 真实跨项目链路对照，MCP 工具面先收敛为两个只读工具；随后补齐项目路径发现，当前为三个只读工具。此处的新契约取代本节首版的七工具方案。后续章节中提到的旧工具名是当时的验收记录，不再代表当前对外 API。不注册 resources 和 prompts。

| 工具 | 回答的问题 | 关键输入 | 关键输出 |
| --- | --- | --- | --- |
| `get_analysis_projects` | GitNest 登记了哪些可访问的项目/工作目录？ | 无 | 各根的 `projectPath`、`repositoryName`、`workspaceId`、`workspaceName`、`selected`；仅供发现，不保证已有可用快照 |
| `get_analysis_status` | 当前项目有对应的分析吗？应使用 MCP 吗？ | `projectPath`（当前项目/工作目录绝对路径）、`workspaceId?`（来自列表工具） | `projectMatched`、`hasWorkspaceAnalysis`、`hasChangedAnalysis`、`useMcp`、`decisionReason`，以及各 scope 可用快照的新鲜度、完整性和根目录列表 |
| `get_call_chain` | 这个函数、方法或请求跨项目到哪里？ | `projectPath`（与状态查询相同）、`query`（函数/方法名或完整路由）、`language?`（命中起点的代码语言）、`pathPrefix?`（仓内路径前缀）、`workspaceId?`、`scope?` | 命中符号、相关 HTTP/RPC 链、带来源路径与置信度的有向节点和边、截断原因；不是线性执行步骤 |

- MCP 服务器无法推断调用方的当前工作目录。路径或 Workspace ID 不明确时，AI 可先用 `get_analysis_projects` 获取已登记且存在的根目录；接着传入当前项目的绝对路径调用 `get_analysis_status`。只有 `projectMatched=true` 且 `useMcp=true`，才对相同 `projectPath` 使用 `get_call_chain`。路径按真实目录与仓库根的包含关系匹配，不因 GitNest 当前选中了别的 Workspace 就误用其分析；指定的 `workspaceId` 也必须匹配此项目。状态工具不接受 `scope`，会列出所有可用范围。
- 未登记的项目正常返回 `projectMatched=false`、`useMcp=false`；已登记但无兼容全量快照（含只有 `changed` 快照）正常返回 `hasWorkspaceAnalysis=false`、`useMcp=false`。只有全量快照且 `freshness=fresh` 才推荐用 MCP；`stale` 或 `unknown` 应重新分析或用 `rg` 核对当前源码。状态工具在这些场景不以工具错误代替使用建议。
- `get_call_chain` 默认查 `workspace`，明确指定 `changed` 才查变动图。`language` 只筛选匹配符号/路由端点，不裁剪跨语言调用图的下游节点和边。函数名匹配到某条链的入口/端点时优先该链；中间函数优先返回包含下游 RPC 分支的 HTTP 总图，避免重复返回已包含的 RPC 链。
- 无跨端链时只返回有界的局部调用邻域；未命中不代表源码不存在，应使用 `rg` 核对当前文件。工具不读取源码内容，也不替代任意文本、配置、测试或业务条件检索。旧版源码片段设置字段仅保留配置兼容，不再显示控制项。
- 返回统一信封：`analysisId`、`workspaceId`、`workspaceName`、`scope`、`generatedAt`、`completeness`、`impactCoverage`、`freshness`；非 `fresh` 附 `freshnessNote`。关系图最多返回 3 条链、80 个节点和 120 条边，优先保留 HTTP/RPC 边界，超限时标注原因。工具级错误返回 `code` + `guidance` 与 `isError: true`。

### 11.8 新鲜度

新鲜度是 MCP 能否被信任的前提。历史上代码分析只在用户点击“重新分析”或打开页面恢复缓存时更新，因此“图是旧的”曾是常态；CA-5 已补上变动范围的自动刷新（§11.8.1），但每次查询仍必须重新校验，不能假设分析已经跟上。

判定输入（只读）：

- 各根目录 HEAD、Git 变动状态摘要与快照 `roots[].revision`、`sourceState.worktreeStatuses` 是否一致。
- 分析时已变动的受支持源码，其 `size + mtime` 与 `sourceState.changedSourceFiles` 是否一致；新增变动路径由 Git 状态摘要差异捕获。
- 探测预算：最多 200 个根目录、每根 Git 命令 5 秒超时；单个根目录读取失败只把结果降为 `unknown`，其余根照常探测。每次工具调用重新检查，不按 `analysisId` 永久记忆。旧快照若无 `sourceState`，除可确定的 HEAD 变化外返回 `unknown`，直到重新分析。

判定结果与行为：

| 状态 | 含义 | 结构性查询（请求链、节点、子图） | 变动类查询（`scope=changed`、改动影响面） |
| --- | --- | --- | --- |
| `fresh` | HEAD 与文件指纹都一致 | 正常返回 | 正常返回 |
| `stale` | HEAD 变化或变动文件指纹变化 | 返回结果，附 `generatedAt` 并提示行号可能偏移 | 仍返回数据，但标记为旧快照、明确“不能作为本次改动的依据”，并给出重新分析指引 |
| `unknown` | 至少一个根目录不可读，或探测预算被截断 | 返回结果并标注未能验证 | 同左，并额外提示重新分析后确认 |

- 任何状态下都返回 `generatedAt` 与 `guidance`，不让调用方把旧结果当成当前状态。
- 新鲜度只影响标注与变动类查询的可信级别，不阻断结构性查询。
- 快照自动变新由代码分析本体负责（实施计划 CA-5），MCP 不主动触发分析。

#### 11.8.1 自动刷新（CA-5）

由 `apps/desktop/src/main/code-analysis/auto-refresh.ts` 的 `CodeAnalysisAutoRefreshScheduler` 实现，接在主进程的 Workspace 监听之上：

- 只对当前选中目标的 `changed` 范围自动分析；全量 `workspace` 与手动“重新分析”不受影响。
- 连续保存合并为一次运行；去抖默认 `1500 ms`（设置项 `autoRefresh.debounceMs`，范围 `200～30000`）。
- 同一时刻只允许一个运行；运行期间到达的请求合并为一次后续运行。
- 切换选中目标时取消等待中的刷新；关闭 `autoRefresh.enabled` 后不再触发。
- 若当前展示范围不是 `changed`（例如用户正在看全量图），自动刷新不启动，避免把界面上的图换成另一个范围。
- 刷新失败不覆盖最后一次可用快照，只记录错误。

### 11.9 输出预算与缓存

- 单次工具结果按最终 JSON 的 UTF-8 字节数限制为 `mcpMaxResponseKb`（默认 `256 KiB`）；超限时裁剪数组或省略过长源码片段，置 `truncated: true` 与 `truncationReasons`，仍超限时只返回简短的范围与截断说明。
- 工具描述、错误码与字段名使用英文，`guidance` 等面向用户的说明使用简体中文。
- 已解析快照按 `workspaceId + scope + configurationKey` 在进程内最多缓存 2 份，依据文件 `mtime + size` 失效；配置或根目录变化不会复用旧解析结果。此前 66 MB 快照首次加载约 1.8 s 的数据不包含本轮逐次新鲜度探测开销，需要重新测量。
- 现有全量快照实测量级为数十 MB（当前安装的 `snapshot-workspace.json` 约 67 MB），因此 MCP 进程只在首次查询时加载一次并复用；加载沿用 `loadSnapshotFromDirectory` 的受限读取与 112 MiB 上限，超出上限时返回 `snapshot-unavailable`。此处不能用 `AnalysisSnapshotCache.load`：它会在 legacy 迁移、指针修复、回退目录复制时写盘，破坏只读承诺。读取顺序为 `gitnest-state/code-analysis` → 旧版回退目录 `cache/code-analysis`。
- `indexStatus.resultCompleteness`、`impactCoverage` 和 `diagnostics` 原样透传，使 Codex 能判断关系图可能不完整。

### 11.10 关闭与失败行为

- 设置中的 MCP 服务关闭时，MCP 进程仍可启动，但每个工具返回 `mcp-disabled` 并说明开启方式；不返回空结果。
- 数据目录/设置文件不可读时返回 `data-unavailable`；`workspaceId` 不存在或无法解析出分析根目录时返回 `invalid-workspace`；没有任何可用快照时返回 `snapshot-unavailable`；请求参数非法时返回 `invalid-request`；其他异常返回 `internal-error`。实测 2001 条诊断时 `list_analysis_diagnostics` 正常返回而不报错。
- 启动参数非法时立即以非零退出码退出并把原因写入 stderr；stdout 只承载 JSON-RPC 消息。

### 11.11 典型调用流程

1. `get_analysis_status` 确认当前条目、快照时间与新鲜度；`stale` 且问题涉及“本次改动”时先提示在 GitNest 重新分析。
2. `search_code_nodes` 用路由、类名、方法名或路径定位起点。
3. `get_request_chain` 取完整链路（前端请求 → 后端 Endpoint → 后续调用）；`analyze_change_impact` 直接回答“这次改动会影响哪些入口与跨端边界”。
4. `get_code_subgraph` 展开细节；返回 `truncated` 时按 `truncationReason` 降低深度或收窄 `edgeKinds`。
5. 需要看代码时用 `read_code_node_source`，或按返回的 `repositoryRoot` 与相对路径直接打开文件。
6. 需要说明结果边界时用 `list_analysis_diagnostics`，不得把部分索引当成完整调用关系。

### 11.12 明确不做

- 不做 HTTP/SSE 常驻服务：stdio 已满足本地使用，不必引入端口、鉴权与生命周期管理。
- 不在 MCP 侧触发分析：会与 GUI 争用分析缓存与 Git 索引，也可能拉起一批 LSP 进程；刷新归代码分析本体负责（实施计划 CA-5）。
- 不做任何写操作：不写 Workspace、不写 GitNest 数据、不自动改用户 Codex 配置；“一键注册”必须由用户点击，且可回读、可撤销。
- 不提供运行时/流量数据，也不做数据流与字段级依赖分析。
- 不做图编辑器或图形输出：MCP 只回答结构化查询，看图仍在 GitNest 窗口里。

## 12. 验收标准

- 当前 Workspace 内存在 TS/JS 前端请求与 Spring 后端路由时，页面可以展示前端请求、后端 Endpoint 和后续 Java 方法调用。
- 当前 Workspace 条目内存在共享 `Protocol.Cmd` 的 CLI 声明与 SVR 处理方法时，页面可以通过 `fai-cli-rpc` 展示跨仓库 RPC 链；更换两端 wrapper 名称不会改变匹配结果。
- 变动范围不会读取无关的全部源码；已有全量缓存时可以补充一跳相关关系。
- 全部范围能够显示进度、取消和截断状态。
- 启用静态降级时，未安装外部 LSP 仍可得到内置请求链；安装并配置后显示 LSP 增强状态。
- 分析过程中 Workspace 源码、Git 索引和仓库状态不发生变化。
- 大型目录受到文件数、文件大小和并发上限约束，Renderer 保持可操作。
- 切换 Workspace 条目后不会展示上一条目的异步结果。
- 一条 `codex mcp add GitNest_code_lsp ...` 命令注册后，Codex 无需额外配置即可发现并调用工具；未安装 Node、GitNest 未运行时仍可完成查询。打包验收需确认 `codex mcp get GitNest_code_lsp` 正确回读 command/args/env，并用 Codex 客户端实际调用 `get_analysis_status`。
- `get_analysis_status` 返回各范围快照时间、新鲜度、完整性与根目录列表；`search_code_nodes` → `get_request_chain` 对一个真实前端请求给出与页面一致的有序链路。（已验证：真实数据 65801 节点 / 82118 边 / 426 条请求链，`getPublicDigitalHumanGroups` → `POST /api/digitalHuman/commGroupList` → 后端 `getCommDigitalHumanGroupList`，含 `http-request` 跨端边。）
- 对一处同时涉及前端请求与 Spring 后端的改动，`analyze_change_impact` 能列出受影响入口、跨端边（http/rpc）与下游目标，每步带 `confidence`；同路由或同 Endpoint 命中多条链时返回 `ambiguous` 候选而不猜。
- 快照过期时返回 `stale`：结构性查询仍返回并带 `generatedAt` 与 `freshnessNote`，`analyze_change_impact` 额外返回 `staleWarning` 说明不能作为本次改动的依据；快照不存在时返回 `snapshot-unavailable`。（已验证：21 个根全部一致时返回 `fresh`；在隔离数据目录中让工作区与快照同时记录一个实时仓库不存在的 revision（并重算配置键使快照仍可加载）后，`get_analysis_status`、`search_code_nodes`、`analyze_change_impact` 均返回 `stale` 且带 `freshnessNote`/`staleWarning`。）
- MCP 查询前后逐仓库 `git status --porcelain=v1` 与 GitNest 持久化文件列表不变。（已验证：查询前后 `git status` 与 `gitnest-state` 下文件列表及 mtime 完全一致。）
- MCP 进程在任何查询下都不启动 LSP、不写缓存、不修改设置。（已验证：MCP 只包含 `stat`/`readFile` 与只读 `git rev-parse`；查询后持久化文件指纹不变。）
- 任一工具结果不超过 `mcpMaxResponseKb`；超限时置 `truncated` 与 `truncationReasons`，且任何工具都不返回完整节点/边数组。（已验证：真实查询最大单帧 16.9 KiB，总输出 33.4 KiB，低于 256 KiB 默认上限。）
- GitNest 设置中关闭 MCP 服务后，所有工具返回 `mcp-disabled`，不返回分析数据。（已验证：`codeAnalysis.mcp.enabled = false` 时 `get_analysis_status` 返回 `mcp-disabled` 且 `isError: true`。）
- 开启自动刷新后，修改一个变动范围内文件，去抖窗口过后 `changed` 快照的 `generatedAt` 自动更新；连续保存只触发一次；切换到全量范围时不启动自动刷新。
- 以上打包应用与 Codex 客户端调用属于此前版本的历史证据。2026-09-23 修正后，新单文件入口已验证 stdio 握手、7 个工具和本机快照状态查询；新打包应用中的实际 Codex 调用、运行中权限开关与文件监听端到端仍需单独复核。
