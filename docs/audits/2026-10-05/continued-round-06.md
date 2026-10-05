# 持续检查第 6 轮：代码分析切换工作区后的失败恢复

- 范围：renderer 代码分析 Hook 与分析页面。
- 触发：工作区 A 启动分析尚未返回，切换 B 并再次启动；A 的失败/异常最后返回。另外，A 的“建立完整索引”失败后页面仍执行旧范围回滚。
- 预期：B 的忙碌状态、反馈和范围选择只受 B 的操作影响；A 已显示的失败也不应带入 B。
- 根因：`start` 缺少请求和工作区失效检查，`applyState` 仅运行态清除旧错误；页面 `buildFullIndex` 在 await 后无条件恢复此前 scope。
- 修复：启动请求绑定请求序号与 Hook 生命周期；工作区变更时失效旧启动并清理错误；完整索引启动失败只在相同页面工作区/设置作用域内回滚范围，A/B/A 也使用不同 token。
- 红证据：`temp/goal-ten-rounds/round-6/red.log` 新增 Hook 3 条失败（旧失败、旧异常、旧错误跨工作区）；`page-red.log` 页面范围回退测试失败。
- 绿证据：`temp/goal-ten-rounds/round-6/green.log`，2 文件 62/62 通过，其中新增 4 条。
- 命令：`pnpm exec vitest run apps/desktop/src/renderer/src/entities/code-analysis/useCodeAnalysis.test.tsx apps/desktop/src/renderer/src/pages/code-analysis/CodeAnalysisPage.test.tsx`。
- 已排除：AI 提交草稿的手写修改保护、设置保存后的较新草稿保护、历史页同 HEAD 切仓筛选清除都有现有防护与对应测试；未重复修改。
- 复核候选：`start` 挂起期间人为调用 `reload` 且读取失败可能保留 starting。当前唯一生产 Hook 使用者为 CodeAnalysisPage，`reload` 只由无 snapshot/无 progress 的错误空态“重新读取”按钮触发；starting 会渲染 progress 并清空错误，正常 UI 无法触发该并发组合。本轮不将直接调用 Hook 的不可达组合列为已确认用户问题。
- 验证边界：真实 Hook 和真实页面分别通过 jsdom 与可控 IPC Promise/控制器验证；未运行外部 Language Server 或真实 Electron 分析操作。
