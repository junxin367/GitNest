# 持续复查第 2 轮：合并提交的文件列表

## RCA 结论

- 状态：已确认。
- 触发：历史列表选择具有两个父提交的普通合并提交；侧分支引入了文件，当前分支另有独立文件。
- 现象：提交详情返回空文件列表、增删数均为 0；同一提交的单文件 Diff 可以正确返回侧分支的新增内容，导致界面无法从文件列表进入该 Diff。
- 直接原因：`git diff-tree <merge>` 默认不输出合并提交的逐父差异。
- 根因：提交统计命令只提供一个提交；统计未使用单文件 Diff 已采用的第一父提交比较语义。
- 系统性根因（本轮代码与测试范围）：既有真实 Git 测试覆盖合并提交单文件 Diff，但没有同时断言提交详情的文件列表；两条读取路径缺少一致性回归。
- 关键因果链：历史提交详情入口 → `RepositoryQueryService.getCommit` → `GitCliClient.readCommitDetails` → 单参数 `diff-tree` → 空 numstat → 空文件列表。

## 证据

| 判断 | 类型 | 证据 | 来源 |
| --- | --- | --- | --- |
| 合并提交详情漏掉侧分支文件 | 事实 | 回归期望 `side-only.txt`、新增 1，实际 files 为空、新增 0 | `temp/goal-ten-rounds/round-2/red.log` |
| 仅加 `-m --first-parent` 不足以限定 diff-tree 的父比较 | 事实 | 会同时列出 `side-only.txt` 和第一父分支已有的 `main-only.txt` | `temp/goal-ten-rounds/round-2/green.log`（中间失败） |
| 明确传入第一父对象后详情与 Diff 一致 | 结论 | root、普通、合并提交详情和逐文件 Diff 联合断言通过 | `temp/goal-ten-rounds/round-2/green-final.log` |

## 已排除解释

- 不是解析器丢弃正确记录：红测 Git 调用的默认合并输出为空；显式父对象修复后无需修改解析器。
- 不是无内容的合并：临时仓库中侧分支新增文件，且现有单文件 Diff 返回新增内容。
- 不是所有父提交的差异都应累加：既有单文件 Diff 测试明确以第一父提交为比较基准；另一父分支的独立文件不得出现在此次详情列表。

## 修复与防复发

- 先读取并解析提交元数据，再把解析出的完整提交哈希和第一父哈希传入 numstat 命令；根提交继续使用 `--root`。
- 扩展既有真实 Git 测试，联合验证根提交、普通提交、合并提交的列表、统计和逐文件 Diff；没有新建永久测试文件。
- 验证命令：`pnpm exec vitest run packages/git-cli/src/adapters/git-cli-client.integration.test.ts packages/git-cli/src/commands/read-repository.test.ts --maxWorkers=2`，2 文件、41 测试通过。

## 未闭环项与下一步

- 本轮使用隔离临时 Git 仓库，没有执行 Electron 历史页面点击；调用链入口通过当前源码核对。
- 统计读取由原先并行改为依赖元数据的顺序读取，增加一次串行 Git 子进程等待；未开展性能基准。该边界不影响上述正确性结论。
