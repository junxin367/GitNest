# GitNest LSP 代码分析实施计划

## Superpowers 治理契约

- 适用性判定：治理
- 状态：CA-1～CA-5 已完成；CA-4（MCP 服务）与 CA-5（快照自动刷新）已实现并验证；Manual 验收（Codex 客户端实际调用）与 stale 分支实测仍待补。
- 任务等级：复杂高风险
- 当前已生效的上位约束：默认使用简体中文；Workspace 只读；临时文件放入 `temp/` 并清理；宽范围 `rg` 遵守 ignore；不影响用户 Workspace 数据；未经明确要求不得 commit；本轮不使用 subagent。
- 用户明确指定：支持变动代码与全部代码；展示调用关系、请求路径和关系图；设置页增加必要设置；性能优先；当前 Workspace 可用于只读测试；后续取舍由主代理决定并直接实现。
- 用户明确指定（2026-09-22 追加）：为代码分析增加 MCP 服务，让 Codex 能够查看关系图；本轮只更新设计与本计划，不进入实现。
- 用户明确指定（2026-09-23 追加）：先想清楚 MCP 解决什么问题、只问真正需要决策的事，其余按“能落地能好用”自行定案。
- 允许或必须使用的 Superpowers Skill：`brainstorming`；`writing-plans` 当前不可用，使用本计划替代。
- 禁用或裁剪的通用默认步骤：不创建 Worktree；不 commit；不按内部 Step 重复 Review；本次新增的临时测试文件在验证后删除。
- 开发期反馈：每个交付单元只运行最小相关 typecheck、测试或只读 smoke。
- 交付单元验收：每个 Task 稳定后验证其独立可观察结果。
- 最终集成验证：运行全仓 typecheck、相关测试、build、`git diff --check`，并对当前 Workspace 执行只读分析 smoke。
- Review 检查点：三个 Task 完成后统一执行一次差异与安全边界 Review；发现已确认问题后批量修复并只做一次受影响复查。
- 可复用证据：当前 `HEAD` 为 `77e649b`；此前 build/typecheck 证据仅覆盖旧代码，新增功能后不可复用。
- Worktree：禁止
- Commit：禁止

### Task CA-1 验收闭包

- 单一交付目标：提供可取消、可缓存、只读且资源受限的 JS/TS/Vue/Java 分析引擎，生成节点、边和前后端请求链。
- 问题所有者：`@gitnest/code-analysis`。
- 输入与前置条件：规范化根目录、RepositoryTarget 映射、变动文件集合、分析设置和应用数据缓存目录。
- 业务不变量族：不写 Workspace；文件发现受限；相同文件可增量复用；HTTP 路由匹配稳定；取消后不发布旧结果；LSP 失败可降级。
- 允许修改范围：新增 `packages/code-analysis`；根 workspace/typecheck 配置和 lockfile。
- 禁止修改或必须移交的范围：Workspace 持久化、Git 写操作、现有 Repository 查询语义。
- 可观察验收证据：对受控样本和当前 Workspace 运行只读 smoke，得到分析摘要；分析前后 `git status --porcelain=v1` 一致；包级 typecheck 通过。
- 独立回滚边界：删除新包及根配置引用。
- 前置依赖、并行条件与共享写入：无前置依赖；为后续 Task 提供公共引擎与模型；不得与契约 Task 并行改共享类型。
- Finding 状态与证据：已完成。永久回归测试覆盖完整索引复用、根目录拓扑变化失效和关闭降级时的 LSP 阻断；受控 fake LSP 验证了 Windows `.cmd` Node shim、反向 `workspace/configuration`、文档符号和 Call Hierarchy；当前 Workspace 只读 smoke 覆盖 21 个仓库目标。
- 当前修复失败计数：0

### Task CA-2 验收闭包

