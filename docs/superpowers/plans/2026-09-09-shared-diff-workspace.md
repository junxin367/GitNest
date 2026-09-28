# Shared Diff Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan inline. Do not create subagents, worktrees, or commits for this repository task.

**Goal:** Make the repository page and standalone Diff window consume one complete, capability-configured `DiffWorkspace` component.

**Architecture:** `DiffWorkspace` owns all file-navigation markup and transient navigation state. Repository and standalone consumers provide normalized files, controlled selection, asynchronous Diff state, and Git callbacks; optional commit, refresh, status-bar, context-menu, standalone-open, and document-toolbar capabilities are enabled through typed configuration.

**Tech Stack:** React 19, TypeScript, Vitest/jsdom, Electron renderer, CSS

**Spec:** `docs/superpowers/specs/2026-09-09-shared-diff-workspace-design.md`

## Global Constraints

- The repository and standalone Diff entry points must use the same public React workspace component.
- `window.gitnest`, repository queries, cancellation, and Git mutations remain in consumers.
- The standalone titlebar remains outside the shared component.
- Existing staging, unstaging, commit, and push semantics must not change.
- The repository standalone-open action and commit region are configuration-controlled.
- The standalone document toolbar is configuration-controlled.
- Preserve an already displayed same-file Diff during background refresh.
- Do not create a worktree.
- Do not create a commit or push.
- Do not retain a newly created temporary test file without explicit user approval; extend existing durable tests instead.

## Superpowers 治理契约

- 适用性判定：治理
- 状态：已完成
- 任务等级：复杂高风险
- 当前已生效的上位约束：中文沟通；保留脏工作区；使用 `apply_patch` 编辑；不使用子代理；不创建 worktree；不 commit/push；临时测试默认清理。
- 用户明确指定：两个 Diff 功能合并为一个组件；仓库提交区、仓库独立窗口按钮、独立窗口文档工具栏均由配置控制；设计后直接开发。
- 允许或必须使用的 Superpowers Skill：brainstorming、writing-plans、executing-plans、test-driven-development、verification-before-completion。
- 禁用或裁剪的通用默认步骤：禁用 worktree、commit、push、逐 Step Review、子代理执行和重复全量验证。
- 开发期反馈：仅运行受影响的现有 Vitest 文件和 TypeScript 检查。
- 交付单元验收：每个 Task 在目标代码状态运行其列出的定向测试或静态检查。
- 最终集成验证：运行共享组件/独立窗口定向测试、桌面 typecheck、桌面 build、`git diff --check`，并检查两种原型配置。
- Review 检查点：完成共享公共契约与两个入口迁移后进行一次整体差异审查；确认 Finding 后批量修复并只做一次受影响范围复查。
- 可复用证据：未受代码变化影响的既有 DiffPanel 测试不重复运行；相同代码状态下成功的命令结果直接复用。
- Worktree：禁止
- Commit：禁止

### Task 1 验收闭包

- 单一交付目标：形成能够独立渲染完整文件导航和 Diff 文档的公共 `DiffWorkspace` 契约。
- 问题所有者：Task 1
- 输入与前置条件：现有 `DiffPanel`、`DiffViewerFile`、`changeTree`、共享 Button/Input/Menu 组件。
- 业务不变量族：文件分组、筛选、树/列表、选择、暂存动作和能力开关由同一公共组件维护；两个消费者不再提供 sidebar JSX。
- 允许修改范围：`widgets/diff-workspace/**`、`shared/model/diffViewModel.ts`、共享 workspace 样式入口、现有 `DiffWorkspace.test.tsx`。
- 禁止修改或必须移交的范围：IPC、Git 服务、页面查询逻辑、外部应用启动逻辑。
- 可观察验收证据：现有 `DiffWorkspace.test.tsx` 覆盖两种配置并通过；TypeScript 无公共接口错误。
- 独立回滚边界：共享组件目录、模型可选统计字段和样式导入。
- 前置依赖、并行条件与共享写入：无前置；Task 2 和 Task 3 依赖本 Task 的接口，不能并行写共享组件。
- Finding 状态与证据：当前 Finding 已确认——`DiffWorkspace` 仅接受 `sidebar: ReactNode`，两个页面仍重复导航状态与 markup。
- 当前修复失败计数：0

