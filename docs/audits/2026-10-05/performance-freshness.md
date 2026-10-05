# 性能优化后的数据新鲜度检查：2026-10-05

复核重点是结果能否及时发布、缓存能否随数据失效、异步旧结果是否会覆盖新状态，以及 freshness 标记是否可信。对第三轮 10 项优化逐项检查，并回看前两轮的重扫、源码预览及文件树复用。

已确认并修复 6 类问题：其中第三轮的进度合并引入 1 个更新延迟回归，其余 5 类在优化前已存在。下面分开记录，避免将所有旧问题都归因于性能优化。

## 已复现的问题与修复

### 1. 手动刷新完成结果被慢仓库拖住：第三轮引入

原先只在仓库读取完成时检查距上次发布是否超过 100 ms。如果仓库 A 完成后立即完成 B，而 C 长时间未返回，B 虽已写入内存，界面仍保留 B 的 pending 状态，直到 C 完成。

现增加窗口末尾的定时发布。首个和最后一个完成仍立即发布；窗口内结果合并后无需等待下一次读取完成。成功计数、失败计数与 snapshot 同步发布。定时器在完成时清理，并校验 Workspace generation、关闭状态，防止工作区切换后补发旧消息。

可控时钟回归先复现成功/失败两种遗漏，再验证窗口边界发布、最终发布及无多余尾通知。另验证待发布期间切换工作区、随后旧 Git 读取返回，不会发出旧状态。

### 2. 启动/后台批次等待全部仓库才展示结果：既有问题

后台刷新原本没有进度回调，只有整批 `Promise.all` 完成后广播。一个慢仓库会让已经读完的其他仓库继续显示 pending。

后台批次现复用相同的合并发布机制，无需创建用户操作记录。测试用一个已完成仓库和一个阻塞仓库验证：前者先发布，后者稍后完成仍正确补齐。

### 3. 文件持续写入使防抖无限顺延：既有问题

监听事件合并原本持续取更晚的 due time。在文件持续变化、事件间隔小于 debounce 时，刷新可能一直等不到安静窗口。

现保持短突发的尾部防抖，同时按首次请求固定最长等待时间：取 debounce 与最小刷新间隔的较大值。默认当前目标为 1 秒、后台目标为 5 秒；已有最小刷新间隔和 in-flight 串行限制继续生效。测试连续发送事件，验证期间仍定期读取、频率不超过限制，停止写入后最后一轮仍执行。

这里的最长等待是调度层时间，不包含正在执行的 Git、全局并发队列、事件循环阻塞和文件系统事件送达时间。

### 4. 同 ID 路径替换后全局搜索保留旧文件：既有问题

此前缓存身份只使用 repository/worktree ID，revision 相同时不会重新读取。目标路径替换后可持续显示 `loaded:true/loading:false` 的旧文件列表。

已补齐 Workspace 根、Repository common dir、Worktree 路径身份，并清理当前计划外的缓存。新增回归验证相同 ID、相同 revision、路径变化仍重新读取。经 `git show HEAD` 核对，该缺陷在第三轮前已存在。

### 5. 源码等长改写、保留 mtime 时 MCP 误报 fresh：既有问题

状态列表、文件大小和 mtime 都不变，并不能证明已分析内容未改变。先以真实 Git 仓库和已修改文件复现：修改方法名为等长文本并恢复 mtime，旧检查仍返回 fresh。

现对分析记录中的 changed source 文件校验内容指纹。缺少内容指纹的旧快照降为 unknown，不能继续宣称 fresh；文件内容变化返回 stale，读取期间变化或无法证明一致时保守返回 unknown。图索引缓存保持按不可变快照复用，不使用该缓存跳过 freshness 校验。

分析阶段复用 inventory 本来已经计算的 SHA-256；请求阶段只读取分析时已 dirty、属于支持类型且 size/mtime 仍相同的源码。每个文件最多读取记录中的字节数，并检查读取前后的大小、mtime、ctime，避免持续追加时无限追读 EOF。代价是每次 freshness 校验增加这些文件的内容读取，不能把图索引热查询耗时当作完整 MCP 请求耗时。

### 6. 代码节点 Diff 打开后同文件编辑不刷新：既有问题

原 Hook 的请求作用域只有 repository/worktree ID 和文件路径。抽屉保持打开、同一文件继续编辑时，路径不变就不会再次读取 Diff。

App 现向分析页传递 Runtime snapshots，页面把内容版本及 Workspace、目标路径身份传入 Hook。版本变化会取消旧请求并重新读取；晚到的旧 Diff 不会覆盖新版。相同文件、相同版本切换不同节点仍复用结果，`includeChangeStats:false` 的轻量匹配优化保留。

先用 revision 改变的最小用例复现读取次数仍为 1，再验证重新读取、旧结果隔离及页面实际接线。

## 逐项复核

