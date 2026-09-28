# GitNest 自动更新与 GitHub 自动发布设计

**日期：** 2026-09-22

**状态：** 已实施；待现有并行改动收口后完成整仓打包验证

## 目标

为 GitNest 增加以 GitHub Release 为唯一发行源的 Windows 自动更新和自动发布能力，并将现有顶部“帮助 → 版本”入口改为可交互的版本弹窗。

本设计完成后：

1. 推送与应用版本一致的正式标签 `vX.Y.Z` 后，GitHub Actions 自动验证、构建并发布 Windows NSIS 安装包和 Portable 版本。
2. Release 同时包含校验和、发行清单和供应用读取的 `latest.json`。
3. 已安装的 GitNest 在启动后自动检查正式版本更新，但不自动下载或安装。
4. 每个新版本最多自动提醒一次；关闭或选择稍后后，同一版本不再主动弹窗。
5. 用户可以随时通过“帮助 → 版本”查看当前版本、最新版本、更新说明并手动检查。
6. NSIS 安装版允许用户确认后下载、校验并启动新版安装器；Portable 只打开 GitHub Release。
7. 更新失败不影响 GitNest 启动、Workspace 数据或现有 Git 操作。

## Superpowers 治理契约

- 适用性判定：治理。
- 状态：书面规格已由用户确认，已进入实施。
- 任务等级：复杂高风险。
- 当前已生效的上位约束：默认使用简体中文；保留现有脏工作区；未经用户明确要求不创建 worktree、不执行 commit；本次任务中新建的临时测试文件必须删除。
- 用户明确指定：使用 `superpowers:brainstorming`；参考 CodexPlusPlus；开发自动更新、GitHub 自动构建和“帮助 → 版本”弹窗；其余决策由 Agent 补齐。
- 用户后续明确指示：直接进入开发，不创建实施计划，开发阶段不使用 Superpowers。
- 禁用或裁剪的通用默认步骤：不创建 worktree；不自动 commit。
- 开发期反馈：只运行受影响范围的最小测试。
- 交付单元验收：分别验收更新运行时、版本弹窗、发布流水线。
- 最终集成验证：安装包版本、Git 标签、Release 资产、`latest.json` 和应用展示版本完全一致。
- Review 检查点：实施计划形成后进行一次方案交叉审查；每个独立验收闭包完成后最多一次实现 Review。
- 可复用证据：现有 Windows 打包、升级保留数据和卸载冒烟测试可以复用；修改相关脚本后只重跑失效范围。
- Worktree：禁止。
- Commit：禁止。

### Task UPDATE 验收闭包

- 单一交付目标：GitNest 安装版能够安全检查、下载并启动正式版更新安装器。
- 问题所有者：Main 进程更新服务及其持久化、下载和安装边界。
- 输入与前置条件：已打包应用、有效 `latest.json`、可访问的正式 GitHub Release。
- 业务不变量族：只接受更高正式版本；只下载 GitNest x64 NSIS 安装包；下载内容通过大小和 SHA-256 校验；失败不影响应用正常运行；同一任务不并发重复执行。
- 允许修改范围：Main 更新服务、数据注册表、IPC/Preload 契约、启动接线、诊断和相关测试。
- 禁止修改或必须移交的范围：Workspace、Repository、Worktree 业务状态和用户仓库文件。
- 可观察验收证据：版本比较、清单验证、提醒去重、下载校验、并发复用和安装器启动测试；打包应用升级验证。
- 独立回滚边界：移除更新服务和 IPC 后，GitNest 现有 Git 与 Workspace 功能保持可用。
- 前置依赖、并行条件与共享写入：依赖 RELEASE 产出正确资产；与 VERSION-UI 共享更新 DTO，不允许并行修改公共契约。
- Finding 状态与证据：当前没有阻塞 Finding。
- 当前修复失败计数：0。

### Task RELEASE 验收闭包

- 单一交付目标：正式版本标签自动生成并发布完整、一致、可供更新服务消费的 Windows Release。
- 问题所有者：版本校验、Electron Builder 配置、发行脚本和 GitHub Actions。
- 输入与前置条件：`vX.Y.Z` 标签、匹配的包版本、可复现的 pnpm 锁文件和 GitHub Actions 权限。
- 业务不变量族：标签、包版本、安装包名、清单和更新元数据一致；构建失败不发布可见的残缺正式版本；不上传产品 ZIP/解压版。
- 允许修改范围：根与 Desktop 包脚本、Electron Builder 配置、发行审计脚本、Release notes 生成脚本和 `.github/workflows`。
- 禁止修改或必须移交的范围：产品业务逻辑和无关 CI。
- 可观察验收证据：版本门禁测试、发行脚本测试、本地 Windows 发行构建、产物审计和首个真实标签工作流结果。
- 独立回滚边界：删除发布工作流和恢复原打包目标后，本地开发构建不受影响。
- 前置依赖、并行条件与共享写入：为 UPDATE 提供资产和元数据；与 UPDATE 共享 `latest.json` Schema，必须串行确定。
- Finding 状态与证据：GitNest 当前没有 `.github` 工作流，且发行审计明确拒绝自动更新元数据；属于本 Task 的已确认缺口。
- 当前修复失败计数：0。