### Task 2 验收闭包

- 单一交付目标：仓库页通过公共 `DiffWorkspace` 保留选择、暂存、上下文菜单、提交和独立窗口操作。
- 问题所有者：Task 2
- 输入与前置条件：Task 1 的公共 props；现有 repository controller、mutation hook、tree preference 和 external-application menu。
- 业务不变量族：仓库异步 Diff 行为和 Git 命令语义不变；共享组件取代仓库本地导航渲染。
- 允许修改范围：`RepositoryPage.tsx`、必要的现有仓库定向测试。
- 禁止修改或必须移交的范围：repository services、IPC contracts、其他仓库标签页。
- 可观察验收证据：仓库页能通过类型检查；共享测试验证仓库能力配置；现有 async Diff preservation 测试保持通过。
- 独立回滚边界：`RepositoryChanges` 到公共组件的适配层和被移出的 commit component。
- 前置依赖、并行条件与共享写入：依赖 Task 1；与 Task 3 不共享页面文件，但串行执行以稳定公共接口。
- Finding 状态与证据：当前 Finding 已确认——仓库页含独立的 filter/group/tree/row/menu 实现。
- 当前修复失败计数：0

### Task 3 验收闭包

- 单一交付目标：独立 Diff 窗口通过公共 `DiffWorkspace` 保留查询、刷新、标题栏、工具栏、状态栏和 toast。
- 问题所有者：Task 3
- 输入与前置条件：Task 1 的公共 props；现有 standalone query and mutation hooks。
- 业务不变量族：独立窗口异步查询和取消语义不变；共享组件取代本地导航渲染；工具栏配置保持启用。
- 允许修改范围：`pages/diff-viewer/DiffViewerApp.tsx`、`DiffViewerApp.test.tsx`、standalone 外壳样式。
- 禁止修改或必须移交的范围：Electron window creation and preload APIs。
- 可观察验收证据：`DiffViewerApp.test.tsx` 通过并证明共享 navigator、工具栏和 titlebar 同时存在。
- 独立回滚边界：standalone adapter code。
- 前置依赖、并行条件与共享写入：依赖 Task 1；Task 2 完成后执行。
- Finding 状态与证据：当前 Finding 已确认——独立窗口含第二份 filter/group/tree/row/menu 实现。
- 当前修复失败计数：0

### Task 4 验收闭包

- 单一交付目标：浏览器评审原型展示同一个原型 workspace 的 repository 与 standalone 能力配置，并修正已指出的行与分割线。
- 问题所有者：Task 4
- 输入与前置条件：现有 `GitNestDiffWorkspace`、`GitNestDiffPanel` 和 gallery fixture。
- 业务不变量族：两种展示共享同一原型组件；repository 开启 commit/open，standalone 开启 document toolbar；文件行与 standalone 参考一致。
- 允许修改范围：`prototypes/workspace-shell/diff-workspace.*`、`diff-panel.*`、`menu-gallery.html`，必要时精简 `diff-viewer.html` 的重复 workspace 内容。
- 禁止修改或必须移交的范围：产品 Git 操作和发布资源。
- 可观察验收证据：浏览器中两种配置可切换/查看，菜单、筛选、暂存草稿保持和 header separator 正常；控制台无错误。
- 独立回滚边界：prototype files only。
- 前置依赖、并行条件与共享写入：产品实现稳定后同步；不与 Task 1 并行写概念接口。
- Finding 状态与证据：已确认——gallery 的测试文件 fixture 与 standalone 参考不一致；独立原型仍保留重复 workspace implementation。
- 当前修复失败计数：0

---

### Task 1: Build the complete shared workspace contract

**Files:**

