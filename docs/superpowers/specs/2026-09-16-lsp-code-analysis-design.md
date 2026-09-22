# GitNest LSP 代码分析与请求链设计

## 1. 目标

GitNest 为当前选中的 Workspace 条目提供只读代码分析能力，支持：

- 查看 Git 变动代码及其直接相关的调用关系、请求链和关系图。
- 查看当前 Workspace 条目中的全部受支持代码及其调用关系、请求链和关系图。
- 从 React/Vue 前端中的 `fetch`、Axios 等请求位置，追溯到 Java Spring 后端路由，再继续展开到 Controller、Service、Repository 等服务端调用。
- 通过外部 Language Server Protocol（LSP）进程增强文档符号和调用层级信息。
- 在未安装 LSP Server 时使用内置静态分析器降级，仍然能够生成请求链和基础调用图。

首版语言范围：

- JavaScript、TypeScript、JSX、TSX、Vue SFC。
- Java，重点支持 Spring MVC、Spring Boot 和 Spring WebFlux 常见路由注解。

## 2. 范围定义

### 2.1 当前分析对象

“当前打开的 Workspace 项目”具体定义为当前 `WorkspaceDetailsDto.selectedEntryId` 对应的 Workspace 条目：

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
- JSON-RPC 消息大小、缓冲区、符号递归深度、名称长度等防御性协议上限属于内部安全边界，不作为可关闭或无限制的用户设置。

## 9. 数据安全

- 对 Workspace 目录只执行 `stat`、`readdir` 和 `readFile`。
- 不创建 `.gitnest`、`.metadata`、索引、日志或临时文件。
- 缓存位于 `app.getPath("userData")/cache/code-analysis`。
- Java JDT LS 数据位于 `app.getPath("userData")/runtime/lsp/jdtls`。
- 日志只记录规范化后的相对路径、计数、阶段和错误类型，不记录源码内容。
- LSP 进程使用参数数组启动，禁止 Shell 拼接。
- 安装器只允许固定语言、固定包名和固定参数；Renderer 不能提交任意安装命令。TypeScript 使用 `typescript-language-server@6` 与 `typescript@6`，Java 使用 `redhat.java`。

## 10. 错误与降级

- 单个文件读取或解析失败：跳过该文件，结果带 Warning。
- 达到文件数上限：返回部分结果并明确显示截断。
- LSP 未安装、启动失败或超时：启用静态降级时由内置分析继续并展示具体语言状态；关闭静态降级时，相关语言的 LSP 不可用会使分析失败。
- 缓存损坏：删除对应缓存条目并重建，不影响 Workspace。
- Workspace 条目在分析期间切换：取消旧任务，不把旧结果应用到新条目。
- 所有分析器都不可用：页面展示阻断错误和设置入口。

## 11. 验收标准

- 当前 Workspace 条目内存在 TS/JS 前端请求与 Spring 后端路由时，页面可以展示前端请求、后端 Endpoint 和后续 Java 方法调用。
- 当前 Workspace 条目内存在共享 `Protocol.Cmd` 的 CLI 声明与 SVR 处理方法时，页面可以通过 `fai-cli-rpc` 展示跨仓库 RPC 链；更换两端 wrapper 名称不会改变匹配结果。
- 变动范围不会读取无关的全部源码；已有全量缓存时可以补充一跳相关关系。
- 全部范围能够显示进度、取消和截断状态。
- 启用静态降级时，未安装外部 LSP 仍可得到内置请求链；安装并配置后显示 LSP 增强状态。
- 分析过程中 Workspace 源码、Git 索引和仓库状态不发生变化。
- 大型目录受到文件数、文件大小和并发上限约束，Renderer 保持可操作。
- 切换 Workspace 条目后不会展示上一条目的异步结果。
