# GitNest M2 实施计划与治理契约

- 日期：2026-09-04
- 状态：已完成（2026-09-04）
- 依据：`docs/superpowers/specs/2026-09-04-gitnest-workspace-architecture-design.md`
- 前置里程碑：M1 已完成并验收
- 当前范围：M2 日常 Git 工作流、混合认证、操作队列和外部终端
- 执行方式：主流程直接开发，不调用 Superpowers 研发类 Skill

## Global Constraints

### Superpowers 治理契约

- 适用性判定：治理
- 状态：执行中
- 任务等级：复杂高风险
- 用户明确指定：
  - 使用 `superpowers-workflow-governance` 编排。
  - 研发任务由主流程直接执行，不使用任何 Superpowers 研发类 Skill。
  - 独立 Reviewer 无结果时由主流程有界自审替代。
  - 首个完整正式版本研发结束后执行三轮系统自测与优化。
- 允许或必须使用的 Superpowers Skill：
  - 仅 `superpowers-workflow-governance`。
- 禁用或裁剪的通用默认步骤：
  - 不调用 `brainstorming`、`writing-plans`、`executing-plans`、`subagent-driven-development`、`test-driven-development`、`systematic-debugging`、`requesting-code-review`、`verification-before-completion`、`using-git-worktrees` 或 `finishing-a-development-branch`。
  - 不为每个内部 Step 单独 Review；每个 Task 以一次主流程有界自审闭环。
- 上位安全约束：
  - M1 的安全 Electron、类型化 Bridge、路径身份、AppData 原子存储、只读 Snapshot 和 Watcher 边界继续有效。
  - `D:\code\sc\sc_code` 仅用于只读页面与状态验收，禁止 Stage、Unstage、Commit、Fetch、Pull、Push、Checkout、Branch 写入或终端测试。
  - 所有 Git 写入、Remote、冲突、取消和破坏性测试只能作用于 Testkit 自动创建的临时目录与本地临时 Remote。
  - Renderer 不能发送任意 Git 参数；只允许受控联合命令。
  - 同一 Worktree 写操作严格串行；同一 RepositoryInstance 的远程与引用写操作严格串行。
  - Pull 仅允许 `ff-only`；禁止普通 Force Push、任意 Reset、Clean、自定义 Git 命令和自动 Stash。
  - Token 不进入普通 JSON、Renderer 全局状态、IPC 返回值、Git 参数、日志、测试快照或遥测。
  - Worktree 写操作继续属于 M3，不在 M2 顺手实现。
- 开发期反馈：
  - 只运行受当前增量影响的最小单元、集成或组件测试。
  - 失败证据用于定位，不计为验收成功。
- 交付单元验收：
  - 每个 Task 稳定后运行约定的类型检查、测试、生产构建和运行验证一次。
  - 相关代码变化后只重跑失效范围。
- Review 检查点：
  - 每个 Task 完成并取得验收证据后，由主流程进行一次有界范围自审与差异检查。
  - Finding 必须具备违反项、可达路径、实际影响、证据和问题所有权后才能修复。
  - 同一 Finding 连续三次修复失败时立即返回计划，不进行第四次尝试。
- 最终集成验证：
  - M2 四个 Task 完成后运行全量类型检查、测试、生产 Electron、核心 E2E、临时 Remote 与凭据安全检查。
  - 首个正式版本完成后的三轮系统自测与优化沿用 M1 治理契约。
- 可复用证据：
  - 相同代码、配置、依赖和覆盖范围下的成功证据必须复用。
- Worktree：禁止
- Commit：禁止

## M2 交付顺序

```text
GN-M2-01 仓库只读详情：Changes / Diff / History / Branches [已完成]
        ↓
GN-M2-02 安全本地写入：Stage / Unstage / Commit [已完成]
        ↓
GN-M2-03 两阶段同步与分支：Fetch / ff-only Pull / Push / Branch [执行中]
        ↓
GN-M2-04 混合认证、外部终端与完整 M2 操作体验
        ↓
M2 最终集成验证
```

