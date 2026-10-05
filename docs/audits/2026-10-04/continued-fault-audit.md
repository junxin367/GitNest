# GitNest 持续故障确认与修复

2026-10-04 23:35 起（UTC+08:00），继续上一轮故障复查。保留此前未提交修改，未暂存、提交或推送工作仓库。本轮按操作结果和失败时序验证，不统计阅读覆盖。

## 已确认的产品问题

| 问题 | 修复前复现 | 修复及验证 |
| --- | --- | --- |
| 多 Worktree 批量 Fetch/Pull/Push 自行失效 | 真实 Git 的 main 与 linked feature 分支分别可更新，但第一项改变共享 refs 后，后续项报 `PREFLIGHT_CHANGED`；三类操作均先红 | 预检指纹排除其他分支及 ahead/behind 跟踪缓存，保留目标 HEAD、工作区状态、上游和有效远程地址。Fetch 仍逐目标执行，不合并不同 Worktree 的配置。Pull 在目标 SHA 不变时允许对象从本地未知变为已知；Push 仍比较 ancestry/pullStrategy。三类真实批量回归和 24 项确认前/排队中变更拒绝回归通过 |
| 首次提交前取消暂存失败 | 暂存新文件后继续编辑，unborn 分支的 `git rm --cached` 退出码 1 | 此分支使用 `--cached --force` 移除指定索引项。真实服务回归确认工作文件内容和其他暂存项保留 |
| 旧提交刷新清空新草稿 | A 提交成功后等待刷新，用户 A→B→A 并输入下一份草稿，旧刷新结束后触发旧的提交完成回调，把新草稿清空 | `useRepositoryMutations` 在异步刷新后再次核对请求代次。真实页面组件回归先失败再通过；同目标正常提交仍会清空已提交草稿 |
| MCP 响应超出配置字节上限 | 64 KiB 限额下，真实 stdio 请求使用普通数字和 UUID ID，分别输出 65,560 和 65,597 字节 | 按实际请求 ID 计入 JSON-RPC 外壳、stdio 换行及 `isError` 字段；真实 `runMcpServer` 流回归通过 |

## 上轮 Electron 异常的根因与修复

最小 Electron 44.2.0 程序加载一个由本地 HTTP 服务暂缓返回的页面。页面尚未提交时启用 CDP Runtime，稳定出现与上一轮相同的两条错误：

```text
Electron sandboxed_renderer.bundle.js script failed to run
Cannot destructure property 'preloadScripts' of 'binding.startupData' as it is null.
```

此时 CDP 目标列表已经显示目标 URL，但执行上下文仍是初始空文档（origin 为 `://`）。正式文档提交后，正常的页面和 preload 仍能加载，因此仅等目标列表出现 URL 或最终 app-shell 可见不能排除此错误。

对照实验在正式文档提交后才启用 Runtime，错误消失。共享 CDP helper 新增 `waitForDocument()`，使用 `Page.getFrameTree` 检查已提交的主文档，再启用 Runtime；四个桌面/打包脚本统一调用。受控探针还验证它不会在文档被闸门阻塞时提前放行。

本次定位的是验证工具附着时序触发的 Electron 初始化错误；没有关闭 sandbox、过滤日志或修改依赖包。未据此推断普通用户启动必然失败。修复后原恢复脚本连续三次通过，新产品构建上的恢复验证也通过。

上游实现核对范围为 Electron `v44.2.0` 的 `lib/sandboxed_renderer/init.ts`、`shell/renderer/electron_sandboxed_renderer_client.cc`、`shell/renderer/renderer_client_base.cc`；判断以本机受控红/绿实验为依据。

## 验证记录

- 最终全仓复测：**119 文件、1,276 项全部通过**，23:55:31 开始，耗时 59.04 秒；比上一轮增加 34 项。最终类型检查与 diff 检查通过。
- 第一轮全仓测试：119 文件中 118 通过，1,276 项中 1,275 通过。唯一失败为长 Push 取消后测试远程分支仍更新；保留失败记录，调查结果见下文。
- 类型检查、架构检查、桌面及独立 MCP 构建、diff 检查均通过。
- 新构建的普通桌面工作流、恢复及 Worktree 七类操作验证通过。Worktree 创建/删除/清除使用 UI，锁定/解锁/移动/修复使用公共 bridge。
- 四个 Electron 验证脚本与共享 CDP helper 的语法检查通过。旧 M2 界面流程和安装器流程未运行，不计作完整验证。

## Push 取消测试的时序前提

旧测试用 10 秒 hook 配合固定 250ms 定时取消，却没有记录 hook 是否正在执行，也没有记录 abort 与远端写入的先后顺序。

受控对照证明：hook 放行且独立进程已确认远端更新后，在 Node 尚未派发 Git close 回调前取消，仍可能收到 `COMMAND_CANCELLED`。本次证据中远端确认时间为 `1791129288042`，abort 为 `1791129288051`。因此“收到取消错误”不能单独证明远端从未写入。

既有回归改为 hook 原子写入 READY 后持续等待释放闸门，测试确认 READY 后取消，再检查取消结算、hook PID 返回 `ESRCH`、无完成标记、远端未变化。计时器与 fixture 均在结算后清理。此受控场景通过，未修改生产 process runner。

**原全测单次失败的精确原因仍未确认**：旧日志不足以区分迟到取消与进程终止失败，不归因于并发负载，不声称修复了 taskkill 故障。将取消测试同步方式的修正与产品缺陷修复分开记录。

## 核实后未计作新缺陷的项目

- MCP TTL：正常 IPC 和持久化入口限制 1–365 天；新增 0/366 拒写回归证明旧文件与凭据不变。手工损坏配置属于已有边界，未将其包装成正常使用缺陷。
- 其他 Renderer 目标切换路径未获得可信失败证据，不报告“可能有问题”作为发现，也不据此声称没有遗漏。

关键输出见 [continued-validation.txt](continued-validation.txt)，完整日志位于 `temp/continue-audit-20261004`。临时探针源码已删除。自动审批以 `blocked by policy` 拒绝递归删除本轮隔离 Electron fixture，目录保留，未换工具绕过限制。