### Task VERSION-UI 验收闭包

- 单一交付目标：顶部“帮助 → 版本”打开可访问的版本弹窗，并准确展示和操作更新状态。
- 问题所有者：Renderer 版本控制器、标题栏入口和版本弹窗。
- 输入与前置条件：运行时版本和 Main 更新状态。
- 业务不变量族：版本来自 `app.getVersion()`；自动提醒每版本一次；手动入口始终可用；重复打开、关闭和状态更新稳定。
- 允许修改范围：标题栏、App 接线、版本弹窗、相关样式和现有测试文件。
- 禁止修改或必须移交的范围：其他导航、Workspace 选择和 Git 操作界面。
- 可观察验收证据：菜单、弹窗、状态切换、焦点管理、提醒确认和错误展示测试；打包界面人工检查。
- 独立回滚边界：移除菜单入口、弹窗和 Renderer 控制器，不影响后台更新服务。
- 前置依赖、并行条件与共享写入：依赖 UPDATE DTO；不允许独立修改同一公共 IPC 契约。
- Finding 状态与证据：现有版本菜单项为禁用文本；属于本 Task 的已确认缺口。
- 当前修复失败计数：0。

## 已确认的产品决策

- 采用“自动检查、用户确认后下载安装”，不后台自动下载，不强制更新。
- 正式发布由推送 `vX.Y.Z` 标签触发。
- 只接收正式版本，不接收草稿、`alpha`、`beta` 或 `rc`。
- 每个版本号只自动提醒一次。
- 自动提醒弹窗成功显示后立即记录；关闭、稍后或下载失败都不会让同版本再次自动弹出。
- “帮助 → 版本”始终可手动打开；手动查看不受自动提醒次数限制。
- 采用 CodexPlusPlus 的自建更新模式：静态 `latest.json`、平台资产选择、下载安装器并启动。
- Windows 代码签名证书不作为首期前置条件。
- 保留 GitNest 已有的可选签名能力；配置签名证书时，发行审计继续要求 Authenticode 状态有效。
- 在 CodexPlusPlus 方案基础上复用 GitNest 已有 SHA-256 能力，下载安装器前必须校验大小和 SHA-256。
- 正式产品产物只保留 NSIS 安装包和 Portable，不再生成或上传 GitNest ZIP/解压版。
- GitHub 自动附带的 Source code ZIP/TAR 不属于 GitNest 产品解压版，无法也无需从 Release 中移除。
- 首期只支持 Windows x64，不增加 macOS、Linux 或 ARM64 发布。

## 当前状态

### 现有发行能力

GitNest 当前：

- `apps/desktop/package.json` 和根 `package.json` 的版本均为 `0.0.1`。
- `apps/desktop/electron-builder.yml` 同时构建 NSIS、Portable 和 ZIP。
- `scripts/build-windows-release.mjs` 执行 Desktop 构建、Electron Builder 和发行审计。
- `scripts/audit-windows-release.mjs` 生成 `SHA256SUMS.txt` 和 `release-manifest.json`。
- 发行审计当前明确拒绝任何自动更新清单，并将 `autoUpdateEnabled` 写为 `false`。
- `scripts/gn-m3-03-package-smoke.mjs` 已覆盖旧版本安装、覆盖升级、用户数据保留、快捷方式和卸载。
- 仓库当前没有 `.github` 目录和 GitHub Actions 工作流。

### 现有版本界面

`AppTitlebar` 已显示：

- 左上角版本标签；
- “帮助”菜单；
- 禁用的“版本 vX.Y.Z”菜单项。

版本来自 Main 进程的 `app.getVersion()`，通过 `RuntimeInfo` 传到 Renderer。这一来源继续作为运行时唯一可信版本。

### CodexPlusPlus 参考行为

CodexPlusPlus 当前：

- 正式标签或手动输入标签触发 Release Assets 工作流。
- 构建 Windows 安装包并上传 GitHub Release。
- 生成静态 `latest.json`。
- 应用从 `releases/latest/download/latest.json` 检查版本。
- 用户确认后下载并启动安装器。
- Windows 安装包没有强制代码签名，也没有更新包 SHA-256 校验。

GitNest沿用其发布和更新数据流，但保留自身已有发行审计，并增加安装包哈希校验。

## 非目标

