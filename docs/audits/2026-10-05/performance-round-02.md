# 第二轮性能优化：2026-10-05

在[上一轮修复](./performance-fixes.md)基础上，继续处理后台重扫阻塞选仓、全局搜索读取大文件计行，以及菜单状态引起整份文件列表重新渲染的问题。改动留在工作树，未提交，未生成安装包。

## 实测结果

| 场景 | 本轮修改前 | 本轮修改后 | 测量范围 |
| --- | ---: | ---: | --- |
| 12 仓库重扫期间点击另一个仓库 | 3,025.30 ms | 279.45 ms | 原生 Electron，各 3 次中位数，约减少 91% |
| 128 MiB 未跟踪文本的变更查询 | 771.79 ms | 83.62 ms | 真实 Git 客户端，完整/轻量各 9 次中位数 |
| 上述查询的应用层文件内容读取 | 134,217,728 字节、2,049 次读取 | 0 字节、0 次读取 | 实际 `FileHandle.read` 返回值计数 |
| 2,000 文件树开关菜单 | 每次渲染 2,000 个文件按钮 | 0 个 | 实际组件，各 9 次，夹具完全一致 |
| 上述列表的挂载元素数 | 38,036 | 38,036 | DOM 数量未减少 |

正式性能测试在全量测试与构建结束后串行执行。Windows、Node 22.22.2、Git 2.53.0.windows.3、Electron 44.2.0，硬件为 i5-13500 / 64 GiB。

原生对照保留上一轮结束时的主进程构建，与本轮主进程构建比较；两者使用同一份本轮 renderer/preload。每次新建独立用户数据和 12 个本地仓库，每仓库一个文件及本地 upstream。Trace2 确认显式刷新已启动拓扑命令后，点击真正的侧栏按钮，通过推送状态、仓库页面和 `aria-current` 确认选择；最终刷新成功且选择不回退。添加目录后不调用会触发额外 startup 扫描的 `getState`。观察轮询间隔为 120 ms，计时包含观察成本。

三组 before/after 交替执行，选仓范围分别为 2,937.81–4,268.57 ms / 139.16–328.63 ms。全量刷新完成时间中位数为 4,964.16 / 5,472.86 ms，范围为 4,832.21–6,647.11 / 4,622.19–8,228.79 ms；本轮不宣称全量扫描吞吐量提升，收益是扫描期间可以响应选择。

搜索对照使用同一个真实 unborn 仓库和同一个 128 MiB 未跟踪文本，预热后交替各读取 9 次。完整查询范围为 666.87–1,833.75 ms，轻量为 64.39–178.58 ms。内容读取计数包装并委托真实文件读取，只统计应用层为计行读取的内容，不表示操作系统磁盘 I/O，也不包含 Git 子进程的内部读取。详情请求仍能返回完整统计。

文件列表对照使用上一轮源文件和本轮源文件，同样的 2,000 文件、统计字段和动作配置。开发模式 jsdom Profiler 中位渲染时间为 214.63 / 3.10 ms，仅作辅助观测，不能当作 Electron 菜单延迟；主要证据是文件行渲染次数降为 0。每轮还验证暂存动作正常触发。

## 实现

### 后台重扫与选仓

`WorkspaceService.rescan` 将工作拆为三个阶段：短队列内捕获根目录与扫描代次，在队列外扫描，最后进入短队列验证并落盘。落盘使用最新的选择和折叠状态；根目录、排除项、Workspace 身份或扫描代次变化时丢弃旧结果。取消的扫描不落盘。

`WorkspaceCollectionService` 只在捕获活动 Workspace 和最终提交时持有集合队列。提交同时验证 Workspace ID 与服务实例，防止切换、删除或切出再切回后旧扫描污染当前状态。

运行时发布也补了回归：摘要读取可能挂起，旧扫描回包可覆盖新选仓，反方向的延迟选仓也可覆盖新拓扑。两种顺序均先复现失败，再改为在摘要读取结束后重读最新配置，并验证 generation、Workspace ID、取消信号，随后同步摘要与发布。后台刷新没有进入等待其取消完成的工作区切换队列。