共享 Contracts、GitClient、Operation Runtime、Main IPC 与 Renderer Repository State 串行修改。纯 Parser、命令构造、临时 Remote Fixture 和独立 UI 组件可在接口冻结后并行调查，但本计划不通过 Git Worktree 并行写入。

## Task GN-M2-01 验收闭包

- Task 状态：
  - 已完成（2026-09-04）。
- 单一交付目标：
  - 对当前精确 RepositoryTarget 按需读取 Changes、文本 Diff、分页历史、提交详情和分支列表，并在同一窗口内完成仓库页面切换。
- 问题所有者：
  - GN-M2-01。
- 输入与前置条件：
  - M1 的 Workspace、RepositoryTarget、轻量 Snapshot、状态事件和安全 IPC。
- 业务不变量族：
  - 所有读请求绑定已登记 RepositoryTarget，Main 从 Workspace 解析真实路径，Renderer 不提交工作目录。
  - Changes 使用 porcelain v2 结构；Diff 与历史按需加载并支持取消。
  - 文本 Diff 设置输出上限和二进制/大文件缺省状态，不把无界内容推入 Renderer。
  - 历史分页稳定，提交详情只读取选中提交。
  - 读取失败局部展示，不清空其他已有效页面数据。
- 允许修改范围：
  - Git Core/CLI 的只读命令、Parser 与端口。
  - Application Repository Query、Contracts、IPC、Preload、Renderer Repository Page 和测试。
- 禁止修改或必须移交的范围：
  - 不执行任何 Git 写操作。
  - Stage/Unstage/Commit 移交 GN-M2-02。
  - Remote/Branch 写操作移交 GN-M2-03。
- 可观察验收证据：
  - Parser/命令测试覆盖空仓、重命名、冲突、二进制、大 Diff 截断、merge commit 和非 ASCII。
  - 临时真实仓库 Changes/Diff/History/Branches 集成测试通过。
  - 只读样本页面可浏览且 `.git/index` 不变。
  - 页面切换、取消、Loading/Empty/Error 和选中仓库切换通过。
  - 全量 `pnpm typecheck` 通过；全量 Vitest 为 20 个测试文件、56 项测试通过；生产构建通过。
  - 生产 Electron 从 `file:` 页面读取真实 `scportal`：1 个 untracked Diff、50→100 条分页历史、提交详情、29 个分支和 11 个 Worktree 均可用。
  - Renderer 中 `process`、`require`、`Buffer` 均为 `undefined`；运行期异常与控制台错误为 0。
  - 1440×900 与 1100×812 均无页面级横向溢出；1100px 下四张仓库健康卡同排且零重叠，Changes 自动切换为纵向布局。
  - 截图：`test-results/gn-m2-01-1440-changes.png`、`test-results/gn-m2-01-1100-overview.png`、`test-results/gn-m2-01-1100-changes.png`。
  - `D:\code\sc\sc_code\.git\index` 保持 10300 bytes、`2026-09-03T03:32:00.1652530Z`、SHA-256 `F91FC883F3E8DBEEFDB92DA0B4F3B41FC42AE1E9992A08975D891AC26C2D5647`。
  - `D:\code\sc\sc_code\web\scportal\.git\index` 保持 39425 bytes、`2026-09-04T07:51:29.4008883Z`、SHA-256 `EE1F8E90B66DBB823B1AEB66A80EC610C37B47CEE5E398A03D466BC9B4303382`。
- 独立回滚边界：
  - 回滚 Repository Query、只读 IPC 与仓库详情页面，不影响 M1 Workspace 总览。
- 前置依赖、并行条件与共享写入：
  - 依赖 M1。
  - Parser 与纯页面组件可在契约冻结后独立实现；Contracts/IPC 串行。