- 不自动修改或递增版本号。
- 不在 `main` 每次提交后发布正式版本。
- 不支持预发布更新通道。
- 不后台自动下载、不静默安装、不强制重启。
- 不实现差分更新或 blockmap。
- 不引入 `electron-updater`。
- 不更新 Portable 当前可执行文件。
- 不提供产品 ZIP/解压版。
- 不增加用户可配置的更新源。
- 不允许 Renderer 传入任意下载 URL、安装器路径或 Release 数据。
- 不改变 Workspace、Repository、Worktree、账户或代码分析数据模型。
- 不把启动自动检查失败显示为全局错误 Toast。

## 考虑过的方案

### 方案一：自建 `latest.json` 更新服务

Main 进程获取并验证静态清单，下载 NSIS 安装包，校验后启动。

优点：

- 与 CodexPlusPlus 的已验证模式一致。
- 能复用 GitNest 当前打包、升级和 SHA-256 审计。
- 不依赖 Electron Builder 的发布提供器和 blockmap。
- Portable 与安装版行为可以明确分离。

缺点：

- 需要自行维护状态机、下载进度、持久化和清理。
- 不提供差分更新。

这是选定方案。

### 方案二：使用 `electron-updater`

使用 Electron Builder 的 Generic/GitHub provider 和 `latest.yml`。

优点是 NSIS 更新集成更深，支持框架管理下载和安装。缺点是需要引入运行时依赖、更新元数据、blockmap 和新的打包审计边界，并与当前“无运行时 dependencies”的发行约束冲突。

### 方案三：只跳转 GitHub Release

不下载安装器，只在发现新版后打开浏览器。

该方案无法满足安装版应用内下载安装要求，仅作为 Portable 的降级行为保留。

## 术语

### 自动检查

已打包应用启动后，由 Main 进程主动获取 `latest.json`。自动检查不等于自动下载或安装。

### 自动提醒

自动检查发现未提醒过的新版本后，Renderer 自动打开版本弹窗。一个规范化版本号最多自动提醒一次。

### 手动检查

用户在版本弹窗中点击“检查更新”。手动检查忽略自动提醒记录，并把网络或清单错误显示在弹窗中。

### 安装版

通过正式 NSIS 安装包安装并启动的 GitNest。已打包且不存在 Electron Builder Portable 环境标记时，按安装版能力处理。

### Portable

由 Electron Builder Portable 目标启动的 GitNest。通过 `PORTABLE_EXECUTABLE_FILE` 或 `PORTABLE_EXECUTABLE_DIR` 环境标记识别。

### 正式版本

严格匹配 `X.Y.Z` 或标签 `vX.Y.Z` 的三段十进制版本，不包含任何前缀以外文本或预发布后缀。

## 版本来源与一致性

### 版本来源

- `apps/desktop/package.json` 是打包应用版本的唯一来源。
- `app.getVersion()` 是运行时版本的唯一来源。
- 根 `package.json` 继续保留相同版本，用于仓库级命令和发布校验。
- Git 标签只表达发布意图，不覆盖包版本。

### 发布门禁

发布工作流必须验证：

```text
tag == v${apps/desktop/package.json.version}
root package version == desktop package version
version matches X.Y.Z
```

任一条件不成立时，在安装依赖和构建之前失败。

不自动修改版本文件，避免标签已经创建后再产生未提交版本变更。

## Release 产物

正式 Release 上传：

```text
GitNest-Setup-X.Y.Z-x64.exe
GitNest-Portable-X.Y.Z-x64.exe
SHA256SUMS.txt
release-manifest.json
latest.json
```

不再生成：

```text
GitNest-X.Y.Z-x64.zip
```

`win-unpacked` 继续作为 Electron Builder 中间产物和本地打包审计对象，不上传到 GitHub Release。

## `latest.json` Schema

`latest.json` 使用固定 Schema：

```json
{
  "schemaVersion": 1,
  "product": "GitNest",
  "version": "1.1.0",
  "tag": "v1.1.0",
  "releaseUrl": "https://github.com/junxin367/GitNest/releases/tag/v1.1.0",
  "publishedAt": "2026-09-22T00:00:00.000Z",
  "notes": "版本更新说明",
  "asset": {
    "kind": "nsis",
    "platform": "win32",
    "architecture": "x64",
    "name": "GitNest-Setup-1.1.0-x64.exe",
    "downloadUrl": "https://github.com/junxin367/GitNest/releases/download/v1.1.0/GitNest-Setup-1.1.0-x64.exe",
    "sizeBytes": 12345678,
    "sha256": "64位大写十六进制摘要"
  }
}
```

验证规则：

1. JSON 正文最大 1 MiB。
2. `schemaVersion` 必须为 `1`。
3. `product` 必须为 `GitNest`。
4. `version` 必须是正式三段版本。
5. `tag` 必须等于 `v${version}`。
6. `releaseUrl` 必须是 `https://github.com/junxin367/GitNest/releases/tag/${tag}`。
7. `asset.kind/platform/architecture` 必须是 `nsis/win32/x64`。
8. 文件名必须是 `GitNest-Setup-${version}-x64.exe`。
9. 下载地址必须是同一仓库、同一标签和同一文件名的 HTTPS Release 地址。
10. `sizeBytes` 必须是正安全整数，并且不超过 512 MiB。
11. `sha256` 必须是 64 位十六进制字符串。
12. `notes` 最大 32 KiB，超出时拒绝清单，不静默截断。

