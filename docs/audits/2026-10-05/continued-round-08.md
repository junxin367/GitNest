# 持续复查第 8 轮：放弃文件/目录替代时的精确删除授权

## RCA 结论

- 状态：已确认。
- 触发：已跟踪文件被包含新文件的目录替代，只选择原文件的删除项执行放弃；或已跟踪目录被新文件替代，只选择原目录内被删除的文件执行放弃。
- 现象：Git restore 返回成功，但会删除未选、未确认的替代内容；目录中的 ignored 文件同样被删除。批量中其他已选文件也已被还原，无法再整体拒绝。
- 直接原因：恢复索引文件需要移除工作区同名目录；恢复索引子路径需要把阻挡的工作区父文件替换为目录。Git restore 会执行这些隐含覆盖。
- 根因：application 对明确请求路径核对了未跟踪授权，却没有把该集合传给底层 restore；CLI 只把路径交给 Git，未核对隐含覆盖的祖先或目录后代。
- 系统性根因（本轮实现/测试范围）：旧回归覆盖“同一个请求路径跟踪类型变化”和 stage/unstage 的文件目录替代，但未覆盖 restore 隐含影响范围与 ignored 内容；原 GitMutationClient port 无法表达此次还原允许顺带移除哪些未跟踪文件。
- 关键因果链：`RepositoryMutationService.discard` → snapshot 中原文件删除项合法 → `restoreWorktreePaths` → Git 隐式移除未确认内容 → 后续 clean 无法挽回。

## 证据

| 判断 | 类型 | 证据 | 来源 |
| --- | --- | --- | --- |
| 只选原跟踪删除项也成功写入 | 事实 | 应 INVALID_REQUEST，实际成功回执 | `temp/goal-ten-rounds/round-8/red.log` |
| 普通、ignored、部分确认目录内容真实丢失 | 事实 | 三例未确认文件读取均为 ENOENT，批量另一编辑也已被还原 | `temp/goal-ten-rounds/round-8/red-expanded.log` |
| 逆向替代同样覆盖未确认父文件 | 事实 | 应保留父文件，实际读取为 EISDIR，父文件已变目录 | `temp/goal-ten-rounds/round-8/red-parent-and-positive.log` |
| 精确授权修复，完整确认仍可正常还原 | 结论 | 四个拒绝场景及两个完整确认正向场景共 6 例通过 | `temp/goal-ten-rounds/round-8/green-focused.log` |

## 异常状态溯源

- 适用约束：在 discard 请求未授权删除某未跟踪路径时，操作不得因为该路径是已选路径的祖先或后代而隐含删除其内容；依据是既有 `expectedUntrackedPaths` 契约及既有拒绝跟踪类型变化测试。
- 本次运行前提：命中。四个红测的受影响文件均不在 confirmed 集合，ignored 用例还明确不出现在普通 status 的未跟踪列表中。
- 值判断：用户选择和授权集合本身合法；缺陷在 restore 消费者扩大了写入范围。
- 数据流：用户确认集合 → service 仅用于对照显式请求 → 未传给 CLI → CLI 无法校验 Git 隐含覆盖。首次范围偏离发生在 Git restore 对替代路径执行覆盖。

## 修复与防复发

- 增加内部 `RestoreWorktreeOptions.confirmedUntrackedPaths`；service 将已验证的授权集合传给 Git CLI，不修改 IPC contracts。
- restore 前使用 literal `ls-files --stage -z` 将此次 pathspec 展开为实际索引叶路径。普通文件与索引符号链接的祖先非目录阻挡项必须明确确认；它们在工作区被目录替代时，枚举实际文件系统叶节点，包含 ignored 文件，逐一核对授权。目录内符号链接按叶节点检查，不向链接目标递归；索引 gitlink（160000）不进入文件枚举，restore 显式传入 `--no-recurse-submodules`，避免用户递归配置扩大授权范围。
- 所有上述检查在调用任何批量 restore/clean 之前完成；任何未确认内容都会整体拒绝，其他已选编辑也保持原样。
- 完整选中并确认替代内容时，保留两个方向的合法还原行为，最终 tracked/staged/untracked 状态干净。
- 新增 10 条既有真实 Git 集成测试（初版 6 条、索引类型复核 3 条、递归配置参数化增加 1 条）；没有新增永久测试文件。最初两个正向断言仅因 Windows CRLF fixture 失败，显式关闭 fixture autocrlf 后，在修复前就已通过，不计为产品缺陷。
- 最终完整针对性验证：`pnpm exec vitest run packages/git-cli/src/adapters/git-cli-client.mutation.integration.test.ts packages/application/src/repository/repository-mutation-service.test.ts packages/git-cli/src/commands/write-repository.test.ts --maxWorkers=2`，3 文件、61 测试全部通过；日志：`temp/goal-ten-rounds/round-8/green-final-no-recurse.log`。`green.log` 的 51 条、`green-final.log` 的 54 条均为中间实现证据。

## 独立复核纠正

- 初版直接把“请求末级路径是目录”当作原文件被目录替代，错误拦截正常 `restore -- src`，也错误要求 dirty gitlink 内部文件的删除授权。
- 独立复核提供两个真实红测及原生 Git 行为对照；并入既有 mutation integration 后再次得到 2 红，另一个“目录前缀内的索引 blob 被目录替代”保护场景通过。证据：`temp/goal-ten-rounds/round-8/review-red.log`。
- 根因是首版范围检查只使用工作区类型，没有同时考虑索引类型及 pathspec 展开后的真实写入对象。
- 最终按索引模式与实际叶路径检查：普通目录还原其跟踪文件并保留未跟踪兄弟；选择目录前缀也不会绕过对被替代 blob 后代的保护；dirty gitlink 与普通文件一起放弃时普通文件还原，gitlink 内部修改保持不变。
- 再次复核真实 active 子模块配置发现：`.gitmodules`、`submodule.child.active=true`、`submodule.recurse=true` 会使不带递归选项的 restore 进入子模块，恢复未确认的内部编辑。永久 gitlink 测试参数化 false/true 后，true 情况实际从 `changed child` 变回 `original child`，形成 1 红、1 绿；证据：`temp/goal-ten-rounds/round-8/recurse-config-red.log`。
- 第二次纠正不再依赖 Git 的默认递归设置：命令显式加入 `--no-recurse-submodules`，且命令参数测试同步断言；完整保留 active 子模块的 false/true 两种配置回归。

## 已排除解释

- 不是旧的“放弃确认后跟踪状态变化”：原选中文件始终是跟踪删除项，已有授权检查正常通过；丢失的是其他路径。
- 不是 clean 删除范围过大：没有任何未跟踪确认的场景也发生数据丢失，定位到先执行的 restore。
- 不是仅保护 status 返回文件即可：ignored 红测证明实际目录内容必须参与核对。
- 本轮先检查 application 查询取消、操作队列和远端环境释放路径，未确认独立新缺陷，没有为这些候选留下实现修改。

## 未闭环项与下一步

- 这是执行前范围校验，不是与外部编辑器/Git 进程共用的事务锁；文件系统检查和 restore 之间仍存在外部并发修改的 TOCTOU 边界。
- 执行前增加一次索引查询；替代目录检查增加文件系统读取，目录越大成本越高，遇到首个未确认文件即拒绝。未做大型目录性能基准。
- 未在本轮操作 Electron 确认弹窗；通过真实 application service 与 Git CLI、隔离 Git 仓库验证完整写入入口，未修改用户真实仓库。