- 单一交付目标：通过应用服务、设置、类型化 IPC 和状态事件安全地把分析能力暴露给 Renderer。
- 问题所有者：Application/Main/Contracts 集成。
- 输入与前置条件：CA-1 引擎；当前 Workspace；AppSettings；应用数据目录。
- 业务不变量族：Renderer 不能指定任意根目录；Main 校验全部设置；同一时刻一个活动任务；Workspace 切换时旧结果不污染新上下文；LSP 命令不经 Shell。
- 允许修改范围：`packages/contracts`、`packages/application`、Desktop Main/Preload、AppSettings。
- 禁止修改或必须移交的范围：Git 命令白名单、账号凭据、现有 Workspace 操作状态。
- 可观察验收证据：IPC 契约、Preload 桥和设置 typecheck 通过；错误输入被拒绝；状态事件可订阅；取消可见。
- 独立回滚边界：删除 code-analysis IPC、服务注册和设置字段，不影响现有 Git 功能。
- 前置依赖、并行条件与共享写入：依赖 CA-1；与 CA-3 共享 Contracts，必须先完成。
- Finding 状态与证据：已完成。设置 schema v1→v2 迁移、IPC 输入校验、Preload 能力边界和状态订阅均由现有测试覆盖；连续分析任务串行交接，Workspace 切换会取消并隔离旧结果。
- 当前修复失败计数：0

### Task CA-3 验收闭包

- 单一交付目标：提供可操作的代码分析页面和设置界面，展示两种范围、进度、请求链、关系图、节点详情与降级状态。
- 问题所有者：Desktop Renderer 与 Prototype。
- 输入与前置条件：CA-2 Bridge 和 DTO。
- 业务不变量族：界面不因后台刷新闪烁；图规模受限；范围和当前条目清晰；空态、错误、取消、截断和 LSP 降级均可辨认；设置修改不自动触发全量分析。
- 允许修改范围：App 导航、Activity Rail、设置页、代码分析页面、Icon、全局 CSS、Prototype 对应页面。
- 禁止修改或必须移交的范围：现有 Repository 页面行为、Diff 布局和 Workspace 数据。
- 可观察验收证据：Renderer typecheck/build 通过；页面可从 Activity Rail 打开；设置可保存；关系链选择能更新图与详情；Prototype 静态语法通过。
- 独立回滚边界：移除新页面、导航入口、样式和 Prototype 分支，不影响 CA-1/CA-2。
- 前置依赖、并行条件与共享写入：依赖 CA-2；完成后进入最终集成验证。
- Finding 状态与证据：已完成。生产页面、设置入口和 Prototype 已实现；1440×1000 浏览器检查覆盖范围切换、请求链选择、节点详情和直达 LSP 设置，控制台 0 error / 0 warning。
- 当前修复失败计数：0

### Task CA-4 验收闭包