Renderer 不接收也不回传未经 Main 验证的原始 JSON。

## GitHub Actions

### `ci.yml`

触发条件：

- Pull Request；
- 推送到 `main`；
- 手动触发。

执行：

1. Checkout。
2. Setup Node.js 22。
3. 启用项目声明的 pnpm 版本。
4. `pnpm install --frozen-lockfile`。
5. `pnpm check:architecture`。
6. `pnpm typecheck`。
7. `pnpm test`。
8. `pnpm build`。

CI 不生成正式安装包、不创建 Release、不修改版本。

### `release.yml`

触发条件：

- 推送 `v*` 标签；
- `workflow_dispatch` 输入一个已存在标签，用于重跑失败发布。

安全与并发：

- 使用 `concurrency: release-${tag}`。
- 不取消正在执行的同标签发布。
- 默认权限为 `contents: read`。
- 只有发布 Job 使用 `contents: write`。
- Checkout 必须固定到解析后的标签，而不是未验证分支。

Jobs：

#### `validate`

- 解析和验证正式标签。
- 读取根与 Desktop 包版本。
- 输出规范化版本和标签。

#### `windows-build`

- Checkout 已验证标签。
- 安装冻结依赖。
- 执行架构、类型、测试和构建检查。
- 执行 `pnpm dist:win`。
- 断言只有 NSIS、Portable、校验和、发行清单和 `win-unpacked` 中间目录。
- 将待发布文件作为 GitHub Actions Artifact 上传给发布 Job。

#### `publish`

只在 `validate` 和 `windows-build` 成功后运行。

新 Release：

1. 先创建 Draft Release。
2. 优先读取 `.github/release-notes/X.Y.Z.md`；不存在时生成基础说明。
3. 上传 NSIS、Portable、`SHA256SUMS.txt` 和 `release-manifest.json`。
4. 基于已上传安装包信息生成 `latest.json`。
5. 最后上传 `latest.json`。
6. 所有上传完成后将 Draft 发布为正式且设为 Latest。

重跑已有 Release：

- 保留现有人工维护的正文。
- 使用 `--clobber` 覆盖同名资产。
- 先覆盖版本资产，最后覆盖 `latest.json`，让更新入口最后切换。
- 不把正式版本改为预发布。

发布失败时：

- 新建 Draft 保持不可见。
- 已存在 Release 保持可访问；旧 `latest.json` 在新资产全部准备完成前不被覆盖。

### Release notes

新增 Release notes 生成脚本：

- 如果 `.github/release-notes/X.Y.Z.md` 存在，完整使用该文件。
- 否则读取上一个正式标签到当前标签之间的提交标题，生成基础列表。
- 不调用外部 AI，不依赖额外密钥。
- 已存在 Release 的人工正文不被自动生成内容覆盖。

## 发行脚本与审计调整

### Electron Builder

`apps/desktop/electron-builder.yml`：

- Windows target 只保留 `nsis` 和 `portable`。
- 保持 x64。
- 保持当前交互式 NSIS、用户级安装、安装目录选择、快捷方式和保留用户数据行为。
- `publish` 继续由 GitHub Actions 显式管理，不配置 Electron Builder 自动发布。
- 保持 `forceCodeSigning: false`，允许无证书构建。

### `build-windows-release.mjs`

- 继续在构建前清理受控的 `release` 目录。
- 继续使用已验证 Electron distribution。
- 只生成 NSIS 和 Portable。
- 发行审计通过后调用共享 `generate-update-manifest.mjs`，生成可供本地校验的 `latest.json`。

### `generate-update-manifest.mjs`

- 同时供本地发行构建和 GitHub 发布 Job 使用。
- 从 Desktop 包版本、`release-manifest.json` 和实际 NSIS 文件读取版本、名称、大小和 SHA-256。
- 本地构建使用标准标签和 Release URL；优先读取 `.github/release-notes/X.Y.Z.md`，否则从最近提交生成有界更新说明。
- GitHub 发布 Job 传入最终标签、Release URL、发布时间和已确定的 Release notes，覆盖本地生成的 `latest.json`。
- 生成后立即按本设计的完整 Schema 重新解析和验证，避免生成器与运行时验证规则漂移。

### `audit-windows-release.mjs`

- 删除 ZIP 必需产物断言。
- 不再拒绝更新元数据。
- `release-manifest.json` 中 `autoUpdateEnabled` 改为 `true`。
- 保留 ASAR、CSP、源码映射、测试内容、开发服务和签名检查。
- 保留 NSIS、Portable 和 `win-unpacked/GitNest.exe` 的大小与 SHA-256。
- 增加安装包文件名和正式版本格式断言。
- 校验共享生成脚本输出的 `latest.json` 与安装包名称、版本、大小和 SHA-256 一致。

