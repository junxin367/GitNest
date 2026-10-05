# 持续复查第 5 轮：同名标签与分支操作名称

## RCA 结论

- 状态：已确认。
- 触发：本地分支 `release` 与标签 `release` 同名；远端跟踪引用 `origin/main` 与标签 `origin/main` 同名。
- 现象：分支列表名称变为 `heads/release`、`remotes/origin/main`，状态上游也变为 `remotes/origin/main`。从列表执行切换会把命名空间前缀作为分支名传给 Git，失败；Pull 的上游远端识别也会失败。
- 直接原因：Git 的短引用格式为消除名字歧义而保留额外的命名空间片段。
- 根因：应用把用于显示/消歧义的 short ref 当作稳定的领域分支名称和 `remote/branch` 上游名称。
- 系统性根因（本轮仓库范围）：现有真实 Git 分支测试没有创建同名标签；结构化 parser 测试只提供已经正确的短名称，未覆盖 Git 实际生成方式。
- 关键因果链：`for-each-ref` / porcelain status → short ref → `Branch.name` / `snapshot.upstream` → 命令预检/执行 → 错误分支参数或不可识别上游。

## 证据

| 判断 | 类型 | 证据 | 来源 |
| --- | --- | --- | --- |
| 标签导致本地分支名被加上 heads/ | 事实 | 期望 release，实际 heads/release | `temp/goal-ten-rounds/round-5/red.log` |
| 远端分支与 status 上游也受影响，实际切换失败 | 事实 | 四项失败包含远端 name、upstream 和 Git 128 | `temp/goal-ten-rounds/round-5/red-expanded.log` |
| 关闭歧义警告不能修复格式 | 事实 | 临时 fixture 设 core.warnAmbiguousRefs=false 后仍四项失败；探查设置未保留 | `temp/goal-ten-rounds/round-5/ambiguity-config-probe.log` |
| 稳定格式允许真实 Pull 与分支切换 | 结论 | 3 文件、37 测试通过 | `temp/goal-ten-rounds/round-5/green.log` |
| 没有误删名字本身的 heads/ 或嵌套远端层级 | 事实 | heads/topic、local upstream heads/base、remote team/origin/main 保持原值 | `temp/goal-ten-rounds/round-5/namespace-boundaries.log` |

## 修复与防复发

- 分支列表将 `refname:short` 和 `upstream:short` 改为从完整引用定界裁剪的 `:lstrip=2`，只去掉 `refs/heads` 或 `refs/remotes` 两层。
- 状态存在当前分支及上游时，按当前完整分支引用读取 `upstream:lstrip=2`；`readRepositorySnapshot` 与 `inspectRepository` 共享该修正。没有对收到的短字符串做猜测性 strip。
- 新增 2 条既有集成测试：同名标签下的列表、快照、仓库检查、真实 Pull 与切换；以及本地上游和嵌套远端名称边界。
- 标签保持不变；不改变既有 application 对本地上游（remote 为 `.`）的支持范围。
- 首次 green-focused 测试因同一案例连续执行 Pull 与切换的多次真实预检超过 5 秒；该新增端到端案例按其他多步命令案例设 15 秒。没有放宽原有测试超时；后续完整三文件验证通过。

## 已排除解释

- 不是 Shell 引号或特殊字符转义错误：所有命令用参数数组，实际错误字段在命令执行前的读取结果中已出现。
- 不是标签抢走 `git switch release` 的选择：稳定名称修复后，实际命令切换到本地 release，标签列表保持不变。

## 未闭环项与下一步

- 有上游的状态读取增加一个只读 Git 子进程；本轮未做大型工作区性能基准。
- 分支和上游在外部进程并发更改时，快照仍非 Git 事务；未宣称获得跨命令原子读取。
- 全部真实命令在本地临时仓库和 bare 远端完成，没有外部网络认证或 Electron 点击验证。
