<div align="center">
  <img src="apps/desktop/build/icon.png" alt="GitNest 图标" width="72" />
  <h1>GitNest</h1>
  <p>面向 Windows 的本地优先多仓库 Git 工作台</p>
</div>

<p align="center">
  <img src="docs/assets/gitnest-workspace-demo.png" alt="GitNest Workspace 概览" width="1280" />
</p>

GitNest 将多个 Git 仓库放进同一个 Workspace，集中查看状态，并在一个桌面窗口中处理日常 Git 工作流。

## 功能

- 聚合多个目录或独立仓库，按目录分组并查看整体状态。
- 查看工作区变更与 Diff，暂存、取消暂存并提交。
- 浏览提交历史、分支同步状态及关联 Worktree。
- 使用代码分析和 MCP Server 扩展仓库导航与分析工作流。

## 开发

需要 Node.js 22 或更高版本、pnpm 11.19.0 和 Git for Windows。

```powershell
pnpm install
pnpm dev
```

常用检查与构建命令：

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm dist:win
```

## 样例数据

截图和离线原型使用虚构的 `sample-platform` 仓库、`C:\Demo\...` 路径及示例作者，不包含真实仓库快照。原型页面可在 [`prototypes/workspace-shell/index.html`](prototypes/workspace-shell/index.html) 查看；它仅用于界面预览，不会读取本机文件或执行 Git 命令。
