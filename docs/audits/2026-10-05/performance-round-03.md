# 第三轮性能检查与优化：2026-10-05

本轮检查 20 个独立性能问题，对其中 10 项实施优化，覆盖运行时、Git 查询、渲染、代码分析和 MCP。前两轮已经解决的拓扑窄查询、源码预览免整图复制、建树索引、重扫解锁选仓和文件菜单复用不重复计数。

以下审计数字用于定位热点，部分来自并行调查阶段；纯函数或 jsdom 时间不能作为完整 Electron 响应时间。修复前后的正式对照和验证结果在后文单独记录。代码保留在当前工作树，未提交。

## 20 项重点检查

优先级按触发频率、阻塞主线程程度、规模增长和修复风险综合判断。P1 表示本轮重点，P2 表示大数据或特定操作下的明显成本。

| # | 问题与触发场景 | 本轮证据 | 优先级与处理 |
| --- | --- | --- | --- |
| 1 | 手动刷新每完成一仓就复制并广播整份工作区 | 500 仓库、即时模拟 Git：508 次广播、254 次操作保存；复制占约 2.74 秒 | P1，合并进度发布，首项和末项立即发布 |
| 2 | 监听注册用所有已注册路径逐一判断祖先关系 | 500 仓库：518,104 次路径规范化；输出仅 500 条监听注册 | P1，复用规范化键，按路径祖先集合去重 |
| 3 | 全局搜索每个仓库结果到达都重建、排序全部候选；关闭时仍做索引准备 | 20×200 文件：83,770 次排序比较，一次最终发布为 7,979 次；关闭时 snapshot 仍被读取 | P1，关闭时稳定空状态，开启时合并相邻完成事件 |
| 4 | Sidebar 每行线性找 repository、worktree、snapshot；隐藏时仍保留节点 | 500 目标每次更新共 375,750 次查找比较，隐藏后仍有 8,228 个元素 | P1，使用首项索引；隐藏 DOM 和全量行渲染仍保留 |
| 5 | 长 Diff 切换当前搜索命中也重渲染全部行 | 约 4,000 行搜索后有 28,010 个元素；纯文本匹配约 0.51 ms，切换命中组件提交约 95–399 ms（jsdom） | P1，未改；下一步隔离行级高亮状态，再评估窗口化 |
| 6 | 提交历史每页追加数据与 DOM，无窗口化 | 50 / 500 / 2,000 条分别挂载 539 / 5,039 / 20,039 个元素 | P2，未改；需要保留选择、滚动锚点与键盘可达性 |
| 7 | 代码图节点 Diff 为筛选单文件而读取全仓库详细行数 | 32 MiB 无关未跟踪文本：完整/轻量中位 1,185 / 733 ms；两者均 3 个 Git 进程 | P1，节点匹配查询禁用统计，实际 Diff 内容照常读取 |
| 8 | Overview 的任意内容版本变化重查所有目标最新提交，即使 HEAD 不变 | 12 目标一轮 24 个 Git 进程（12 次 rev-parse、12 次 log），约 2.25 秒 | P1，按 Workspace、目标身份和 HEAD 复用结果，只重查变化目标 |
| 9 | 后台快照、Changes 详情和选中 Diff 重复读同一状态 | 同一夹具的完整序列稳定 7 个 Git 进程，约 2.52 秒 | P1，未改；需要版本约束的快照复用，不能使用无失效约束的 TTL |
| 10 | 媒体 Diff 默认读取、复制并传递完整媒体 | 40 MiB PNG 返回 41,943,040 字节；本地含/不含媒体中位 462 / 335 ms | P2，未改；按需预览需要 IPC 和播放流程调整，峰值内存尚未测量 |
| 11 | 历史深分页使用 `--skip`，每页重复 HEAD 探测 | 20,000 提交仓库各页 2 个 Git 进程；offset 0 / 19,950 单样本 457 / 630 ms | P2，机制确认、增幅仅初步测量；cursor 必须处理 rebase、merge 排序和分页期间更新 |
| 12 | 批量远端命令按 Worktree 重复三阶段预检与 fetch | 静态确认每阶段读取 snapshot、branches、remotes；同仓库 linked Worktree 不合并；未做真实远端计时 | P2，未改；确认前和排队后的新鲜度检查必须保留，Fetch 与 Pull/Push 不能共用简单去重规则 |
| 13 | MCP 为返回 Top 12 排序全部匹配节点 | 50,000 节点真实搜索函数中位 314.11 ms | P1，有界 Top-K，保持完整计数与原有排序 |
| 14 | 局部子图每次重建全图节点及邻接索引 | 50k 节点 / 100k 边，仅返回 5 节点仍花 68.86 ms | P1，按不可变快照复用索引，保留可变输入的正确性 |
| 15 | 图构建按声明重复扫描同文件全部符号 | 4,000 符号的比较下界 6,400 万次，构建中位约 1.08 秒 | P1，增加 qualifiedName / line 声明索引，保留最近行与同名语义 |
| 16 | 完整分析在判断缓存命中前哈希全部支持的源码；未命中时再读正文 | 32×1 MiB 文件每轮仍哈希 32 MiB，中位 74.98 ms；changed 范围仅 1 MiB | P2，未改；不能只依赖 size/mtime，否则会漏掉保留时间戳的修改 |
| 17 | 分析结果在 compaction、engine、进程边界和保存阶段重复序列化 | 23.27 MB 图，单次 stringify 约 94 ms；正常成功链至少四次大小遍历/序列化 | P1，去掉 engine 内紧邻的第二次检查；协议和持久化边界仍独立校验 |
| 18 | MCP 每请求反复读 settings、catalog 和全部 Workspace 文档 | 100 Workspace 一轮 metadata list 约 75 ms；path match 约 78 ms；无快照的多匹配 status 最坏重复读取可达 O(W²) | P2，未改；可先引入单请求元数据上下文，再考虑文件签名缓存 |
| 19 | MCP freshness 每次串行启动 Git 探测全部 roots | 当前真实脏仓单 root、5 次中位 224 ms；普通 `.M` 还会触发 numstat | P1，未改；可做有限并发，不能用未被证明的新鲜度缓存继续宣称 fresh |
| 20 | MCP 响应限长与协议发送重复 JSON 序列化 | 静态确认普通结果至少两次，超限列表还在折半循环中反复测量；未单独计时 | P2，未改；需要保留最终 UTF-8 和 JSON-RPC envelope 字节上限 |