### 本地打包冒烟

现有 GN-M3-03：

- 移除 ZIP 启动场景。
- 保留 `win-unpacked`、Portable、旧安装版和当前安装版启动。
- 保留旧版本覆盖升级、用户数据保留、快捷方式和卸载验证。
- 增加版本弹窗在打包应用中的基础渲染验证。
- 冒烟启动通过受控环境变量禁用真实联网自动检查，避免测试污染正式更新状态。

## 更新服务

在 Main 进程新增单一 `ApplicationUpdateService`。该服务不放入 Workspace Runtime，不依赖当前 Workspace。

职责：

- 读取当前版本和发行类型。
- 获取并验证 `latest.json`。
- 比较正式版本。
- 管理提醒状态。
- 管理唯一检查任务和唯一下载任务。
- 发布受控的更新状态。
- 下载、校验、缓存和启动安装器。
- 打开可信 Release 页面。
- 输出脱敏诊断。

概念接口：

```ts
interface ApplicationUpdateService {
  getState(): Promise<ApplicationUpdateStateDto>;
  check(
    source: "startup" | "manual"
  ): Promise<ApplicationUpdateStateDto>;
  acknowledgePrompt(
    version: string
  ): Promise<ApplicationUpdateStateDto>;
  downloadAndInstall(): Promise<ApplicationUpdateStateDto>;
  openReleasePage(): Promise<void>;
  onStateChanged(
    listener: (state: ApplicationUpdateStateDto) => void
  ): () => void;
  dispose(): Promise<void>;
}
```

Renderer 的“下载安装”请求不携带 URL、文件名、哈希或路径。服务只使用自身最近一次验证通过并仍与当前状态匹配的 Release。

## 更新状态模型

```ts
type ApplicationDistribution =
  | "development"
  | "installed"
  | "portable";

type ApplicationUpdatePhase =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "verifying"
  | "launching"
  | "error";

interface ApplicationUpdateStateDto {
  currentVersion: string;
  distribution: ApplicationDistribution;
  phase: ApplicationUpdatePhase;
  checkedAt: string | null;
  latestVersion: string | null;
  releaseUrl: string | null;
  releaseNotes: string;
  updateAvailable: boolean;
  promptPending: boolean;
  installSupported: boolean;
  downloadedBytes: number;
  totalBytes: number | null;
  errorCode: string | null;
  errorMessage: string | null;
}
```

状态由 Main 进程拥有。Renderer 只能读取、订阅和发出无数据或最小数据命令。

`errorMessage` 只包含用户可理解的稳定信息，不包含本地绝对路径、响应正文或内部堆栈。

## 发行类型识别

```text
!app.isPackaged → development
存在 PORTABLE_EXECUTABLE_FILE 或 PORTABLE_EXECUTABLE_DIR → portable
其他已打包 Windows x64 → installed
```

由于正式产品只发布 NSIS 和 Portable，以上识别覆盖公开分发形态。

`win-unpacked` 只用于内部审计，不作为公开产品。其行为按 installed 处理，但打包冒烟不发起真实更新。

## 更新持久化

数据注册表增加：

```text
<userData>/updates/state.json
<userData>/updates/downloads/
```

### `state.json`

使用现有 `AtomicJsonStore`，Schema：

```json
{
  "schemaVersion": 1,
  "remindedVersions": ["1.1.0"],
  "lastSuccessfulCheckAt": "2026-09-22T00:00:00.000Z"
}
```

规则：

- `remindedVersions` 只保存规范化正式版本。
- 最多保留最近 20 个版本。
- 成功展示包含新版本信息的弹窗后，由 Renderer 调用 `acknowledgePrompt(version)`。
- 服务确认该版本仍是当前已验证可用版本后才写入。
- 自动弹窗关闭、稍后、下载失败或应用重启都不删除记录。
- 手动打开弹窗并实际展示该新版本，也执行同一确认。
- 状态文件无效时记录诊断并抑制自动弹窗，避免每次启动重复骚扰；手动检查仍可用。

### 下载缓存

更新下载目录登记为可重建的有界 cache：

- 最大年龄 14 天。
- 最大总量 512 MiB。
- 下载使用 `.partial` 临时文件。
- 大小和 SHA-256 均通过后原子重命名为正式安装包名。
- 启动时删除超期文件和中断的 `.partial`。
- 只允许服务生成的标准安装包文件名。

## 自动检查流程

