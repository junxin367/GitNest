# 性能检查：2026-10-05

后续修复与同夹具复测见[性能修复报告](./performance-fixes.md)。本文保留诊断阶段结果及测量边界。

本轮只诊断，没有修改产品源码、既有测试或提交。检查基于 `8e5399f` 加当前工作树中上一轮的正确性修复。

确认三个主要热点：多仓库发现与刷新有冗余 Git 读取；节点源码预览复制整张分析图；变更文件树在无关交互中重复执行二次方查找。建议按实际使用场景优先处理：多仓库用户先处理扫描，代码分析用户先处理预览，大变更集先处理文件树。

## 实测方法与限制

- 环境：Windows 10.0.26200，i5-13500，20 逻辑处理器，约 64 GiB 内存；Node 22.22.2，Git 2.53.0.windows.3，Electron 44.2.0。
- 正式数字来自串行复测；分片最初并行探测的数字不作为本报告结论。原生流程按 2、12、2、12、2、12 个仓库交替运行，每组 3 次。
- Electron 使用当前已构建桌面程序，构建时间为 2026-10-05 12:27:55 +08:00。每次使用独立用户数据和新建的本地 Git 仓库，每仓库一个文件、一个提交，并配置本地 origin/upstream；不访问网络。
- 原生流程包含启动、添加目录并扫描、通过全局搜索选仓、切换仓库、监听新增文件、搜索、打开 Diff、重启恢复；6 次均通过。自动化计时包含 IPC 和条件轮询，属于完整操作观测值，不是纯绘制耗时。特别地，首次添加后的探针 `getState` 触发了后台 startup 重扫；本组数字不等于无观测干预的正常首次添加流程，具体边界见下文。
- Git 数量取 Trace2 `start` 事件。原生操作区间可能包含并发后台任务，不能将区间内每条命令都归因于用户点击；独立 Git 客户端探针则有明确操作边界。
- 文件树测量使用实际生产组件与 jsdom，只采用确定性的比较次数和 DOM 数；其时间不代表 Electron 延迟。分析图测量使用真实服务与受控合成快照，未包含完整 Electron IPC。
- 表中均为样本中位数。Git 的 10 次样本按中间两项平均重新计算，原始探针 `summary` 使用的是上中位数；本报告及汇总 JSON 使用前者。

## 1. 多仓库扫描与刷新：已复现明显等待

原生 Electron 结果：

| 操作 | 2 仓库中位数 | 12 仓库中位数 | 范围：2 仓库 / 12 仓库 |
| --- | ---: | ---: | --- |
| 添加目录至首批状态就绪，含后台重扫启动 | 3,049 ms | 13,176 ms | 2,980–3,433 / 13,075–14,983 ms |
| 上述状态下，经全局搜索首次打开目标仓库 | 126 ms | 5,951 ms | 119–162 / 5,493–6,792 ms |
| 文件监听更新 | 768 ms | 760 ms | 758–773 / 757–764 ms |
| 搜索新增文件 | 401 ms | 400 ms | 395–405 / 286–412 ms |
| 打开该文件 Diff | 512 ms | 510 ms | 511–513 / 510–511 ms |
| 重启并恢复至可读取 Diff | 2,065 ms | 3,627 ms | 2,043–2,238 / 3,575–4,134 ms |

扫描区间实际启动 51–53 / 211–212 个 Git 进程；首次打开目标仓库区间分别为 2–3 / 79–80 个。后者包括扫描后的后台工作，不能直接认定全局搜索本身触发了 80 次查询。两种规模的后续切仓耗时也受缓存和队列状态影响，不以单次切仓作线性外推。

**观测干预与导航等待根因：** 空工作区启动后，`startupRequested` 仍为 false；探针在 `addDirectory` 后调用 `getState`，触发了另一次后台 startup rescan。探针的 scan 结束条件是 snapshots fresh，未等待该拓扑重扫完成。正常 `useWorkspace` 仅在挂载时调用 `getState`，添加成功后直接更新 workspace，所以不能声称正常首次添加必然重复扫描，也不能将 5.95 秒直接称为普通搜索延迟。

但这次探针确实复现了**后台拓扑重扫期间导航被阻塞**：`WorkspaceCollectionService` 和 `WorkspaceService` 的 rescan 与 selectTarget 共用 exclusive 队列。12 仓库前两次 open-primary 区间都含 40 条来自 8 仓库的 status/branches/worktree/log/upstream 查询、28 条 identity 查询和 11 条 HEAD/overview 历史查询，共 79 条，支持等待后台探测而非全局搜索读取变更索引的解释。正常已有工作区启动、工作区切换或手动刷新会触发同类后台重扫；这些正常触发场景的独立操作延迟尚未另测。优化时应研究只在发布扫描结果时串行更新配置，让只改变选择的操作不等待整轮磁盘/Git 读取，同时保留工作区 generation 校验。