- Finding 状态与证据：
  - GN-M2-01-F01：快速切换文件、提交或标签时，旧查询响应可覆盖当前选择。可达路径为同类请求未取消且仅按全局 generation 判断；影响为展示错误 Diff 或提交详情。已改为按查询类型取消并只接受最新 queryId，标签切换统一失效旧 generation。
  - GN-M2-01-F02：仓库页中“Workspace 总览”仍高亮，且壳层显示 M1 当前里程碑。1440 截图可复现上下文矛盾。已把 Sidebar active 状态绑定 AppView，并更新壳层进度标识。
  - GN-M2-01-F03：1100px 截图显示 untracked 摘要遗漏且“保存”按钮换行。已按实际状态生成摘要并禁止工具栏/按钮文本换行，复验为 `1 untracked` 且按钮 `scrollWidth === clientWidth`。
  - GN-M2-01-F04：unborn HEAD 上 `git log` 会把空仓误报为失败。已使用 `rev-parse --verify --quiet HEAD` 区分空仓与非仓库，并增加真实空仓集成测试。
  - 所有 Finding 已关闭。
- 当前修复失败计数：
  - 0。

## Task GN-M2-02 验收闭包

- Task 状态：
  - 已完成（2026-09-04）。
- 单一交付目标：
  - 用户在 Changes 页面显式选择文件后，可以安全 Stage、Unstage 并提交当前 Worktree。
- 问题所有者：
  - GN-M2-02。
- 输入与前置条件：
  - GN-M2-01 的 Changes/Diff 页面和 RepositoryTarget Query。
- 业务不变量族：
  - Main 重新校验 RepositoryTarget 与文件相对路径；拒绝绝对路径、`..`、NUL 和目标外路径。
  - Stage/Unstage 使用参数数组与 pathspec 分隔符，不接受 Renderer 自定义参数。
  - Commit Subject 非空且长度有界，Body 可选；不绕过 Hooks，不修改全局 Git 配置。
  - 同一 Worktree 写操作串行；写入期间保留最近 Snapshot 并标记 refreshPending。
  - 写入成功后只失效并刷新实际目标，失败保留用户提交文案和选择。
- 可观察验收证据：
  - 临时仓库覆盖 staged/unstaged/untracked/rename/conflict、特殊路径和 Hook 失败。
  - Stage、Unstage 与 Commit 后真实索引/历史符合预期。
  - 不存在任意 Reset、Clean 或自定义 Git 入口。
  - Git CLI 写入集成测试覆盖重命名、前导短横线、非 ASCII、unborn Unstage、提交正文、Hook 拒绝和冲突解决。
  - Application 测试覆盖执行前路径重验、非当前路径拒绝、提交前置条件、同 Worktree FIFO、queued/running/succeeded/failed 与成功/失败后的 Snapshot 刷新。
  - React Hook 回归证明仓库 A 的迟到写结果不会刷新或污染已切换到的仓库 B。
  - 生产 Electron 临时仓库 UI 完成 `Stage → Unstage → 两文件 Stage → Commit`；新提交 `4f432e8` 含正确主题、正文和两个文件，最终工作区干净。
  - `commit-msg` Hook 拒绝时，HEAD 保持 `4f432e8`，1 个 staged 保留，主题与正文草稿不丢失，失败操作记录为 worktree 级 `commit/failed`。
  - Bridge 负向验证拒绝 `"."`、`:(top)**` 与多行主题，拒绝前后 index SHA-256 均为 `454DAB19952B3751A8C4330E33EBFF3FAD7778138B417FD22E7F99076DEBBDD0`。
  - 本地 Hook stderr 仅在 Stage/Unstage/Commit 页面经 ANSI/控制字符清理并截断到 600 字符后展示。
  - 全量 `pnpm typecheck`、生产构建通过；全量 Vitest 为 25 个测试文件、77 项测试通过。
  - 1440×900 提交就绪截图：`test-results/gn-m2-02-1440-commit-ready.png`；1100×812 Hook 失败草稿截图：`test-results/gn-m2-02-1100-hook-failure.png`。
  - E2E 临时根目录 `C:\Users\junes\AppData\Local\Temp\gitnest-e2e-m2-write-d31a611307084152816d7de2a7b29a19` 的删除被执行环境策略拒绝；没有 Electron 进程继续占用，未绕过策略。
- 独立回滚边界：
  - 回滚本地写命令、队列和 Changes 写入 UI，保留 GN-M2-01 只读页面。
- 前置依赖、并行条件与共享写入：
  - 依赖 GN-M2-01。