- 单一交付目标：提供只读 MCP 服务，让 Codex 在改动当下就能查到跨仓库、跨端的链路与影响面，并能判断这张图是否可信。
- 问题边界：解决“跨仓的边不在单个文件里”“影响面缺依据”“人与 Agent 看的不是同一张图”；不解决运行时/流量数据、字段级数据流与未分析代码的覆盖（设计文档第 11.2 节）。
- 问题所有者：新增 `@gitnest/mcp-server` 包（stdio 入口）、`@gitnest/code-analysis` 的 `graph-query` 模块、Desktop Main 设置映射抽取和打包配置。
- 输入与前置条件：CA-1～CA-3 已完成；`workspaces/items`、`settings/app-settings.json` 和 `gitnest-state/code-analysis` 快照；`AnalysisSnapshotCache`；设置映射（已抽到 `packages/code-analysis/src/settings-mapping.ts`）。实现时确认当前 `Workspace` 模型没有 `entries`/`selectedEntryId`，只有 `groups`/`selectedTarget`，快照按 workspace + scope 组织。
- 关键实现事实：MCP 入口为 `resources/mcp/gitnest-mcp.mjs`，由 `apps/desktop/mcp.vite.config.ts` 单独构建为单文件（除 `node:*` 全部内联）；仓库没有 MCP SDK，JSON-RPC 协议层为单文件自实现（`packages/mcp-server/src/protocol.ts`）。入口不能挂在 main 构建：main 会把共享包代码拆到 `out/main/chunks`，而安装后只随附 `resources/mcp`，入口一旦保留相对 import 会以 `ERR_MODULE_NOT_FOUND` 启动失败；扩展名必须为 `.mjs`，因为安装后的 `resources/mcp` 没有 `package.json`，`.js` 会被当作 CommonJS 重解析并输出警告。
- 读路径只读的两处硬约束：快照必须走 `loadSnapshotFromDirectory`（`AnalysisSnapshotCache.load` 的只读部分），因为后者会在 legacy 迁移、指针修复、回退目录复制时写盘；快照读取需依次尝试 `gitnest-state/code-analysis` 与旧版回退目录 `cache/code-analysis`，否则升级后未重新分析的用户会被报成 `snapshot-unavailable`。已解析快照按 `workspaceId + scope` 进程内缓存并以 `mtime + size` 失效（实测首个 66 MB 快照 1.8 s，后续同进程调用 17～27 ms）。
- 业务不变量族：MCP 进程只读，不写 Workspace、不写 GitNest 数据、不改设置、不启动 LSP、不执行 Git 写操作；工具参数只接受已登记的 `workspaceId`/`scope`/节点 ID 与过滤条件；每个结果带 `analysisId`、`scope`、`generatedAt`、`completeness`、`freshness`、`truncated`；单次返回不超过 `mcpMaxResponseKb`，超限必须裁剪并标记；快照缺失、过期或服务关闭时不返回空数据冒充结果；GUI 与 MCP 对“请求链”“子图”使用同一查询实现。
- 允许修改范围：新增 `packages/mcp-server`；`packages/code-analysis/src/graph-query.ts` 及其测试；`packages/contracts` 的 MCP 设置 DTO；Desktop Main 设置迁移、注册命令生成与一键注册；`apps/desktop/electron-builder.yml` 的 `extraResources` 与构建脚本。
- 禁止修改或必须移交的范围：现有分析引擎语义与图构建预算；Git 写操作与 Worktree 管理；Workspace 持久化格式（除设置 schema 迁移）；用户 Codex 配置（不自动写入）。
- 可观察验收证据：`graph-query.test.ts` 13 个用例覆盖搜索排序与过滤、请求链解析与多候选、方向/深度/节点边上限与截断原因、影响面与诊断过滤；`packages/mcp-server/src/tools.test.ts` 29 个契约测试覆盖 7 个工具的完整工具面、协议握手与通知语义、成功路径与 `snapshot-unavailable`/`data-unavailable`/`mcp-disabled`/`invalid-request`/`source-disabled`、路径逃逸拒绝、响应体上限与截断标记、`--version` 与 `--data-dir` 参数解析、legacy 回退目录可见性、快照重写后重新解析、以及设置映射漂移使快照不可见的回归防护；`pnpm --filter @gitnest/desktop build` 产出 `out/main/mcp/gitnest-mcp.mjs`（100.68 kB，无相对 import）；用真实 electron-builder `--dir` 打包后、以打包出的 `GitNest.exe` 端到端跑通 `--version`、`initialize` → `tools/list`（7 个工具）与全部 7 个工具调用（65801 节点 / 82118 边 / 426 条请求链，58 步真实链路，stdout 仅 JSON-RPC，stderr 为空）；查询前后 `git rev-parse HEAD`、`git status --porcelain=v1` 与 `gitnest-state` 下文件大小/修改时间完全一致。
- 已验证（本轮补齐）：`stale` 分支在隔离数据目录中用「工作区与快照同时记录一个实时仓库不存在的 revision，并重算配置键使快照仍可加载」的夹具实测，`get_analysis_status`/`search_code_nodes`/`analyze_change_impact` 均返回 `stale` 且带 `freshnessNote`/`staleWarning`，期间快照文件 0 改动；`codex mcp add` 已针对真实 `win-unpacked` 目录执行并回读正确；Codex 客户端已实际调用 `get_analysis_status` 并返回 `freshness=fresh`、`nodeCount=65801`、`workspaceName=视频素材识别需求`。
- 已知未验证：用 Codex 客户端做「同一请求链与页面逐步比对」尚未做（只验证了客户端能调用并取回正确结果）；`read_code_node_source` 的路径逃逸防护只在单测夹具上验证，未用真实节点做恶意路径尝试。
- 独立回滚边界：删除 `packages/mcp-server`、`graph-query.ts`、MCP 设置字段与 `extraResources` 条目，GUI 分析能力不受影响。
- 前置依赖、并行条件与共享写入：依赖 CA-1 的 `AnalysisSnapshotCache` 与 CA-2 的设置持久化；与 CA-5 可并行，但 `freshness` 为 `fresh` 的常态验收需要 CA-5 落地。
- 已知偏差（未闭合）：本条原写「`graph-query.ts` 与 Renderer 迁移必须同批次完成，避免双实现」，实际本轮只落了查询层，Renderer（`codeAnalysisNavigation.ts` / `CodeRelationGraph.tsx`）仍用原有实现。因此「GUI 与 MCP 同一实现」目前仅在语义层面成立（两边都用 workspace+scope 快照与相同口径的请求链解析），代码层面仍是两套实现，待后续迁移或明确收回该要求。
- 设计依据：`docs/superpowers/specs/2026-09-16-lsp-code-analysis-design.md` 第 11.1（问题与目标）、11.7（工具面）、11.8（新鲜度）、11.12（明确不做）节。
- Finding 状态与证据：已完成（开发者侧证据）。`graph-query` 13 个单测与 MCP 29 个契约测试通过；类型检查、架构边界检查、构建与全量测试（116 文件 / 906 用例）通过；真实打包产物端到端查询、只读性、`stale` 分支与 Codex 客户端实际调用均已验证。剩余待补见上条“已知未验证”。