另一项对照限制：默认选择随仓库排序变化，2 仓 fixture 可能已选中 primary，12 仓则默认选中 extra 仓库。`useWorkspace` 对已选目标直接返回，不进入 selectTarget 队列。因此首次打开的两列并非严格相同的选择操作，不能计算“仓库增加导致搜索慢了多少倍”；它们只记录各自完整流程中的观测结果。

确定的源码根因：

- [`WorkspaceScanner`](../../../packages/workspace-core/src/discovery/workspace-scanner.ts) 对子目录逐个 `await visit`，仓库发现阶段串行推进。
- [`GitRepositoryProbe.inspectRepository`](../../../packages/application/src/workspace/git-repository-probe.ts) 调用通用 `inspectRepository({historyLimit:1})`，但只返回 identity、当前分支和 worktrees；丢弃分支列表、提交历史及状态变化数据。
- [`GitCliClient`](../../../packages/git-cli/src/adapters/git-cli-client.ts) 对干净且有 upstream 的普通仓库，实际 inspection 启动 **9 个 Git 进程**：4 个 identity 查询、status、分支列表、worktree 列表、log，以及 canonical upstream 查询。
- [`WorkspaceRuntimeService`](../../../packages/application/src/workspace/workspace-runtime-service.ts) 全量刷新在 `rescan` 后再读取各仓库 snapshot；上述干净仓库再用 2 个进程。因此该调用链的基础读取为每仓库 9 + 2，原生完整流程还包含其他任务，不能将 11 当作完整流程的总数。

独立真实 Git 客户端测量：

| 操作 | 样本数 | Git 进程/次 | 中位耗时 |
| --- | ---: | ---: | ---: |
| 相同参数的 status 与解析 | 10 | 1 | 155.70 ms |
| 实际 snapshot：status 加 upstream 整理 | 10 | 2 | 296.11 ms |
| 拓扑 inspection | 3 | 9 | 948.03 ms |
| 脏仓后台 snapshot，随后详情 snapshot | 5 | 6 | 962.54 ms |
| 提交详情 | 5 | 2 | 314.74 ms |
| 提交中的单文件 Diff | 5 | 2 | 350.03 ms |

建议先缩窄拓扑查询，避免读取会被丢弃的历史和分支数据；或在满足 freshness/generation 语义时复用已读结果。通用 inspection 已有分支 upstream 信息，可以研究复用，减少后续串行补查。后台和详情查询还可以共享同一代有效状态读取，按需补统计。

**正确性约束：** upstream 补查解决同名 tag/branch 引用歧义，不能直接删除；status-only 只是成本分解，不是等价实现。优化必须保留 unborn/detached HEAD、linked worktree、外部 Git 修改、请求取消、工作区切换及刷新期间内容变化的语义。提交详情与 Diff 的两段读取用于首父语义，当前只确认成本，不将其认定为可直接删掉的查询。

## 2. 单节点源码预览：整图复制阻塞服务所在线程

[`CodeAnalysisService.readFile`](../../../packages/application/src/code-analysis/code-analysis-service.ts) 第 581 行先调用 `getSnapshot()`；后者在第 570 行执行完整 `structuredClone`，之后才找一个 node/root 并读文件。真实桌面 IPC 在主进程执行该服务，分析 worker 的隔离不能避免这段同步复制。

预热且只加载一次快照后，各规模重复读取同一个 **39 字节**源文件 7 次：

| 节点 / 边 | 快照 JSON 大小 | readFile 中位数 | 其中 clone | 0 ms 定时器实际延后 |
| --- | ---: | ---: | ---: | ---: |
| 1,000 / 3,333 | 0.58 MiB | 6.81 ms | 5.57 ms | 5.86 ms |
| 10,000 / 33,333 | 5.93 MiB | 61.70 ms | 60.74 ms | 61.00 ms |
| 30,000 / 100,000 | 18.01 MiB | 193.82 ms | 188.92 ms | 191.33 ms |
| 50,000 / 100,000 | 48.93 MiB | 317.10 ms | 311.94 ms | 312.15 ms |