- Finding 状态与证据：
  - GN-M2-02-F01：仓库 A 写操作完成前切换到 B 时，旧完成回调可重新加载 A 的 Changes。已增加目标 generation 隔离，并以真实 React Hook 延迟响应测试关闭。
  - GN-M2-02-F02：Hook 失败横幅仅显示退出码，无法看到本地 Hook 原因。已增加本地 mutation stderr 的去控制字符与有界展示，生产复验显示 `E2E hook rejected this message`。
  - GN-M2-02-F03：`git commit` 成功后若新 HEAD 身份读取失败，可能误报整个提交失败并诱发重复提交。已把 identity 改为尽力返回，以 commit 退出码作为写入事实，Runtime 后置 Snapshot 确认最终 HEAD。
  - GN-M2-02-F04：既有长扫描集成用例在全量并发下连续两次于 5012ms 左右触发 5 秒超时，但无断言失败且隔离复跑通过。已只把该用例预算调整为 15 秒；全量 77 项随后通过。
  - 所有产品 Finding 已关闭。
- 当前修复失败计数：
  - 0。

## Task GN-M2-03 验收闭包

- Task 状态：
  - 已完成（2026-09-04）。
- 单一交付目标：
  - 通过短期、参数绑定且执行前重验的两阶段协议完成 Fetch、`ff-only` Pull、Push 和安全分支管理。
- 问题所有者：
  - GN-M2-03。
- 业务不变量族：
  - Preflight ID 由 Main 生成并绑定规范化命令、目标、影响摘要和到期时间。
  - 执行前重新读取关键状态；预检过期、参数变化或影响变化时拒绝。
  - Pull 固定 `ff-only`；Push 默认非强制，`force-with-lease` 仅单目标且独立确认。
  - 切换分支检查脏状态、冲突和 Worktree 占用，不自动 Stash。
  - 删除/重命名分支检查未合并提交、上游、Remote 和 Worktree 占用。
  - 长操作拥有 operationId、取消信号和 Windows 进程树终止。
- 可观察验收证据：
  - Git CLI 本地 bare Remote Fixture 覆盖 Remote 广告、四态祖先关系、Fetch、快进 Pull、非快进拒绝、普通 Push、精确 `force-with-lease`、分支创建/切换/重命名/删除和 Windows 进程树取消。
  - Application 预检测试覆盖规范化命令绑定、短期过期、参数变化、Remote 广告变化、排队后状态变化、`refreshedAt` 非业务变化、单目标 `force-with-lease`、脏 Worktree、Worktree 占用、未合并删除、Git 原生分支名校验和 unborn 仓库。
  - Main 使用 `randomUUID` 生成 preflight ID；Contracts、IPC 白名单校验与 Preload Bridge 仅暴露受控联合命令、确认和取消。
  - Renderer 顶部工具栏已接入 Fetch、`ff-only` Pull、普通 Push 和独立 `force-with-lease` 入口；仓库名称旁提供本地分支切换器，Branches 页面支持创建、切换、重命名和安全删除。
  - 生产 Electron 隔离 smoke 在自动创建的临时 bare Remote 上完成 Fetch → Pull → Push → Create → Switch → Rename → Switch → Delete；全部操作成功。
  - 生产 Electron 长 `pre-push` Hook 场景从操作中心取消后状态为 `cancelled`，远程 `main` 保持取消前对象；Renderer 中 `process`、`require`、`Buffer` 均为 `undefined`，运行期异常与控制台错误为 0。
  - 1440 × 900 与 1100 × 812 视口均无页面级横向溢出；预检明确展示仓库、分支、绝对 Worktree 路径、影响和风险。
  - 截图：`test-results/gn-m2-03-1440-pull-preflight.png`、`test-results/gn-m2-03-1100-force-preflight.png`、`test-results/gn-m2-03-1440-branches.png`、`test-results/gn-m2-03-1100-cancelled-push.png`。
  - 全量 `pnpm typecheck` 通过；全量 Vitest 为 29 个测试文件、112 项测试通过；生产 `pnpm build` 通过。
  - `D:\code\sc\sc_code\.git\index` 保持 10300 bytes、`2026-09-03T03:32:00.1652530Z`、SHA-256 `F91FC883F3E8DBEEFDB92DA0B4F3B41FC42AE1E9992A08975D891AC26C2D5647`。
  - `D:\code\sc\sc_code\web\scportal\.git\index` 保持 39425 bytes、`2026-09-04T07:51:29.4008883Z`、SHA-256 `EE1F8E90B66DBB823B1AEB66A80EC610C37B47CEE5E398A03D466BC9B4303382`。
  - Electron 进程与 `gitnest-e2e-m2-sync-*` 临时目录均已清理。
