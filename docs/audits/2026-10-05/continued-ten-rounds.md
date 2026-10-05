# 继续确认问题与修复：十轮汇总

本次从提交 `8e5399f` 后的干净工作区继续，基线为 119 个测试文件、1621 项测试。此前 `operation-scenarios.md` 的十一轮不计入本次十轮。各轮独立复现、定位和修复，跨领域并行执行；最终统一检查相互影响。十轮现已完成，新增 36 条回归测试，另扩展既有合并提交和 MCP 注册测试。

## 各轮记录

| 轮次 | 检查范围 | 状态与证据 |
| --- | --- | --- |
| 1 | 大批量 AI 提交摘要的读取与请求预算 | 已修复；[记录](continued-round-01.md) |
| 2 | 合并提交文件列表与逐文件 Diff 一致性 | 已修复；[记录](continued-round-02.md) |
| 3 | 更新窗口事件、动作、首次读取的异步顺序 | 已修复；[记录](continued-round-03.md) |
| 4 | 工作区文件系统链接分类 | 已修复；[记录](continued-round-04.md) |
| 5 | 分支、标签与远端同名引用 | 已修复；[记录](continued-round-05.md) |
| 6 | 代码分析跨工作区异步状态 | 已修复；[记录](continued-round-06.md) |
| 7 | MCP 取消注册后的结果反馈 | 已修复；[记录](continued-round-07.md) |
| 8 | 放弃修改时文件／目录替换的隐含删除 | 已修复，并闭环独立复核发现的目录／子模块边界；[记录](continued-round-08.md) |
| 9 | 终端重复启动、工作区隔离与失败重试 | 已修复；[记录](continued-round-09.md) |
| 10 | 更新任务期间浏览器打开失败 | 已修复；[记录](continued-round-10.md) |

## 复核与最终验证

- 独立复核覆盖第 1、2、3、4、5、6、8、10 轮的实现、调用链和红绿证据；主代理另外核对 MCP 回读失败的表述、终端入口的实际可达性。所有提出的具体修复问题均已处理或通过生产入口证据排除。
- 初次全量 119 文件、1653 项测试通过，但独立真实 Git 探针暴露第 8 轮新增保护误拒正常目录／子模块的回归。按索引类型修正后，又用真实配置确认 `submodule.recurse=true` 会覆盖子模块内部编辑，最终显式禁用递归并添加回归。初次全绿没有作为完成依据；日志保存在 `temp/goal-ten-rounds/full-tests-before-restore-review.log`。
- 第 8 轮最终相关 3 文件、61 项测试通过，覆盖未确认内容保护、完整确认后的合法恢复、普通目录、目录内替代文件，以及子模块递归开关两种配置。两份独立临时测试源文件已删除，复现日志保留。
- 最终 `pnpm test --maxWorkers=2`：119 个文件、1657 项测试全部通过，耗时 146.27 秒；最终日志为 `temp/goal-ten-rounds/full-tests.log`，本次比基线新增 36 项。
- 最终 `pnpm typecheck`、`pnpm check:architecture`、`pnpm build`、`git diff --check` 均通过，对应 `typecheck.log`、`architecture.log`、`build.log`、`diff-check.log`。
- 最终 `pnpm smoke:workflow` 通过，使用修正后的构建与隔离用户目录、临时仓库。实际 Electron 流程覆盖启动、扫描两个仓库、切换目标、watcher 刷新、搜索文件、打开和搜索 Diff、重启恢复；结构化结果 `electron-workflow-baseline.json` 为 `ok: true`，运行日志为 `electron-workflow.log`。
- 本次测试及运行证据统一保留在 `temp/goal-ten-rounds/`。原始失败日志保留；测试设施错误与产品缺陷分别说明。

## 验证边界

- Git 写入用隔离的真实临时仓库验证；外部并发写入仍可能发生在检查与 Git 执行之间，未声称提供跨进程事务。
- AI、浏览器跳转错误、Renderer 异步故障通过受控接口注入；未向真实 AI 服务发送请求，也未启动真实安装器或终端。
- 原生文件 symlink 创建受当前 Windows 权限限制，该用例采用受控文件系统观察；真实目录 junction 的既有验证保留。
- 没有操作本机真实 Codex 注册。MCP 回读接口仍是布尔判定，新文案不把回读失败等同于确证已删除。
- 本轮修复保留在工作区。此前的提交及安装包属于 `8e5399f` 基线，本报告中的最终构建指本轮源码的应用构建。