### Task CA-5 验收闭包

- 单一交付目标：让代码分析快照在 GitNest 运行期间跟随文件变更自动更新，使 GUI 与 MCP 查询到的图默认就是当前状态。
- 问题所有者：Desktop Main 的仓库变更接线与新增 `CodeAnalysisAutoRefreshScheduler`、设置页的自动刷新开关与去抖时长。
- 输入与前置条件：CA-1 的增量索引与文件指纹；现有能识别仓库变更的运行时通知与文件监听器。
- 业务不变量族：只对当前选中目标自动分析；只跑 `changed` 范围，全量仍手动；变更去抖（默认 1500 ms）后触发；同一时刻只有一个分析任务，切换目标会取消待执行刷新；不写 Workspace、不抢 Git 索引锁；失败不覆盖最后一次可用结果。
- 允许修改范围：新增 `apps/desktop/src/main/code-analysis/auto-refresh.ts` 及其测试、Main 的 `workspace.subscribe` 接线、设置页自动刷新开关与去抖时长。
- 禁止修改或必须移交的范围：解析与图构建语义、Git 写操作、Workspace 持久化格式。
- 可观察验收证据：`auto-refresh.test.ts` 11 个用例覆盖快速变更合并为单次运行、开关关闭时不运行、取消待执行刷新、运行期间的请求合并为一次后续运行、去抖时长可从设置更新、非法去抖值被忽略、运行抛错后仍可继续、`dispose` 后不再调度，以及选中目标标识变化与空工作区判定；实现上仅对当前选中目标跑 `changed`，且当前展示范围不是 `changed` 时不启动。
- 已知未验证：真实文件变更后 `generatedAt` 自动更新的端到端观察，以及自动刷新期间逐仓库 `git status --porcelain=v1` 不变的实测；两者都需要在真实 GitNest 运行中操作，尚未执行。
- 独立回滚边界：移除监听接线、设置项与状态展示，恢复为手动分析。
- 前置依赖、并行条件与共享写入：依赖 CA-1/CA-2；与 CA-4 可并行；CA-4 的 `fresh` 常态验收依赖本任务。
- 设计依据：设计文档第 11.8 节“快照自动变新由代码分析本体负责”。
- Finding 状态与证据：已完成（开发者侧证据）。调度器、主进程接线与设置项已落地，11 个单测通过，类型检查与架构边界检查通过，全量测试通过。真实运行时的端到端证据待补（见上）。
- 当前修复失败计数：0

## 实施顺序

