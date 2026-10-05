# 持续检查第 3 轮：更新窗口异步状态回退

- 范围：renderer 更新状态 Hook、现有版本弹窗测试。
- 触发：打开项目操作尚未返回时收到下载进度事件；或两项操作逆序完成；或初始读取晚于手动检查完成。
- 预期：后发生的状态事件或操作结果应保留，下载进度和最新版本不得被更早快照回滚。
- 确认：原实现仅在首次读取中使用 `eventReceived`，动作 `run` 对每次响应无条件 `setState`，初始读取也不识别已经完成的手动操作。
- 修复：初始读取、操作启动、推送事件共享递增 revision；只接受仍属于当前 revision 的读取响应，卸载时失效旧请求。
- 红证据：`temp/goal-ten-rounds/round-3/red.log`，新增 3 条乱序回归全部失败，旧 2 条通过。
- 绿证据：`temp/goal-ten-rounds/round-3/green.log`，同文件 5/5 通过。
- 命令：`pnpm exec vitest run apps/desktop/src/renderer/src/features/application-update/VersionDialog.test.tsx`。
- 排除：AI 提交草稿已有请求令牌、草稿 revision 和目标作用域防护；不重复修改这一路径。
- 验证边界：jsdom 挂载真实 Hook、模拟 IPC 事件及可控 Promise；未运行真实下载、安装或 Electron E2E。无需修改主进程更新服务。