1. Main 完成应用启动和主窗口创建。
2. 已打包应用延迟 10 秒发起一次 `startup` 检查。
3. 开发环境不自动检查。
4. 每次应用进程生命周期只自动检查一次，不设置周期 timer。
5. 同时存在手动检查时复用同一个 Promise，不发送重复请求。
6. 获取 `https://github.com/junxin367/GitNest/releases/latest/download/latest.json`。
7. 使用超时和正文大小限制读取。
8. 验证 Schema、仓库、版本、平台、架构、文件名、URL、大小和 SHA-256。
9. 候选版本不高于当前版本时发布 `up-to-date`。
10. 候选版本更高且未提醒时发布 `available + promptPending`。
11. 候选版本更高但已提醒时发布 `available + !promptPending`，不自动打开弹窗。
12. 自动检查失败只写诊断并恢复可操作状态，不主动打开错误弹窗。

当前进程没有固定的 24 小时节流。用户要求的是每版本只提醒一次，而不是减少检查次数；每次启动检查可以及时发现新版本，同时不会对同版本重复提醒。

## 手动检查流程

1. 用户打开“帮助 → 版本”。
2. 弹窗先显示 Main 当前缓存状态。
3. 用户点击“检查更新”。
4. 服务执行或复用检查任务。
5. 成功后更新弹窗。
6. 失败时进入 `error`，显示稳定错误和“重试”。
7. 手动检查不会清除已提醒记录，也不会自动下载。

## 自动提醒确认流程

1. Main 发布 `promptPending: true`。
2. App 控制器打开版本弹窗。
3. 弹窗完成挂载且展示对应版本。
4. Renderer 调用 `acknowledgePrompt(version)`。
5. Main 验证版本仍等于当前可用版本。
6. Main 原子写入 `remindedVersions` 并将 `promptPending` 设为 `false`。

如果应用在弹窗展示前退出或 Renderer 未完成确认，下次启动仍可以提醒该版本。这保证“成功提醒后才去重”。

## 下载、校验和安装流程

仅 `distribution === "installed"` 且状态存在验证通过的新版本时允许执行：

1. 用户点击“下载并安装”。
2. Main 复用或创建唯一下载任务。
3. 下载到 `updates/downloads/.GitNest-Setup-X.Y.Z-x64.exe.<random>.partial`。
4. 流式统计字节数并计算 SHA-256。
5. 下载字节数超过清单大小或 512 MiB 时立即失败并删除临时文件。
6. 完成后要求实际大小等于 `sizeBytes`。
7. 要求实际 SHA-256 等于清单值。
8. 校验成功后原子重命名为标准文件名。
9. 启动交互式 NSIS 安装器。
10. 安装器进程成功创建后，GitNest 进入正常退出流程。
11. 安装器启动失败时不退出 GitNest，并显示错误。

不使用静默安装参数。现有 NSIS 交互式页面、安装目录和快捷方式行为保持不变。

Portable 的主按钮为“前往 GitHub Release”，调用 Main 的受控外部链接打开逻辑。Renderer 不直接调用任意 URL。

## IPC 与 Preload

新增受控通道：

```text
update:get-state
update:check
update:acknowledge-prompt
update:download-and-install
update:open-release-page
update:state-changed
```

Bridge：

```ts
update: {
  getState(): Promise<GitReadResult<ApplicationUpdateStateDto>>;
  check(): Promise<GitReadResult<ApplicationUpdateStateDto>>;
  acknowledgePrompt(
    request: AcknowledgeUpdatePromptRequest
  ): Promise<GitReadResult<ApplicationUpdateStateDto>>;
  downloadAndInstall(): Promise<
    GitReadResult<ApplicationUpdateStateDto>
  >;
  openReleasePage(): Promise<GitReadResult<void>>;
  onStateChanged(
    listener: (state: ApplicationUpdateStateDto) => void
  ): () => void;
}
```

Main 必须继续执行现有可信 Sender 校验。请求验证拒绝未知字段、非法版本和非对象输入。

## Renderer

### 标题栏入口

现有禁用菜单项改为可点击：

```text
版本 vX.Y.Z
```

点击后：

- 关闭帮助菜单。
- 打开版本弹窗。
- 不自动发起下载。

### 版本弹窗

弹窗复用现有 `command-dialog-backdrop`、按钮、图标和 `useModalFocusTrap`，不引入新的弹窗系统。

固定内容：

- GitNest 名称和图标。
- 当前版本。
- 发行类型：安装版、Portable 或开发版本。
- 最新版本。
- 最近检查时间。
- 更新说明。
- 当前状态或错误。

操作：

| 状态 | 主操作 | 次操作 |
| --- | --- | --- |
| 未检查 | 检查更新 | 关闭 |
| 检查中 | 检查中，禁用 | 关闭 |
| 已是最新版 | 再次检查 | 关闭 |
| 安装版有更新 | 下载并安装 | 稍后 |
| Portable 有更新 | 前往 GitHub Release | 关闭 |
| 下载中 | 显示字节进度，禁用重复操作 | 关闭弹窗但后台任务继续 |
| 校验中 | 校验中，禁用 | 关闭 |
| 启动安装器 | 正在启动，禁用 | 无 |
| 错误 | 重试对应动作 | 关闭 |
| 开发版本 | 手动检查 | 关闭 |