相关代码：

- [WorkspaceService](../../../packages/application/src/workspace/workspace-service.ts)
- [WorkspaceCollectionService](../../../packages/application/src/workspace/workspace-collection-service.ts)
- [WorkspaceRuntimeService](../../../packages/application/src/workspace/workspace-runtime-service.ts)

### 全局搜索跳过详细变更统计

`RepositoryChangesRequest` 新增可选 `includeChangeStats`，IPC 拒绝非布尔值，默认保持 `true`。全局搜索显式传 `false`，避免为文件名搜索逐块读取大未跟踪文件来统计行数。详情与 Diff 继续获取完整统计。

搜索匹配及定位使用路径、Git 状态和重命名路径，不依赖行数。可选的增删行数展示缺失时回退为已暂存、未暂存或未跟踪状态。轻量结果只进入搜索 Hook 自己的 revision 缓存，不与详情结果混用。

相关代码：[RepositoryQueryService](../../../packages/application/src/repository/repository-query-service.ts)、[useWorkspaceChangedFiles](../../../apps/desktop/src/renderer/src/features/global-search/useWorkspaceChangedFiles.ts)。

### 文件列表复用

`DiffFileNavigator` 缓存各分组的行子树与操作区域。只开关视图菜单时复用相同的 React 节点，避免所有文件行及其权限判断重新执行。文件数据、当前选择、筛选、目录折叠、视图、权限函数、忙碌状态或动作回调改变时，相关依赖会使缓存失效。

现有测试覆盖列表和树两种视图，以及缓存失效后使用最新操作回调、更新统计和禁用状态。没有引入虚拟化，完整 DOM 仍存在。

相关代码：[DiffFileNavigator](../../../apps/desktop/src/renderer/src/widgets/diff-workspace/DiffFileNavigator.tsx)。

## 验证

- 全量测试：119 个文件、1,683 项全部通过，较上一轮增加 13 项长期回归。
- 全项目类型检查、架构检查、构建、`git diff --check` 通过。
- 原有 Electron workflow smoke 通过：启动、选仓/切仓、监听、搜索、打开及搜索 Diff、重启恢复。
- 6 次原生对照、文件列表计数对照、大文件查询对照全部通过。
- 新增长期回归均放在原有测试文件内。
- 修改前已有 38 个 tracked 脏文件；其中不属于本轮范围的 33 个文件，其 diff 逐项比较完全一致。另外 5 个文件在上一轮修改上继续追加本轮优化。

## 剩余成本

这轮解除了后台重扫对选仓的长时间队列占用，没有减少全量扫描本身的 Git 工作量。根目录添加等拓扑写操作仍串行执行；相关测试保证并发旧扫描不能覆盖其结果。

文件列表仍全量挂载，选择变化时仍需更新行；大列表初次渲染和滚动尚未虚拟化。全局搜索避免了不需要的详细计行，但详情需要统计时仍会读取文件，普通 tracked 变更为校准状态所需的 Git 查询也仍存在。独立 snapshot 的 upstream 补查、后台与详情的重复读取、MCP 图索引及历史列表增长不在本轮范围内。

## 证据

- [结果汇总](../../../temp/performance-round2-20261005/summary.json)
- [原生对照](../../../temp/performance-round2-20261005/native/comparison.json)
- [大文件查询](../../../temp/performance-round2-20261005/search/results.json)
- [文件列表渲染](../../../temp/performance-round2-20261005/renderer/results.json)
- [全量测试](../../../temp/performance-round2-20261005/full-tests.log)
- [原有 Electron 流程](../../../temp/performance-round2-20261005/electron-workflow-baseline.json)
- [已有改动保留检查](../../../temp/performance-round2-20261005/diff-preservation.json)

原生对照各样本的完整结果、Trace2 与截图保存在 `temp/performance-round2-20261005/native/{before,after}-s{1,2,3}/`。临时探针、测试配置、源文件副本和旧构建副本在验证后清理；保留日志与结果，长期回归留在原有测试文件中。