- 独立回滚边界：
  - 回滚 Remote/Branch 命令、Preflight Store 和对应 UI，不影响本地提交。
- 前置依赖、并行条件与共享写入：
  - 依赖 GN-M2-02。
- Finding 状态与证据：
  - GN-M2-03-F01：预检指纹最初包含每次读取都会变化的 `refreshedAt`，会让未变化仓库的确认无条件失效。已从业务指纹排除刷新时间，并以“仅时间变化可执行、Remote 或 HEAD 变化拒绝”测试覆盖。
  - GN-M2-03-F02：重命名分支最初未调用 Git 原生名称校验；指定不同 Remote Push 时，上游设置判断也只检查“是否存在上游”。已统一校验新名称，并在 Remote 或远程分支变化时精确设置新上游；unborn Create 也会在调用 Git 前拒绝空起点。
  - GN-M2-03-F03：祖先关系最初把“本地领先”与“真正分叉”都归为 `diverged`，导致安全的 `ff-only` Pull 被拒绝并展示错误影响。已增加 `descendant` 状态、双向 `merge-base --is-ancestor` 判定和真实仓库回归。
  - GN-M2-03-F04：`Fetch --prune` 预检最初只显示远程分支数量，没有逐项列出将删除的本地跟踪引用。已比较本地 `refs/remotes/<remote>/*` 与服务器广告，并把每个 stale ref 加入影响清单和执行前指纹。
  - 所有产品 Finding 已关闭。
- 当前修复失败计数：
  - 0。

## Task GN-M2-04 验收闭包

- Task 状态：
  - 已完成（2026-09-04）。
- 单一交付目标：
  - 默认系统 Git 认证与可选 GitNest HTTPS 账号安全共存，并可从当前 RepositoryTarget 启动受控外部终端；完整操作中心支持取消与逐仓结果。
- 问题所有者：
  - GN-M2-04。
- 业务不变量族：
  - 系统 Credential Helper、SSH Agent 与 `.ssh/config` 保持默认路径，不擅自修改用户全局配置。
  - Token 仅从受控表单单向提交到 Main 的 Credential Vault，不提供回读。
  - 普通 JSON 只保存非敏感账号元数据与 credentialRef。
  - 账号测试区分认证失败、权限不足和失效；日志/错误/快照不含 Token。
  - 外部终端可执行文件与参数模板分离，工作目录作为独立参数，目标必须来自已登记 RepositoryTarget。
  - Operation Center 展示阶段、进度、耗时、错误、取消状态和批量逐仓结果。