1. 完成 CA-1：模型、扫描、解析、图构建、LSP 客户端、缓存与只读 smoke。
2. 完成 CA-2：DTO、设置迁移、应用服务、Main 注册、IPC、Preload 和状态事件。
3. 完成 CA-3：状态 Hook、页面、关系图、设置 UI、导航、样式和 Prototype。
4. 完成 CA-4：`graph-query` 查询层、`@gitnest/mcp-server` stdio 入口、注册命令与一键注册、打包配置。
5. 完成 CA-5：变更去抖后的 `changed` 范围自动刷新（与 CA-4 可并行）。
6. 执行一次方案与差异交叉检查。
7. 执行最终集成验证和当前 Workspace 只读验证。

## 最终验证证据

- `pnpm typecheck`：通过。
- `pnpm exec vitest run --maxWorkers=1`：截至 CA-1～CA-3 为 84 个测试文件、452 个测试；CA-4/CA-5 落地后为 116 个测试文件、906 个测试全部通过。默认高并发运行曾使既有 Git fixture 因 Worker 争用而超时，因此全量验证固定为单 Worker。
- `pnpm build`：Electron Main、Preload、Renderer 生产构建全部通过。
- `git diff --check`：通过。
- Prototype：6 段内联脚本语法检查通过；浏览器检查无控制台错误或警告。
- 当前 Workspace 只读 smoke：选中条目“视频素材识别需求”，21 个仓库目标、691 个变动路径、46 个受支持源码文件、392 个代码节点、977 条关系边，耗时 88 ms；分析前后逐仓库 `git status --porcelain=v1 -z --untracked-files=all` 完全一致。
- 临时 smoke、fake LSP、浏览器截图、服务进程和分析缓存均已清理。
- 未创建 Worktree，未创建 commit。
- CA-4（MCP 服务）：已实现并验证开发者侧证据——`graph-query.test.ts` 13 个用例、`tools.test.ts` 29 个契约用例全部通过；`out/main/mcp/gitnest-mcp.mjs` 为单文件（无相对 import），经 `extraResources` 输出为 `resources/mcp/gitnest-mcp.mjs`，且 `files` 排除 `out/main/mcp/**` 避免同一产物又被塞进 `app.asar`；真实 electron-builder `--dir` 打包后用打包出的 `GitNest.exe` 完成 `initialize` → `tools/list` → 7 个工具调用的端到端查询（65801 节点 / 82118 边 / 426 条请求链，stderr 为空，stdout 仅 JSON-RPC）；查询前后 `git rev-parse HEAD`、`git status --porcelain=v1` 与 `gitnest-state` 下文件大小/修改时间完全一致（MCP 只读成立）；`stale` 分支已用隔离夹具实测，`codex mcp add` 已对真实打包目录回读，Codex 客户端已实际调用成功。已知未验证：与页面的逐步骤链路比对未做；Renderer 未迁移到 `graph-query.ts`（双实现未闭合）。
- CA-5（快照自动刷新）：已实现并验证开发者侧证据——`auto-refresh.test.ts` 11 个用例通过，调度器已接入主进程 `workspace.subscribe` 与设置项，类型检查、架构边界检查与全量测试通过。已知未验证：真实文件变更后 `generatedAt` 自动更新的端到端观察，以及自动刷新期间逐仓库 `git status` 不变的实测。
- 2026-09-23 MCP 修正：运行中逐次重读权限与上限设置、源码真实路径边界、逐次 Git 状态和变动源码 `size + mtime` 新鲜度、分析结束后的补跑、最终 UTF-8 响应大小及最新范围默认选择均已落地；旧快照无状态基线时返回 `unknown`（HEAD 明确变化时返回 `stale`）。`tools.test.ts`、引擎与调度器测试、全量测试（116 文件 / 917 用例）、类型检查、架构检查和桌面构建通过；新单文件入口完成 stdio 握手、列出 7 个工具并读取本机快照状态。此前打包应用与 Codex 客户端调用证据不自动覆盖这次新产物，仍需复核真实打包后的调用；GUI/MCP 查询层双实现与真实文件监听端到端观察仍未闭合。