弹窗允许 Escape 和关闭按钮关闭，但安装器已经启动并进入退出流程后不再接受关闭操作。

Release notes 作为纯文本展示，不渲染远端 HTML，不使用 `dangerouslySetInnerHTML`。

### App 控制器

Renderer 增加独立更新控制器：

- App 启动时先订阅事件再获取当前状态，避免丢失启动检查结果。
- 自动 `promptPending` 只打开版本弹窗，不显示额外 Toast。
- 组件卸载时取消订阅。
- 迟到的旧请求结果不得覆盖更新的事件状态；以 Main 发布状态为准。

## 并发与状态一致性

- 检查任务最多一个。
- 下载任务最多一个。
- 下载期间的检查返回当前下载状态，不替换已验证 Release。
- 同一下载按钮重复点击复用当前任务。
- 新检查发现更高版本时，只有在没有下载任务时才能替换缓存 Release。
- 启动检查和手动检查共享同一内部队列。
- `dispose()` 中止网络请求、关闭临时文件并停止发布事件。
- 安装器成功启动后禁止创建新的检查或下载任务。

## 网络与安全

- 只使用 HTTPS。
- `latest.json` 地址固定在 `junxin367/GitNest`。
- 清单中的 Release 和资产地址必须匹配固定仓库、标签和标准文件名。
- Renderer 不能指定网络地址或磁盘路径。
- 下载设置连接与整体超时，并支持应用退出时取消。
- 清单限制 1 MiB，安装包限制 512 MiB。
- 安装包大小和 SHA-256 必须同时匹配。
- 下载文件使用受控目录、受控文件名和原子重命名。
- 更新说明只按纯文本显示。
- 诊断不记录清单正文、Release notes、本地更新目录或完整下载 URL。
- 未签名安装包可能触发 Windows SmartScreen；版本弹窗不承诺“已验证发布者”。
- 如果未来配置签名证书，现有发行审计自动要求签名有效，不改变更新协议。

## 错误处理

### 自动检查

- 网络不可用：记录 warning，不弹窗。
- GitHub 返回非成功状态：记录稳定错误码，不弹窗。
- 清单超限或格式错误：拒绝使用，不保留部分 Release。
- 版本非法或不是更高版本：非法版本报错；不更高版本视为最新版。
- 提醒状态持久化失败：保留弹窗，但在当前进程内去重；下次启动为避免重复骚扰，抑制自动提示并要求手动检查。

### 手动检查

- 所有失败在弹窗内显示。
- 保留上一次成功验证的版本信息，但明确标记本次检查失败。
- “重试”只重试检查，不自动进入下载。

### 下载与安装

- 下载中断：删除 `.partial`。
- 大小不一致：删除下载文件，错误码 `UPDATE_SIZE_MISMATCH`。
- 哈希不一致：删除下载文件，错误码 `UPDATE_CHECKSUM_MISMATCH`。
- 安装器启动失败：保留已验证安装包用于重试，不退出应用。
- GitNest 正常退出失败：安装器已经启动时由现有 NSIS 安装过程处理进程；诊断记录退出异常。

任何更新错误都不得改变 Workspace、Snapshot、操作历史、设置或账户数据。

## 诊断

使用现有 Diagnostic Logger，记录：

- 检查来源：startup/manual。
- 当前版本和候选版本。
- 检查成功、最新版、发现更新或失败。
- 发行类型。
- 下载开始、完成字节数、校验成功或失败。
- 安装器启动成功或失败。
- 自动提醒是否因已提醒版本被抑制。

不记录：

- 完整绝对路径。
- 完整远端响应。
- Release notes。
- 用户仓库信息。
- URL 查询参数。

## 测试设计

本任务优先扩展现有测试文件，避免创建只服务本次任务的临时测试文件。若新模块确实需要独立测试文件，实施结束前必须按项目规则取得用户对长期保留的明确确认，否则删除该新测试文件。

### 契约与 IPC

扩展现有：

- `packages/contracts` 的契约类型检查。
- `apps/desktop/src/preload/bridge.test.ts`。
- `apps/desktop/src/main/ipc/register-ipc.test.ts`。

覆盖：

- 所有更新命令和事件桥接。
- Renderer 不能传入 URL 或路径。
- `acknowledgePrompt` 只接受正式版本对象。
- 事件只广播到存活且可信的 BrowserWindow。

### 更新服务

覆盖：

- 正式版本解析和比较。
- 拒绝预发布、降级和相同版本。
- 清单 Schema、仓库、资产、大小和 SHA-256 验证。
- installed、portable、development 识别。
- 每进程只自动检查一次。
- 同一检查任务并发复用。
- 每版本自动提醒一次。
- 弹窗确认后原子持久化提醒记录。
- 无效提醒状态抑制自动重复提示。
- 手动检查始终可执行。
- 下载进度、大小上限、哈希校验、临时文件清理和原子重命名。
- 安装器启动成功后退出，启动失败时保持运行。
- dispose 取消网络和清理未完成下载。