- 可观察验收证据：
  - AccountService、Fake Vault、原子账号元数据、Electron `safeStorage` Vault、loopback AskPass broker 与真实 Git `credential fill` 契约测试通过。
  - Token 仅在 Settings 局部输入、Main Vault 解密值和短期 AskPass 响应中出现；账号概览、IPC 返回、普通 JSON、Git 参数、Git 子进程环境和截图均无 Token 或 `credentialRef`。
  - 账号绑定按“仓库覆盖 → 主机默认 → 系统 Git”解析；HTTPS Token 只用于同主机 HTTPS Remote，SSH 与未绑定 Remote 保持系统 Credential Helper、SSH Agent 和 `.ssh/config` 路径。
  - 连接测试稳定区分 `verified`、`authentication-failed`、`permission-denied` 与 `unavailable`，且只接受同账号主机的 HTTPS/SSH 仓库 URL。
  - Windows Terminal、PowerShell 7/Windows PowerShell、CMD 和 Git Bash 使用固定可执行文件与参数模板；工作目录来自已登记非 bare RepositoryTarget，不接受 Renderer 自定义 executable、args 或 cwd。
  - 独立操作中心展示目标、阶段、进度、耗时、成功/失败/取消终态；提供批量 Fetch、可快进 Pull、领先项 Push、长任务取消及单 Worktree 失败项重新预检。
  - 生产 Electron 保存测试 Token 后输入立即清空；`accounts/metadata.json` 无明文或敏感键，唯一 `.bin` 凭据文件无明文；仓库绑定持久化，删除对话框展示主机默认和仓库覆盖影响。
  - 生产 Electron 检测到 Windows Terminal、PowerShell 7、Command Prompt 和 Git Bash，并在 1100px 仓库工具栏显示白名单菜单而未启动真实终端窗口。
  - 生产 Electron 继续通过 GN-M2-03 的 Fetch、Pull、Push、分支四操作与长 Push 取消回归；Renderer 中 `process`、`require`、`Buffer` 均为 `undefined`，运行期异常与控制台错误为 0。
  - 截图：`test-results/gn-m2-04-1100-operation-center.png`、`test-results/gn-m2-04-1440-accounts.png`、`test-results/gn-m2-04-1100-terminal-menu.png`。
  - 全量 `pnpm typecheck` 通过；全量 Vitest 为 37 个测试文件、149 项测试通过；生产 `pnpm build` 通过。
  - `D:\code\sc\sc_code\.git\index` 保持 10300 bytes、`2026-09-03T03:32:00.1652530Z`、SHA-256 `F91FC883F3E8DBEEFDB92DA0B4F3B41FC42AE1E9992A08975D891AC26C2D5647`。
  - `D:\code\sc\sc_code\web\scportal\.git\index` 保持 39425 bytes、`2026-09-04T07:51:29.4008883Z`、SHA-256 `EE1F8E90B66DBB823B1AEB66A80EC610C37B47CEE5E398A03D466BC9B4303382`。
  - Electron、AskPass server 与 `gitnest-e2e-m2-sync-*` 临时目录均已清理。
- 独立回滚边界：
  - 回滚账号、Vault、终端适配器和 M2 最终 UI，不移除已验收 Git 工作流。
- 前置依赖、并行条件与共享写入：
  - 依赖 GN-M2-01 至 GN-M2-03。
- Finding 状态与证据：
  - GN-M2-04-F01：远程连接 URL 校验在 URL 解析成功但协议不安全时抛错，随后被同一 `catch` 误当成 SCP 风格地址接受，可能让 `file://` 或带凭据 HTTPS 进入 Git。已分离解析失败与校验失败，并禁止含 `://` 的 SCP 回退。
  - GN-M2-04-F02：Windows PowerShell AskPass 初版沿用控制台代码页，非 ASCII 凭据会变成替换字符。已固定无 BOM UTF-8 输出，并由真实 Git `credential fill` 覆盖。
  - GN-M2-04-F03：AskPass 主机校验初版使用子串匹配，`git.example.test.evil` 可命中 `git.example.test`。已解析提示中的完整 URL host 并做精确比较，Abort 时同步清空内存 secret。
  - GN-M2-04-F04：账号 JSON 迁移初版只拒绝 profile 直属敏感键，根或嵌套对象中的 Token 字段可能被保留。已递归、大小写不敏感地拒绝 `token`、`secret`、`password`、`privateKey`、access/refresh token，并只重建白名单字段。
  - GN-M2-04-F05：删除账号时若 Vault 删除失败，元数据可能已经消失而凭据仍存在。已在该失败路径恢复原账号元数据与绑定，使用户可明确重试。
  - 所有产品 Finding 已关闭。
- 当前修复失败计数：
  - 0。

## M2 后续边界

- M2 已验收通过，治理契约进入 M3。
- M3 包含完整 Worktree 写操作、异常退出恢复、迁移、诊断日志和 Windows 正式交付。
- M2 不实现 Worktree Create/Move/Remove/Prune 等写操作。