- Create: `apps/desktop/src/renderer/src/widgets/diff-workspace/DiffFileNavigator.tsx`
- Create: `apps/desktop/src/renderer/src/widgets/diff-workspace/DiffCommitComposer.tsx`
- Create: `apps/desktop/src/renderer/src/widgets/diff-workspace/diff-workspace.css`
- Modify: `apps/desktop/src/renderer/src/widgets/diff-workspace/DiffWorkspace.tsx`
- Modify: `apps/desktop/src/renderer/src/widgets/diff-workspace/diffWorkspaceConfiguration.ts`
- Modify: `apps/desktop/src/renderer/src/widgets/diff-workspace/DiffPanel.tsx`
- Modify: `apps/desktop/src/renderer/src/shared/model/diffViewModel.ts`
- Modify: `apps/desktop/src/renderer/src/main.tsx`
- Test: `apps/desktop/src/renderer/src/widgets/diff-workspace/DiffWorkspace.test.tsx`

**Interfaces:**

- Consumes: `DiffViewerFile`, `DiffPanelProps`, `buildChangeTree`, `compactChangeTreeNodes`, `Button`, `Input`, and `MenuPopover`.
- Produces:

```ts
export interface DiffWorkspaceMessage {
  icon: DiffPanelState["icon"];
  title: string;
  message: string;
}

export interface DiffWorkspaceCommit {
  subject: string;
  body: string;
  staged: number;
  conflicted: number;
  busy: boolean;
  submitting: boolean;
  onSubjectChange(value: string): void;
  onBodyChange(value: string): void;
  onSubmit(): void | Promise<void>;
}

export interface DiffWorkspaceTreePreference {
  scopeKey: string;
  initiallyCollapsed: boolean;
  onCollapsedPreferenceChange?(collapsed: boolean): void;
}

export interface DiffWorkspaceProps {
  configuration: DiffWorkspaceConfiguration;
  files: readonly DiffViewerFile[];
  selectedFileKey?: string;
  onSelectedFileChange(file: DiffViewerFile): void;
  onStageFile?(file: DiffViewerFile): void | Promise<void>;
  onUnstageFile?(file: DiffViewerFile): void | Promise<void>;
  mutationBusy?: boolean;
  changesLoading?: boolean;
  changesError?: DiffWorkspaceMessage;
  onRefresh?(): void;
  onFileContextMenu?(
    event: React.MouseEvent<HTMLDivElement>,
    file: DiffViewerFile
  ): void;
  panelProps: Omit<
    DiffPanelProps,
    "config" | "headerActions" | "path" | "scopeKey"
  >;
  openStandalone?: {
    busy: boolean;
    disabled?: boolean;
    title?: string;
    onOpen(): void | Promise<void>;
  };
  commit?: DiffWorkspaceCommit;
  statusbar?: React.ReactNode;
  treePreference?: DiffWorkspaceTreePreference;
  className?: string;
}
```

- Extend `DiffViewerFile` with optional `additions?: number` and `deletions?: number`.
- Extend `DiffDocumentFeatureConfig` with `showToolbar: boolean`.

- [x] **Step 1: Rewrite the existing workspace test around the new public contract**

Add assertions to `DiffWorkspace.test.tsx` that render repository and standalone configurations from the same component, filter files, switch to tree mode, select a file, invoke stage/unstage callbacks, hide/show the document toolbar, hide/show the open action, and hide/show the commit form.

- [x] **Step 2: Run the existing workspace test and confirm the old slot API fails**

Run:

```powershell
pnpm exec vitest run apps/desktop/src/renderer/src/widgets/diff-workspace/DiffWorkspace.test.tsx
```

Expected: failure because the current component requires `sidebar` and does not accept normalized file/navigation props.

- [x] **Step 3: Add focused internal components and implement shared navigation state**

Implement `DiffFileNavigator` with staged/unstaged/untracked grouping, filter input, list/tree mode, section collapse, compact tree directories, selected row, context-menu forwarding, optional statistics, and stage/unstage buttons. Implement `DiffCommitComposer` by moving the existing controlled repository form without changing its validation.