其中 17 项有真实函数、组件或实际 Git/文件读取复现；第 11 项仅有单次深分页样本；第 12、20 项为静态机制确认。没有把所有结构性成本都宣称为已量化的用户延迟。

## 代码与验证边界

### 运行时进度和监听注册（1、2）

[WorkspaceRuntimeService](../../../packages/application/src/workspace/workspace-runtime-service.ts) 将手动刷新进度发布限制为相邻至少 100 ms，首个完成和最终完成不受限制。状态、成功/失败计数仍在每个任务完成时更新；合并的是进度通知与操作记录保存。终态、取消和切换语义由现有测试及新增成功/失败、持续进度回归覆盖。

监听注册沿用原来的规范化、排序与目标选择，使用已规范化的路径键检查祖先，避免与不相关路径做两两比较。保留嵌套仓库、Git 元数据、重复 ID 首项、大小写和路径分隔符语义，另有 UNC、盘符根及相似前缀的回归。

### 搜索、侧栏、节点 Diff 与概览（3、4、7、8）

- [useWorkspaceChangedFiles](../../../apps/desktop/src/renderer/src/features/global-search/useWorkspaceChangedFiles.ts) 在关闭时跳过计划构建和状态发布，开启后以 16 ms 窗口合并完成事件；最终结果立即发布。结果稀疏到达时仍会逐次发布，因此没有消除每次发布时的全部候选排序。
- [WorkspaceSidebar](../../../apps/desktop/src/renderer/src/widgets/workspace-sidebar/WorkspaceSidebar.tsx) 为三类记录建立 Map，保持精确大小写和首次匹配；搜索、过滤、菜单和行渲染共用索引。仍全量挂载，没有卸载隐藏主体或引入虚拟化。
- [useCodeNodeDiff](../../../apps/desktop/src/renderer/src/pages/code-analysis/useCodeNodeDiff.ts) 只为确定 mode/path 的查询传 `includeChangeStats:false`。staged/unstaged、rename originalPath 和 untracked 的后续 Diff 读取保持原语义。
- [WorkspaceOverviewPage](../../../apps/desktop/src/renderer/src/pages/workspace-overview/WorkspaceOverviewPage.tsx) 缓存成功或无提交结果，复用同 key 的进行中请求；失败在后续内容刷新可重试。键包括工作区、仓库和 Worktree 身份/路径及精确 HEAD。目标删除、路径替换、工作区切换和卸载需使旧任务失效，StrictMode effect 重放可复用进行中请求。