| 检查对象 | 结论 |
| --- | --- |
| Runtime 100 ms 进度合并 | 已补尾部定时发布；终态、失败和代次切换有回归 |
| 监听注册与路由索引 | 嵌套目录、linked Git、UNC、盘符、相似前缀、重建代次测试保持通过；没有引入长期状态缓存 |
| 全局搜索 16 ms 合并 | 最终结果立即发布，取消/切换清理 timer；新 revision 读取时保留旧值但标记 loading；路径身份遗漏已修复 |
| Sidebar Maps | 输入数组更新时重建，保留首项匹配；没有异步缓存 |
| 节点 Diff 的轻量查询 | `includeChangeStats:false` 只省略匹配阶段的行数读取；已补 Runtime 内容版本驱动的重新读取 |
| Overview HEAD 缓存 | 按身份与精确 HEAD 失效；工作区/路径/HEAD 变化取消旧任务；同 HEAD 的状态元数据直接取新 snapshot |
| 图 Top-K 查询 | 每次遍历当前节点并保持匹配总数；无索引的可变输入不复用旧结果 |
| 局部子图索引 | 绑定确切的冻结快照及 nodes/edges 数组；同 analysisId 的文件替换仍获得新快照和索引 |
| 声明关联索引 | 生命周期只限一次构建，不跨分析复用 |
| Engine 删除重复大小检查 | 没有引入缓存或延后写入；进程边界和持久化上限仍保留 |
| 前两轮后台重扫 | 代次、根目录与拓扑版本校验防止旧扫描覆盖新配置；选仓与拓扑交错回归保留 |
| 前两轮文件树和菜单复用 | selection、files、stats、busy、权限和动作回调依赖完整，更新后缓存失效 |
| 前两轮源码预览 | 仍校验快照上下文并读取实际文件，免整图复制不等于缓存源码正文 |

## 正常延迟与检查边界

- 搜索局部结果合并窗口为 16 ms，Runtime 同批结果合并窗口为 100 ms；这些是主动合并策略，终态立即发布。事件循环繁忙时定时器可能晚于窗口执行。
- 普通文件监听原有防抖默认当前仓库 400 ms、后台仓库 2 秒；最小刷新间隔分别 1 秒、5 秒。它们仍存在，避免每次文件事件都启动 Git。
- 文件监听不可用时，原有轮询默认当前目标 15 秒、后台目标 60 秒。因此不能承诺所有文件系统和任意负载下“瞬时刷新”。
- MCP fresh/stale 是校验时点的结果。源码在校验完成后仍可能继续变化；多文件读取不是原子事务。
- 上轮 Electron 重启搜索首次超时、随后两次成功，没有足够时间线证明根因。未将上述修复宣称为解决那次超时。

## 最终验证

- 全量测试：119 个测试文件、1,720 项通过，较上一轮增加 11 项。新鲜度回归直接加入已有测试文件。
- `pnpm typecheck`、`pnpm check:architecture`、`pnpm build`、`git diff --check` 均通过。
- 本轮最终构建的原生 Electron workflow 一次通过：启动、扫描、切仓、Watcher 更新、搜索文件、打开/搜索 Diff、重启恢复。样本中的 Watcher 更新约 1.01 秒，重启恢复约 1.13 秒；这是单次功能验证记录，不是性能分位数或延迟保证。
- 开始时 67 个 tracked 文件已有未提交修改；其中 53 个文件的 diff 完全不变，14 个文件追加本轮修复，另有 3 个 tracked 文件新增修改；原有 diff 没有被移除。
- 未提交、未生成安装包；无本轮临时源码或测试探针残留，保留日志与证据。

## 证据

- [Runtime 成功/失败尾发布的失败复现](../../../temp/performance-freshness-20261005/runtime-red.log)
- [启动批次的失败复现](../../../temp/performance-freshness-20261005/startup-red.log)
- [持续写入防抖的失败复现](../../../temp/performance-freshness-20261005/watcher-red.log)
- [工作区切换时丢弃尾通知](../../../temp/performance-freshness-20261005/runtime-switch-timer.log)
- [Renderer 复核记录](../../../temp/performance-freshness-20261005/renderer/findings.md)
- [MCP 指纹失败复现](../../../temp/performance-freshness-20261005/graph/red-dirty-source-fingerprint.log)
- [节点 Diff 版本变化失败复现](../../../temp/performance-freshness-20261005/renderer/code-node-diff-refresh-red.log)
- [节点 Diff 页面接线](../../../temp/performance-freshness-20261005/renderer/code-analysis-page-diff-refresh.log)
- [MCP 缺陷归因](../../../temp/performance-freshness-20261005/graph/attribution.log)
- [全量测试](../../../temp/performance-freshness-20261005/full-tests.log)
- [类型检查](../../../temp/performance-freshness-20261005/typecheck.log)、[架构检查](../../../temp/performance-freshness-20261005/architecture.log)、[构建](../../../temp/performance-freshness-20261005/build.log)
- [Electron 最终工作流](../../../temp/performance-freshness-20261005/electron-workflow-baseline.json)
- [原有修改保留检查](../../../temp/performance-freshness-20261005/diff-preservation.json)
