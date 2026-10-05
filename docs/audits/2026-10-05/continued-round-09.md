# 持续检查第 9 轮：终端入口工作区隔离与失败重试

- 范围：Activity Rail 使用的 `useExternalTerminals`，App 工作区参数传递，现有外部应用交互测试文件。
- 生产入口证据：`ActivityRail.tsx` 的 `aria-label="打开终端"` 按钮调用 `onOpenTerminal`；`App.tsx` 提供的回调执行 `externalTerminals.open(defaultTerminalProfile.kind)`，disabled 状态也使用该 Hook 的 loading/active。此入口不同于顶部 Open In。
- 触发：工作区 A、B 含同一仓库/Worktree；A 的终端启动尚未返回时切换到 B，B 的启动仍被 A 锁住，且 A 的成功/失败反馈会落到 B。另确认同一渲染前连续调用会发出两个系统启动请求。
- 根因：终端 Hook 只用目标 ID 触发生命周期重置，缺少工作区身份；忙碌检查使用尚未重新渲染的 `active` 闭包值，旧入口回调也没有作用域检查。
- 修复：App 传入 workspaceId；目标与工作区共同生成作用域 token；切换时失效旧回调与回包，且旧 finally 不得解锁新启动；使用同步 in-flight ref 防止重复调用，失败后释放以便重试。
- 红证据：`temp/goal-ten-rounds/round-9/red.log`，新增 5 条全部失败，原 13 条通过。
- 绿证据：`temp/goal-ten-rounds/round-9/green.log`，外部应用/终端测试与 Activity Rail 测试共 20/20 通过。
- 三轮 renderer 类型检查：`pnpm exec tsc -p apps/desktop/tsconfig.web.json --noEmit` 退出 0；日志 `temp/goal-ten-rounds/round-9/renderer-typecheck.log`。renderer 变更 `git diff --check` 通过。
- 命令：`pnpm exec vitest run apps/desktop/src/renderer/src/features/external-application/useExternalApplications.test.ts apps/desktop/src/renderer/src/widgets/activity-rail/ActivityRail.test.tsx`。
- 区别于旧审计：旧修复对应 Open In 的 `useExternalApplications`；Activity Rail 的独立 `useExternalTerminals` 未获得相同防护，本轮覆盖实际不同调用路径。
- 验证边界：jsdom 挂载真实 Hook，验证成功、失败、异常、重复调用、恢复重试及旧回调；未启动用户机器上的真实终端，也未声明 Electron E2E。