- [x] **Step 4: Upgrade `DiffWorkspace` and capability configuration**

Remove `sidebar`, `sidebarClassName`, `footer`, and `footerClassName` from the public contract. Compose `DiffFileNavigator`, `DiffCommitComposer`, `DiffPanel`, and optional status bar. Add `showToolbar` to the document configuration and gate open/commit/status/refresh controls on both configuration and callback data.

- [x] **Step 5: Add shared CSS and import it after page-level styles**

Move the active workspace, navigator, file row, tree, commit, and status-bar visual rules to `diff-workspace.css`. Keep consumer class names only for outer sizing and window chrome.

- [x] **Step 6: Run the shared workspace test**

Run:

```powershell
pnpm exec vitest run apps/desktop/src/renderer/src/widgets/diff-workspace/DiffWorkspace.test.tsx
```

Expected: all assertions pass.

### Task 2: Migrate the repository page

**Files:**

- Modify: `apps/desktop/src/renderer/src/pages/repository/RepositoryPage.tsx`
- Test: `apps/desktop/src/renderer/src/entities/repository/useRepositoryDetails.integration.test.tsx`

**Interfaces:**

- Consumes: `DiffWorkspaceProps`, `buildDiffViewerFiles`, repository controller selection, mutation callbacks, tree preference functions, and external-application context menu state.
- Produces: a thin `RepositoryChanges` adapter with no filter/group/tree/file-row JSX.

- [x] **Step 1: Normalize repository changes and selection**

Build `files` with `buildDiffViewerFiles(changes)` and derive the selected key as:

```ts
const selectedFileKey = controller.selectedChange
  ? `${controller.selectedChange.mode}\u0001${controller.selectedChange.path}`
  : undefined;
```

Translate selection with `controller.selectChange(file.change, file.mode)`.

- [x] **Step 2: Pass repository capabilities and callbacks**

Pass repository document config, stage/unstage callbacks, existing panel states, standalone-open action, commit state, context-menu callback, and tree preference adapter into `DiffWorkspace`.

- [x] **Step 3: Remove duplicated repository navigation and commit rendering**

Delete local filter, section, view-menu, tree-rendering, row-rendering, and `CommitComposer` JSX/helpers that are now owned by the shared package. Preserve the external-application overlay and connect it through the selected normalized file.

- [x] **Step 4: Verify asynchronous repository Diff behavior**

Run:

```powershell
pnpm exec vitest run apps/desktop/src/renderer/src/entities/repository/useRepositoryDetails.integration.test.tsx
```

Expected: same-file background refresh and selection guards remain passing.

- [x] **Step 5: Run desktop TypeScript validation**

Run:

```powershell
pnpm --filter @gitnest/desktop typecheck
```

Expected: no repository adapter or shared contract errors.

### Task 3: Migrate the standalone Diff viewer

**Files:**

- Modify: `apps/desktop/src/renderer/src/pages/diff-viewer/DiffViewerApp.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/diff-viewer/DiffViewerApp.test.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/diff-viewer/diff-viewer.css`

**Interfaces:**

- Consumes: the Task 1 public `DiffWorkspace` contract.
- Produces: a standalone adapter that owns only request parsing, queries, selected key, mutations, titlebar, document title, and toasts.

- [x] **Step 1: Update the existing standalone test to assert the shared component contract**

Keep titlebar and split/unified assertions. Add checks that the workspace uses shared navigator classes and that repository-only commit/open controls are absent.

- [x] **Step 2: Remove duplicated standalone navigation state and rendering**

Delete local filter, section grouping, view-menu refs/effects, collapsed sections, tree-node rendering, and file-row rendering. Pass files, selected key, refresh callback, mutation callbacks, errors, panel data, and status-bar content to `DiffWorkspace`.

- [x] **Step 3: Keep asynchronous selection and query cancellation in the consumer**

Retain `selectedKey`, file-list query, Diff query, document-title effect, path-copy toast, mutation feedback, and titlebar behavior. Do not reset a current Diff except when the selected key actually changes or disappears.