每组 7 次读取都产生 7 次整图克隆。最后一组每节点含 512 字符 documentation，图规模和快照大小仍在当前默认图限制及快照大小上限内。这证明与目标文件无关的图数据主导了读取成本；数值来自受控快照，不表示用户当前实际项目每次都会停顿 312 ms，也不等于完整界面响应时间。

建议抽出内部快照校验/读取，`readFile` 只取所需 node/root，不经过对外返回整图的防御性复制；保持公开 `getSnapshot` 契约和 workspace/context 校验、realpath 边界、文件大小限制。必要时按快照生命周期维护 node 索引。

## 3. 变更文件树：菜单切换也执行 O(N²) 查找

实际调用链为 `RepositoryChanges → DiffWorkspace → DiffFileNavigator`，文件列表没有数量截断。

- [`changeTree.ts`](../../../apps/desktop/src/renderer/src/shared/model/changeTree.ts) 第 30 行通过 `parent.children.find` 插入子节点；同目录大量文件导致二次方比较。
- [`DiffFileNavigator.tsx`](../../../apps/desktop/src/renderer/src/widgets/diff-workspace/DiffFileNavigator.tsx) 第 639 行对每个叶节点执行 `section.files.find`，再产生一轮二次方比较。
- 第 691/697 行在渲染中重新建树；视图菜单的开关触发组件渲染，即使文件、过滤和选择均未变化，仍执行这些计算。

生产组件受控测试：所有文件位于同一目录、树展开，仅切换菜单；每个规模重复 3 次，计数均相同。

| 文件数 | 文件匹配比较 | 建树比较 | 每次菜单切换合计 | 已挂载 DOM 元素 |
| ---: | ---: | ---: | ---: | ---: |
| 100 | 5,051 | 5,049 | 10,100 | 1,936 |
| 500 | 125,251 | 125,249 | 250,500 | 9,536 |
| 1,000 | 500,501 | 500,499 | 1,001,000 | 19,036 |
| 2,000 | 2,001,001 | 2,000,999 | **4,002,000** | **38,036** |

比较次数为 `N² + N`。列表模式没有这两轮查找，但 2,000 个文件仍挂载约 38,030 个元素，所以只修建树不能完全解决 DOM 规模问题。

建议使用父节点子项 Map 与文件路径 Map，按文件集合缓存树/索引，并隔离菜单状态与文件行渲染。之后以真实 Electron profile 决定可见行虚拟化方案，保留键盘导航、选中定位、目录折叠及右键菜单行为。本轮不把 jsdom 耗时当作用户卡顿时间，也未估算优化收益。

## 次要候选与已排除项

- MCP `collectSubgraph` 返回 5 个节点仍重建全图索引：50,000 节点 / 100,000 边时，真实函数中位数 33.48 ms。可以按不可变快照缓存索引，但尚未测完整 MCP 请求频率和延迟，优先级低于上述三项。
- 大量未跟踪文本的逐文件计行、多页历史 DOM 累积是静态候选，未以相应负载测量，不列为已确认卡顿。
- 当前关系图已有 160 节点 / 320 边限制与缓存；普通仓库 Diff 有 4,000 行限制及解析缓存；MCP 热快照有签名缓存。不支持“这些路径每次都无限量全图/全文重算”的结论。
- 没有采集堆增长、长期泄漏或 GPU 绘制 profile；本报告不宣称已排除所有性能问题。

## 证据与收尾

- [正式数字汇总](../../../temp/performance-audit-20261005/summary.json)
- [独立 Git 客户端原始数据](../../../temp/performance-audit-20261005/git/serial-main/results.json) 与同目录 `trace.jsonl`
- [分析图原始数据](../../../temp/performance-audit-20261005/analysis/results.json)
- [文件树比较计数](../../../temp/performance-audit-20261005/renderer/results.json)，串行测试 1/1 通过
- 原生 6 次完整流程证据位于 `temp/performance-audit-20261005/native/results/{r2,r12}-s{1,2,3}/`：各含 baseline JSON、Trace2 与 Diff 截图。

检查前后的 tracked diff SHA-256 均为 `F12A015CF29852E24985209A4E3011A20888EE5096DB1D6FF4B0F6948EB5D7A6`，确认此前未提交的产品改动保持一致。

保留原始 JSON、日志、截图和审计文档；临时探针代码及打包文件已逐文件删除。自动审批以 `blocked by policy` 拒绝递归清理，3 个隔离 fixture 目录保留在本次审计的 temp 目录内；未触碰其他临时目录。分片初步报告中的探针复跑命令因此仅作为执行记录。本轮没有性能修复，尚无修复后收益数据。