### 图搜索、子图、声明构建与大小检查（13、14、15、17）

图查询和构建分别位于 [graph-query.ts](../../../packages/code-analysis/src/graph-query.ts) 与 [graph-builder.ts](../../../packages/code-analysis/src/graph-builder.ts)。排序、匹配总数、direction、节点/边限额、重复 ID、同名/同行的稳定顺序都是前后等价性检查范围。缓存不得按 analysisId 单独复用，也不得让公共函数对可变快照返回旧结果。

[CodeAnalysisEngine](../../../packages/code-analysis/src/code-analysis-engine.ts) 的 compaction 已校验结果不超过经构造器限制的 100 MiB target，删除紧邻的第二次完整序列化。utility runtime 对所有返回结果的校验以及最终持久化文档大小检查继续保留。这是重复检查的局部优化，尚未消除整个跨进程链的多次大对象遍历。

## 同夹具正式对照

以下探针在全量测试和构建结束后串行运行，修改前后的实现使用相同输入并检查输出等价。运行时采用 3 轮交替顺序的中位数；监听注册计时排除计数插桩，使用 5 次中位数。组件调用次数和文件读取字节是确定性计数，不代表完整 Electron 延迟。

| 优化项 | 修改前 | 修改后 | 测量范围 |
| --- | --- | --- | --- |
| 1. 刷新进度发布 | 508 次广播，254 次操作保存；1,778.87 ms | 10 次广播，6 次操作保存；98.75 ms | 500 目标，实际 Runtime 配即时模拟 Git、内存持久化，隔离应用层 CPU |
| 2. 监听祖先去重 | 518,104 次路径规范化；192.08 ms | 1,500 次；1.64 ms | 相同 500 条监听输出 |
| 3. 全局搜索发布 | 20 个完成事件产生 22 次观察组件渲染；关闭时读取 40 个 snapshot | 3 次渲染；关闭时 0 次 snapshot 读取 | 突发完成夹具，最终 20 个结果完整，剩余 timer 为 0 |
| 4. Sidebar 查找 | 100 行，每类记录读取 10,100 次 | 每类读取 100 次 | repositories / worktrees / snapshots 三类，仍显示 100 行 |
| 5. 节点 Diff 选择查询 | 无关未跟踪文件读取 557,056 字节、10 次 read | 0 字节、0 次 read | 只取消匹配阶段的行数统计；选中文件 Diff 正常读取 |
| 6. Overview 最新提交 | 两目标 HEAD 不变仍发 2 次查询；单目标 HEAD 变化也发 2 次 | 分别 0 次、1 次 | 初始加载仍为 2 次；过期队列在切换/卸载后启动数为 0 |
| 7. Top-K 图搜索 | 162.79 ms | 无共享索引 12.31 ms；索引热查询 5.21 ms | 50k 节点，Top 12，完整匹配计数及顺序一致 |
| 8. 局部子图查询 | 36.94 ms | 索引热查询 <0.1 ms | 100k 边，仅输出 5 节点、7 边，图查询函数本身 |
| 9. 声明关联建图 | 521.50 ms | 33.48 ms | 4,000 符号，输出完全一致 |
| 10. Engine 大小检查 | compaction 后返回同一对象共 stringify 2 次 | 1 次 | 确定性回归；跨进程与持久化上限检查保留 |