- [x] **Step 4: Remove obsolete standalone navigator CSS**

Keep titlebar and outer window sizing rules. Remove or leave unused only those old selectors whose deletion is safe; shared navigator markup must be styled solely by `diff-workspace.css`.

- [x] **Step 5: Run standalone and shared tests together**

Run:

```powershell
pnpm exec vitest run apps/desktop/src/renderer/src/widgets/diff-workspace/DiffWorkspace.test.tsx apps/desktop/src/renderer/src/pages/diff-viewer/DiffViewerApp.test.tsx
```

Expected: both files pass.

### Task 4: Align the browser prototype

**Files:**

- Modify: `prototypes/workspace-shell/diff-workspace.js`
- Modify: `prototypes/workspace-shell/diff-workspace.css`
- Modify: `prototypes/workspace-shell/menu-gallery.html`
- Modify if needed: `prototypes/workspace-shell/diff-viewer.html`

**Interfaces:**

- Consumes: `GitNestDiffPanel` and shared prototype file fixtures.
- Produces: repository and standalone capability presets rendered through `GitNestDiffWorkspace.create`.

- [x] **Step 1: Make prototype capabilities explicit**

Replace `showOpenStandalone`-only branching with a `features` object containing `openStandalone`, `commit`, `statusbar`, and `refresh`, while continuing to use the document config for the toolbar.

- [x] **Step 2: Match the confirmed standalone file-row structure**

Render the primary path/name and a second line containing the mode label plus optional `+N/-N` statistics. Ensure `WorkspaceStateServiceTest.java` uses the same fixture rows as the standalone reference and shows the matching calculated counts.

- [x] **Step 3: Preserve the header-action separator**

Keep `headerActions` passed through `GitNestDiffPanel`; verify its existing separator renders immediately before the external-open action.

- [x] **Step 4: Demonstrate both workspace configurations**

Add a repository/standalone preview switch or two clearly labelled mounts in the Diff gallery tab. Both must instantiate `GitNestDiffWorkspace`; do not duplicate the workspace DOM.

- [x] **Step 5: Run static checks**

Run:

```powershell
node --check prototypes/workspace-shell/diff-workspace.js
node --check prototypes/workspace-shell/diff-panel.js
```

Expected: both exit successfully.

### Task 5: Integration review and verification

**Files:**

- Review: all files changed by Tasks 1–4

**Interfaces:**

- Consumes: completed shared contract and both adapters.
- Produces: final verification evidence without commits.

- [x] **Step 1: Inspect the final diff for duplicated navigation**

Run:

```powershell
rg -n "renderChangeFileRow|renderFileRow|renderChangeTreeNodes|renderFileTreeNodes|sidebar=" apps/desktop/src/renderer/src/pages/repository/RepositoryPage.tsx apps/desktop/src/renderer/src/pages/diff-viewer/DiffViewerApp.tsx
```

Expected: no consumer-owned file-row/tree renderer and no arbitrary workspace sidebar slot.

- [x] **Step 2: Run final targeted tests**

Run:

```powershell
pnpm exec vitest run apps/desktop/src/renderer/src/widgets/diff-workspace/DiffWorkspace.test.tsx apps/desktop/src/renderer/src/pages/diff-viewer/DiffViewerApp.test.tsx apps/desktop/src/renderer/src/entities/repository/useRepositoryDetails.integration.test.tsx
```

Expected: all tests pass.

- [x] **Step 3: Run desktop typecheck and build**

Run:

```powershell
pnpm --filter @gitnest/desktop typecheck
pnpm --filter @gitnest/desktop build
```

Expected: both exit successfully.

- [x] **Step 4: Check patch integrity**

Run:

```powershell
git diff --check
```

Expected: no whitespace errors.

- [x] **Step 5: Manually inspect repository and standalone presets**

Open the local Diff gallery and verify file filter, list/tree menu, staging, selected-file Diff, repository commit/open extensions, standalone toolbar/statusbar, file statistics, and console output.