测试使用依赖注入的 Fetch、时钟、文件系统边界和安装器启动器，不访问真实 GitHub。

### Renderer

优先扩展已有 App/标题栏或相邻现有测试：

- 版本菜单项可点击。
- 手动打开弹窗。
- 自动 `promptPending` 打开一次弹窗并确认版本。
- 同版本后续状态事件不重复打开。
- 最新版、有更新、Portable、下载、校验、启动和错误状态。
- Release notes 按纯文本显示。
- 焦点陷阱、Escape 和按钮禁用。
- 迟到响应不覆盖新状态。

### 发行脚本与工作流

覆盖：

- 标签、根版本和 Desktop 版本一致性。
- 拒绝预发布标签。
- Electron Builder 不再包含 ZIP target。
- 发行审计只要求 NSIS 和 Portable。
- `release-manifest.json` 标记自动更新启用。
- `latest.json` 与安装包名称、大小和 SHA-256 一致。
- 工作流在构建成功后才发布。
- 新 Release 使用 Draft 后发布。
- 重跑保留人工 Release notes，并最后覆盖 `latest.json`。

### 本地验证

- 定向 Vitest。
- `pnpm check:architecture`。
- 根 `pnpm typecheck`。
- 根 `pnpm test`，仅在相关局部测试稳定后执行一次。
- `pnpm build`。
- `pnpm dist:win`。
- `pnpm audit:win`。
- GN-M3-03 Windows 包冒烟，移除 ZIP 场景后验证 NSIS、Portable、升级、数据保留和卸载。
- `git diff --check`。

### 真实发布验收

本地实现完成不等于 GitHub 自动发布已经端到端通过。

首个真实正式标签还需要验证：

1. GitHub Actions 所有 Jobs 成功。
2. Release 只包含预期 GitNest 产品资产和 GitHub 自动源码归档。
3. `releases/latest/download/latest.json` 可访问。
4. 安装版旧版本能够发现新版本。
5. 同版本只自动提醒一次。
6. 下载进度、大小和 SHA-256 校验成功。
7. 启动安装器后完成覆盖升级。
8. Workspace 与用户数据保持不变。

在真实标签验证前，交付状态只能写为“代码和本地打包验收通过，线上发布链路待首个标签验证”，不能写成“自动发布全部完成”。

## 验收标准

1. “帮助 → 版本”是可点击入口，打开可访问的版本弹窗。
2. 弹窗版本与 `app.getVersion()` 一致。
3. 开发环境不自动检查。
4. 已打包应用每个进程启动 10 秒后最多执行一次自动检查。
5. 只接受 `junxin367/GitNest` 的更高正式版本。
6. 每个新版本成功展示自动弹窗后只提醒一次。
7. 手动入口始终能重新检查和查看更新。
8. 自动检查失败不打断启动、不弹全局错误。
9. NSIS 安装版能够下载、校验并启动交互式安装器。
10. 大小或 SHA-256 不一致时绝不启动文件。
11. Portable 不下载或覆盖自身，只打开可信 Release。
12. Renderer 不能控制更新 URL、下载路径或安装器参数。
13. 同一时刻最多一个检查任务和一个下载任务。
14. 退出时更新网络和临时文件得到清理。
15. Git 标签与两个包版本不一致时，发布在构建前失败。
16. 正式发布只上传 NSIS、Portable、校验和、发行清单和 `latest.json`。
17. 不再生成 GitNest 产品 ZIP/解压版。
18. Release 在完整资产准备成功前保持 Draft 或不存在。
19. `latest.json` 最后上传，并与安装包名称、大小、版本和 SHA-256 一致。
20. 现有升级保留用户数据、快捷方式和卸载行为继续通过。
21. 更新功能不修改 Workspace、Repository、Worktree 或用户仓库文件。
22. 本地测试、类型检查、生产构建、发行审计、包冒烟和差异检查通过。

## 回滚边界

### UPDATE

可整体移除：

- 更新 DTO、IPC 和事件。
- `ApplicationUpdateService`。
- 更新状态和下载缓存路径。
- 启动自动检查。

移除后现有 GitNest 业务功能继续运行，遗留的 `updates` cache 可以安全删除或忽略。

### VERSION-UI

可恢复为禁用的版本文本，并移除版本弹窗和 Renderer 控制器，不影响后台业务。

### RELEASE

可删除 GitHub Actions 和更新清单生成，并把 Electron Builder 恢复为原有目标。已发布 Release 资产不由代码回滚自动删除。

回滚不得删除用户 Workspace、Snapshot、操作历史、设置、账户或仓库数据。