图索引不是零成本：构造节点索引 9.07 ms；首次索引搜索另耗 60.73 ms；首次局部子图查询另耗 29.52 ms 构造方向邻接。共享索引只绑定经过不可变校验的快照，MCP 懒加载并按对象生命周期复用。没有共享索引的局部子图仍为 35.77 ms。MCP 的 Git freshness 检查仍存在，不能将热查询的微秒结果称为完整 MCP 请求时间。

## 验证结果与限制

- `pnpm test`：119 个测试文件、1,709 项测试通过，比上一轮增加 26 项。长期回归添加在已有测试文件中。
- `pnpm typecheck`、`pnpm check:architecture`、`pnpm build` 均通过。
- 正式性能探针共 9 项通过：运行时 2、Renderer 5、Git 文件读取 1、图查询/建图 1。
- Electron 完整工作流最终通过启动、扫描、切仓、Watcher、全局搜索、Diff、Diff 搜索及重启恢复。首次运行在重启后等待搜索结果超时；相同构建随后诊断复跑和原始 `pnpm smoke:workflow` 连续通过，没有针对该超时修改产品代码或放宽断言。首次失败原因尚未定位，保留失败证据，不将最终通过解释为已消除该间歇性风险。
- 开始时已有 51 个 tracked 文件未提交修改；其中 47 个文件的 diff 保持完全一致，4 个文件在既有修改上追加本轮优化。另有 16 个 tracked 文件新增本轮修改，未提交。

本轮临时测试、源码副本、配置和生成脚本在验证后删除，保留 JSON、日志及开始时 diff 证据。正式产品回归测试保留。未生成安装包。

## 后续优先项

长 Diff 命中切换和历史列表的 DOM 成本仍存在；它们适合下一步处理行级更新与窗口化。后台/详情共享快照、媒体按需载荷、MCP 请求级元数据共享和 freshness 有限并发也有明确证据，但需要分别验证版本失效、播放/取消、配置一致性与新鲜度语义，不应通过粗略缓存掩盖成本。

## 审计原始证据

- [运行时修改前](../../../temp/performance-round3-20261005/runtime/before-results.json)
- [运行时正式交替对照](../../../temp/performance-round3-20261005/runtime/results.json)
- [监听注册对照](../../../temp/performance-round3-20261005/runtime/watcher-results.json)
- [Renderer 审计](../../../temp/performance-round3-20261005/renderer/results.json)
- [Renderer 确定性对照](../../../temp/performance-round3-20261005/renderer/results-after.json)
- [Git 查询与载荷审计](../../../temp/performance-round3-20261005/git/results.json)
- [节点内容读取与概览查询计数](../../../temp/performance-round3-20261005/git/after/deterministic-counts.json)
- [代码分析与 MCP 审计](../../../temp/performance-round3-20261005/analysis/results.json)
- [代码分析与 MCP 逐项调用链](../../../temp/performance-round3-20261005/analysis/findings.md)
- [图查询与建图同夹具对照](../../../temp/performance-round3-20261005/analysis/after-results.json)
- [全量测试日志](../../../temp/performance-round3-20261005/full-tests.log)
- [类型检查](../../../temp/performance-round3-20261005/typecheck.log)、[架构检查](../../../temp/performance-round3-20261005/architecture.log)、[构建](../../../temp/performance-round3-20261005/build.log)
- [Electron 最终工作流](../../../temp/performance-round3-20261005/electron-workflow-baseline.json)
- [Electron 首次超时](../../../temp/performance-round3-20261005/electron-workflow-first-failure.json)、[诊断复跑](../../../temp/performance-round3-20261005/electron-workflow-diagnostic.json)
- [原有修改保留检查](../../../temp/performance-round3-20261005/diff-preservation.json)
