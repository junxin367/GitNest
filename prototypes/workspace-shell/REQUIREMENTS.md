# Workspace Shell 功能需求记录

> 更新日期：2026-09-04
> 状态：M1、M2、M3、三轮最终硬化与 1.0.0 总集成全部验收通过

## FR-001：添加目录并自动扫描 Git 仓库

### 用户目标

一个 Workspace 可以包含多个同级顶层条目。用户可以通过文件夹选择器、手动路径或目录拖拽添加本地目录，软件自动识别该目录及其子目录中的 Git 仓库，并根据扫描结果分类和分组。

扫描过程只读取目录和 Git 状态，不修改文件，不执行 Fetch、Pull、Checkout、Clean 等 Git 操作。

### 示例目录

以 `D:\code\sc\sc_code` 为例：

| 相对路径 | 识别结果 | 页面分组 |
| --- | --- | --- |
| `.`（`sc_code` 自身） | Workspace 根目录本身也是 Git 仓库 | `Workspace 元仓库` |
| `core` | 直接位于 Workspace 根目录下的独立仓库 | `根目录仓库`（默认分组名） |
| `svr\*` | 位于 `svr` 目录下的仓库 | `svr` |
| `web\*` | 位于 `web` 目录下的仓库 | `web` |
| `python\*` | 位于 `python` 目录下的仓库 | `python` |
| `tool\*` | 位于 `tool` 目录下的仓库 | `tool` |

### 自动分组规则

1. 根目录自身是 Git 仓库，且内部还有独立仓库时，顶层类型为 `Workspace 元仓库`。
2. 根目录自身不是 Git 仓库，但内部包含仓库时，顶层类型为 `Workspace 目录`。
3. 根目录自身是 Git 仓库，且内部没有其他独立仓库时，顶层类型为 `普通仓库`。
4. 即使根目录已经识别为 Git 仓库，也必须继续扫描其子目录。
5. 直接位于聚合根目录下的子仓库统一放入默认分组 `根目录仓库`，例如 `core`。
6. 位于更深层级的仓库，默认使用其相对路径的第一个目录作为分组名：
   - `svr\ScResSvr` → `svr`
   - `web\scportal` → `web`
   - `python\sc-video-cut` → `python`
   - `tool\ScCommJob` → `tool`
7. 分组名称默认取自真实文件夹名称，不依赖预先写死的目录列表。
8. 多个聚合目录和普通仓库作为同级顶层节点展示。
9. 顶层节点显示名称、类型标识和完整路径。
10. 分组标题显示仓库数量，并支持独立折叠和展开。
11. 仓库数量、路径和分组必须来自当前扫描结果，不能使用页面硬编码数据。

### 路径和身份规则

- 完全相同的规范化绝对路径重复添加时定位已有条目。
- 不同本地路径始终是不同仓库实例，即使名称、Remote 和提交相同。
- Remote URL 不参与仓库去重。
- 共享同一 Git common directory 的 linked worktree 分别展示路径，但关联到同一本地仓库实例。
- 根目录重叠时，仓库显示在路径最具体的已添加根目录下。

### 基础扫描边界

- 必须排除仓库自身的 `.git` 内部目录。
- 不应把依赖、缓存或构建产物中的嵌套 Git 目录误识别为 Workspace 仓库。
- 发现非根级子仓库后默认停止继续扫描其内部。
- 默认不跟随指向所选根目录之外的符号链接。
- 扫描失败或无权访问的目录应单独报告，不能中断其他目录的扫描。
- 本次需求中的“自动扫描”仅负责发现和展示，不自动执行远程同步。

### 验收示例

选择 `D:\code\sc\sc_code` 后，仓库树至少应呈现以下结构：

```text
sc_code                         [Workspace 元仓库]
D:\code\sc\sc_code
├─ 根目录仓库
│  └─ core
├─ svr
├─ web
├─ python
└─ tool

ordinary-repository             [普通仓库]
F:\projects\ordinary-repository
```

## FR-002：Workspace 持久化与自动刷新

- Workspace、顶层条目、顺序、显示名称、自动分组和折叠状态只保存到 GitNest 应用数据目录。
- 默认不在用户项目中创建 `.gitnest` 文件。
- 启动立即展示上次 Snapshot，随后后台重扫和刷新。
- 监听工作目录和 Git 元数据；外部终端、TortoiseGit、UGit 或 IDE 的操作也能触发刷新。
- 监听不可用时降级为低频轮询。
- 首版只允许修改顶层条目的显示名称和顺序，不支持任意移动自动分组中的仓库。

## FR-003：日常 Git 工作流

- 支持 Diff、Stage、Unstage、Commit、历史和提交详情。
- 支持 Fetch、`ff-only` Pull 和 Push。
- 支持分支查看、创建、切换、重命名和安全删除。
- Stage、Unstage 和 Commit 在用户明确点击后执行。
- Pull、Push、分支和其他高风险操作先执行状态预检。
- 预检结果使用短期有效且绑定命令参数的确认凭据；目标状态或影响集合变化时必须重新预检。
- 破坏性操作必须展示具体仓库、分支、路径和影响范围，并由用户二次确认。
- 首版不提供普通 Force Push、任意 Reset、Clean 或自定义 Git 命令。
- 批量操作拆为逐仓任务，允许部分成功并单独重试失败项。

## FR-004：混合认证

- 默认复用用户现有 Git Credential Helper、SSH Agent、`.ssh/config` 和仓库 Git 配置。
- 提供 GitNest 账号中心，支持 GitHub、GitLab、Gitee 和自建 Git 服务的 HTTPS Token。
- Token 首次录入时只短暂存在于受控表单并单向提交给 Main，随后保存到 Windows 安全存储；它不进入前端全局状态、普通 JSON、IPC 返回值、Git 参数、日志或遥测。
- 支持主机默认账号和仓库级账号覆盖。
- SSH 只使用系统已有身份，不导入或保存私钥与私钥口令。
- OAuth、MR 和 Issue 平台集成不属于首个正式版本。

## FR-005：Worktree 与外部终端

- 支持 Worktree 创建、Lock/Unlock、Move、Repair、Prune 和安全移除。
- Primary Worktree 不允许移除。
- 首版不允许强制移除脏 Worktree。
- Prune 只清理失效 Git 登记，不删除仍存在的目录。
- Worktree 路径可以位于 Workspace 根目录之外，但必须由用户选择或位于已配置根目录下。
- Worktree 写操作先预检；Move、Prune、Remove 等有明显影响的操作展示精确路径并二次确认。
- 支持在当前仓库或 Worktree 中启动 Windows Terminal、PowerShell、CMD、Git Bash 或用户配置的外部终端。
- 首版不实现内置终端。

## FR-006：交付里程碑

- M1：桌面框架、目录添加、扫描分组、持久化、缓存和状态聚合。
- M2：日常 Git 工作流、混合认证、操作队列和外部终端。
- M3：完整 Worktree 管理、恢复、迁移、日志、Windows x64 安装包和便携压缩包。
- 三个里程碑均可独立运行；全部完成后发布首个正式版本。
- 首个正式版本不启用自动更新，待发布渠道和代码签名方案确定后再接入。
