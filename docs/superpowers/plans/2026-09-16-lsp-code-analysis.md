# GitNest LSP 代码分析实施计划

## Superpowers 治理契约

- 适用性判定：治理
- 状态：已完成
- 任务等级：复杂高风险
- 当前已生效的上位约束：默认使用简体中文；Workspace 只读；临时文件放入 `temp/` 并清理；宽范围 `rg` 遵守 ignore；不影响用户 Workspace 数据；未经明确要求不得 commit；本轮不使用 subagent。
- 用户明确指定：支持变动代码与全部代码；展示调用关系、请求路径和关系图；设置页增加必要设置；性能优先；当前 Workspace 可用于只读测试；后续取舍由主代理决定并直接实现。
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

## 实施顺序

1. 完成 CA-1：模型、扫描、解析、图构建、LSP 客户端、缓存与只读 smoke。
2. 完成 CA-2：DTO、设置迁移、应用服务、Main 注册、IPC、Preload 和状态事件。
3. 完成 CA-3：状态 Hook、页面、关系图、设置 UI、导航、样式和 Prototype。
4. 执行一次方案与差异交叉检查。
5. 执行最终集成验证和当前 Workspace 只读验证。

## 最终验证证据

- `pnpm typecheck`：通过。
- `pnpm exec vitest run --maxWorkers=1`：84 个测试文件、452 个测试全部通过。默认高并发运行曾使既有 Git fixture 因 83 个 Worker 争用而超时；相关失败文件在单 Worker 下复核通过，因此最终全量验证固定为单 Worker。
- `pnpm build`：Electron Main、Preload、Renderer 生产构建全部通过。
- `git diff --check`：通过。
- Prototype：6 段内联脚本语法检查通过；浏览器检查无控制台错误或警告。
- 当前 Workspace 只读 smoke：选中条目“视频素材识别需求”，21 个仓库目标、691 个变动路径、46 个受支持源码文件、392 个代码节点、977 条关系边，耗时 88 ms；分析前后逐仓库 `git status --porcelain=v1 -z --untracked-files=all` 完全一致。
- 临时 smoke、fake LSP、浏览器截图、服务进程和分析缓存均已清理。
- 未创建 Worktree，未创建 commit。
