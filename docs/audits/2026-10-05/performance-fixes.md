# 性能修复与复测：2026-10-05

已处理[性能检查](./performance-audit.md)确认的三个主要热点。改动保留在当前工作树，未提交，也未重新生成安装包。

## 修复结果

| 场景 | 修复前 | 修复后 | 证据类型 |
| --- | ---: | ---: | --- |
| 单仓拓扑读取 | 9 个 Git 进程，539.20 ms | 5 个，210.90 ms | 同一真实仓库，交替各 9 次，中位数 |
| 12 仓库添加目录 | 6,873.08 ms | 3,162.66 ms | 原生 Electron，交替各 3 次，中位数，约减少 54% |
| 12 仓库手动全量刷新 | 10,963.90 ms | 7,292.02 ms | 同上，约减少 33% |
| 5 万节点图中的源码预览 | 246.73 ms，9 次读取复制整图 9 次 | 0.82 ms，整图复制 0 次 | 完全相同快照和源文件，交替各 9 次 |
| 2,000 文件树开关菜单 | 每次 4,002,000 次数据数组比较 | 每次 0 次，连续 3 次一致 | 实际生产组件的 jsdom 比较计数，非界面延迟 |

### 仓库扫描

新增窄用途 `GitTopologyClient` / `RepositoryTopology`。`GitRepositoryProbe`、`WorkspaceService` 和 `WorkspaceCollectionService` 使用此接口，扫描只读取 identity 和 Worktree 列表，不再读取随后被丢弃的变更、分支列表及提交历史。

当前分支从 Worktree porcelain 中的完整本地分支引用取得，避免同名标签歧义；保留 identity、Worktree 路径归一化、取消信号和超时传播。完整 `inspectRepository` 与独立 snapshot 的原有读取逻辑保持不变。

新增回归覆盖主 Worktree、linked Worktree、unborn 分支、命名空间式分支与同名标签、detached HEAD、提前取消。现有工作区集成测试同时断言扫描确实调用窄用途接口，不调用完整 inspection。

相关代码：

- [GitTopologyClient](../../../packages/git-core/src/ports/git-topology-client.ts)
- [GitCliClient](../../../packages/git-cli/src/adapters/git-cli-client.ts)
- [GitRepositoryProbe](../../../packages/application/src/workspace/git-repository-probe.ts)

### 源码预览

`CodeAnalysisService` 抽出私有 `#readCurrentSnapshot()`，复用 generation、workspace、settings、context 和快照加载校验。`readFile` 只读取校验后的内部快照；公开 `getSnapshot` 继续返回防御性副本，navigation 快照契约保持不变。

新增回归覆盖不复制整图、外部修改公开快照不污染内部数据，以及切换工作区后拒绝旧节点。既有文件 realpath 边界、大小限制等测试全部通过。

相关代码：[CodeAnalysisService](../../../packages/application/src/code-analysis/code-analysis-service.ts)。

### 文件树

建树时使用父节点子项索引，分别保存同名目录和文件，保留原有排序与重复叶节点语义。导航组件缓存树和按路径索引，用 `Map.get` 替代逐叶 `files.find`；菜单状态变化不再重建树或重新查找选中文件。

新增回归覆盖大目录无兄弟节点线性扫描、同名文件/目录、重复路径首次匹配、菜单状态复用，以及文件、筛选、视图变化后的正确重建。

相关代码：[changeTree.ts](../../../apps/desktop/src/renderer/src/shared/model/changeTree.ts)、[DiffFileNavigator.tsx](../../../apps/desktop/src/renderer/src/widgets/diff-workspace/DiffFileNavigator.tsx)。

## 测量边界

- 正式性能比较在全量测试与构建完成后串行执行。Windows、Node 22.22.2、Git 2.53.0.windows.3，硬件与上一轮审计相同。
- Git 微基准使用同一个带本地 upstream 的干净仓库，预热后交替执行旧完整 inspection 和新 topology 读取，各 9 次；返回的 identity、branch、worktrees 逐次相等。Trace2 确认每次分别为 9 / 5 个 Git 进程。耗时范围为 470.75–569.32 ms / 181.81–1,588.65 ms，修复后仍有一次长尾样本；不以中位数声称所有请求延迟都有保证。
- Electron 使用相同的最终 renderer/preload，分别加载保留的修复前主进程构建和修复后主进程构建；每次独立用户数据、12 个新建本地仓库、每仓库一个文件及 upstream。依次执行 before/after 共 6 次，全部通过。
- 添加目录计时只到 `addDirectory` 返回，后续通过订阅状态事件等待 snapshots 就绪，**不再在添加后调用 `getState` 触发额外 startup 重扫**。手动刷新计时到对应 operation 成功完成。本组不沿用上一轮受到观测干预的添加/首次选仓数字。
- 原生添加目录范围为 6,824.44–7,062.63 ms / 3,088.19–3,225.09 ms；区间内 Git 进程稳定为 116 / 68，相差 48，等于 12 个仓库各减少 4 次查询。手动刷新区间为 10,474.88–10,999.09 ms / 6,825.89–7,337.95 ms，区间可能包含并发后台查询。
- 源码预览使用同一个合法合成快照，50,000 节点、100,000 边，每节点 512 字符 documentation；读取同一个 39 字节文件。两个服务各只加载一次快照，交替各测 9 次，返回文件内容一致。修复前克隆中位数 245.51 ms，修复后 0 次全图克隆；这是服务级测量，不是完整 Electron 预览延迟。
- 文件树只用确定性的比较次数验证复杂度，不将 jsdom 时间当作 Electron 用户体验。当前简化夹具挂载约 32,000 个 DOM 元素，上一轮较完整夹具约 38,000 个；夹具显示字段不同，不能把两者差额解释为本次降低了 DOM 数量。

## 验证与剩余成本

- 全量测试：**119 个文件、1,670 项全部通过**，较此前增加 13 项长期回归。
- 全项目类型检查、架构边界检查、构建、`git diff --check` 均通过。
- 原有 Electron workflow smoke 通过：启动、选仓/切仓、监听变化、搜索、打开及搜索 Diff、重启恢复。
- 另有 6 次原生性能流程和 1 次临时文件树计数测试通过。
- 此前 27 个脏文件中，24 个不在本轮修改范围内的差异逐一比较后完全一致；另 3 个 Git 相关文件在原有修复上追加本轮修改。

剩余成本：文件树仍全量挂载并遍历可见树，尚未虚拟化；后台重扫与选仓仍共用配置队列；独立 snapshot 的 canonical upstream 补查及后台/详情重复读取仍存在。MCP 局部图索引缓存、大量未跟踪文件计行和历史列表增长未在本轮修改。这些不影响上述已完成优化，但不能据本轮结果宣称所有规模下都无性能问题。

## 证据

- [结果汇总](../../../temp/performance-fix-20261005/summary.json)
- [Git 同夹具对照](../../../temp/performance-fix-20261005/git/comparison.json)
- [源码预览同快照对照](../../../temp/performance-fix-20261005/analysis/comparison.json)
- [文件树计数](../../../temp/performance-fix-20261005/renderer/results.json)
- [全量测试日志](../../../temp/performance-fix-20261005/full-tests.log)
- [原有 Electron 完整流程](../../../temp/performance-fix-20261005/electron-workflow-baseline.json)
- 原生对照原始结果、Trace2 和截图：`temp/performance-fix-20261005/native/{before,after}-s{1,2,3}/`。

临时探针、对照用源码副本及打包产物在验证后清理；长期回归放在原有测试文件中。日志、原始数据与隔离 Git 夹具保留在 ignored temp 目录。
