# Shared Form Control Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:executing-plans` to implement this plan inline. Subagents,
> worktrees, commits, pushes, and pull requests are not authorized.

**Goal:** Replace compatible native renderer buttons and text inputs with the
shared `Button`, `Input`, and `Textarea` components, and implement the approved
staged-or-all repository commit behavior.

**Architecture:** Extend each shared primitive with the smallest required
contract. `Textarea` uses the same outer-border ownership as `Input`. Repository
commit fallback is implemented inside the serialized application mutation and
uses a dedicated Git writer `stageAll` operation.

**Tech Stack:** React 19, TypeScript 7, Vitest 5, jsdom, electron-vite.

**Spec:**
`docs/superpowers/specs/2026-09-09-shared-form-control-adoption-design.md`

## Global Constraints

- Preserve all existing event handlers, accessible attributes, native form
  props, conditional rendering, and keyboard behavior.
- Keep native checkbox controls and hidden clipboard fallback textareas.
- Route all visible multi-line form fields through `Textarea`.
- Keep the native primitive element inside `Button.tsx` and `Input.tsx`.
- Do not change unrelated Electron main/preload behavior, persistence,
  repository commands, or business logic.
- Preserve specialist control class names and existing CSS.
- Do not create or switch worktrees.
- After verification, commit every current working-tree change and push the
  current branch, as explicitly authorized on 2026-09-10. Do not create a pull
  request or discard unrelated changes.
- Use `apply_patch` for authored file changes.

## 2026-09-10 Approved Revision

This section supersedes earlier statements that textarea and Git behavior were
outside scope.

### Revision governance

- Status: complete.
- Task level: standard with a shared UI contract and serialized Git mutation.
- Development feedback: Textarea component test, Diff workspace behavior test,
  Git argument test, and repository mutation service test.
- Delivery acceptance: source-boundary audit and affected tests for each
  revision Task.
- Final integration: one test suite, typecheck, production build, diff check,
  and browser interaction verification.
- Worktree: prohibited.
- Commit: authorized for every current working-tree change.
- Push: authorized for the current branch and its configured upstream.

### Task 5: Add and adopt the shared Textarea

- Status: complete.
- Single target: every visible multi-line form field uses one shared component
  with a single focus border.
- Owner: shared Textarea primitive and its visible consumers.
- Inputs: existing Input visual tokens, commit composer, AI prompt, prototype
  gallery, and reusable prototype Diff workspace.
- Invariants: native textarea attributes and controlled values remain intact;
  the inner control has no border, outline, or shadow; staged status stays
  right-aligned; vertical form gaps are equal.
- Allowed scope: shared UI component/styles/tests, Diff commit composer/styles,
  prototype Textarea assets and visible textarea consumers.
- Prohibited scope: clipboard fallback textareas and unrelated form redesign.
- Evidence: component and Diff workspace tests passed; the visible-textarea
  source audit found only the React and prototype component internals; browser
  inspection confirmed one focus border and equal 8 px form gaps.
- Rollback: revert Task 5 files without reverting commit semantics.
- Failure count: 0.

### Task 6: Implement staged-or-all commit behavior

- Status: complete.
- Single target: submitting commits staged changes when present, otherwise all
  current unstaged and untracked changes.
- Owner: repository commit mutation.
- Inputs: fresh repository snapshot, validated commit message, serialized
  Worktree mutation, and Git CLI writer.
- Invariants: conflicts block submission; staged content is never mixed with
  additional working-tree changes; the empty repository remains rejected;
  stage-all and commit either complete in the same mutation or surface failure.
- Allowed scope: Git mutation port/adapter/arguments, repository mutation
  service, renderer commit availability/labels, prototype behavior, and
  corresponding tests.
- Prohibited scope: push semantics, unrelated Git commands, and IPC payload
  redesign.
- Evidence: Git argument and integration tests, mutation service
  staged/fallback/empty tests, Diff workspace interaction tests, prototype
  browser interaction, typecheck, full test suite, and production build passed.
- Rollback: revert Task 6 files independently from Textarea.
- Failure count: 0.

### Task 7: Align iconless field left spacing

- Status: complete.
- Single target: iconless `Input` and `Textarea` controls expose exactly 8 px
  of left content spacing in both the renderer and prototype.
- Owner: shared field primitive spacing.
- Inputs: the approved 8 px requirement and existing `--space-2` token.
- Invariants: inputs with leading icons keep their existing icon layout; right
  spacing and the single-border focus contract remain unchanged.
- Allowed scope: shared primitive CSS, prototype Input/Textarea CSS, this Plan,
  and focused verification.
- Prohibited scope: consumer-specific overrides and unrelated control sizing.
- Evidence: focused component tests passed 8/8; computed-style browser
  inspection measured 8 px for both controls while preserving the single
  border; typecheck, all 286 tests, production build, and diff check passed.
- Rollback: revert Task 7 CSS and Plan changes independently.
- Failure count: 0.

## Superpowers 治理契约

- 适用性判定：治理
- 状态：完成
- 任务等级：复杂高风险
- 当前已生效的上位约束：简体中文沟通；设计批准后实施；保留无关改动；不使用未获授权的子代理、worktree、commit、push 或 PR。
- 用户明确指定：使用 `superpowers:brainstorming`；批准全 Renderer 兼容项迁移与推荐的混合统一策略；要求当前会话直接实施。
- 允许或必须使用的 Superpowers Skill：`brainstorming`、`writing-plans`、`executing-plans`、`test-driven-development`。
- 禁用或裁剪的通用默认步骤：禁用 worktree、subagent、commit、push、PR 和 `finishing-a-development-branch`；不按每个机械 Step 重复 Review 或全量测试。
- 开发期反馈：共享组件定向红绿测试、Renderer 定向测试、TypeScript 检查。
- 交付单元验收：各 Task 的源边界审计、相关测试和类型检查。
- 最终集成验证：一次全量测试、一次类型检查、一次生产构建。
- Review 检查点：共享契约稳定后一次差异审查；最终集成前一次完整差异检查。
- 可复用证据：相同代码状态下已通过的共享组件和 Renderer 测试不重复运行。
- Worktree：禁止
- Commit：禁止

---

### Task 1: Add the Button compatibility presentation

**Files:**

- Modify: `apps/desktop/src/renderer/src/shared/ui/Button.tsx`
- Modify: `apps/desktop/src/renderer/src/shared/ui/Button.test.tsx`

**Interfaces:**

- Produces: `ButtonVariant` including `"unstyled"`.
- Preserves: all existing styled `ButtonProps` behavior.

#### Task 1 governance closure

- Single target: `Button` can wrap layout-sensitive controls without injecting
  shared visual structure.
- Owner: shared Button primitive.
- Inputs and prerequisites: existing `ButtonProps`, native button attributes,
  and legacy control classes.
- Invariant family: refs, default `type="button"`, native props, disabled state,
  ARIA, children structure, and all styled variants remain intact.
- Allowed scope: `Button.tsx` and `Button.test.tsx`.
- Prohibited scope: consumer migration, Input behavior, business logic, and
  unrelated styling.
- Observable evidence: red failure followed by three passing Button tests.
- Rollback: revert the two Button files.
- Dependencies and shared writes: none; Task 3 consumes the new variant.
- Finding: confirmed API gap; the existing component always injects
  `gn-button` styling and label wrappers.
- Failure count: 0.

- [x] **Step 1: Add a failing unstyled Button test**

  Render:

  ```tsx
  <Button className="window-button" variant="unstyled">
    Minimize
  </Button>
  ```

  Assert that the native button has `type="button"` and
  `class="window-button"`, and does not contain `gn-button`.

- [x] **Step 2: Run the red Button test**

  Run:

  ```powershell
  pnpm vitest run apps/desktop/src/renderer/src/shared/ui/Button.test.tsx
  ```

  Expected: the unstyled test fails because `gn-button` and its label wrapper
  are still present.

- [x] **Step 3: Implement the minimal Button contract**

  Add `"unstyled"` to `ButtonVariant`, preserve the supplied class without
  `gn-button`, render children directly, and retain the existing native props,
  type, ref, ARIA, and disabled behavior.

- [x] **Step 4: Run the green Button test**

  Run the Step 2 command.

  Expected: all Button tests pass.

### Task 2: Add Input compatibility and migrate renderer inputs

**Files:**

- Modify: `apps/desktop/src/renderer/src/shared/ui/Input.tsx`
- Modify: `apps/desktop/src/renderer/src/shared/ui/Input.test.tsx`
- Modify: `apps/desktop/src/renderer/src/app/styles/global.css`
- Modify: `apps/desktop/src/renderer/src/features/global-search/GlobalSearchDialog.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/repository/RepositoryPage.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/repository/RepositoryWorktrees.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/settings/SettingsPage.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/workspace-overview/WorkspaceCollectionPage.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/workspace-overview/WorkspaceOverviewPage.tsx`
- Modify: `apps/desktop/src/renderer/src/widgets/detail-inspector/DetailInspector.tsx`
- Modify: `apps/desktop/src/renderer/src/widgets/workspace-sidebar/WorkspaceEntryDialogs.tsx`
- Modify: `apps/desktop/src/renderer/src/widgets/workspace-sidebar/WorkspaceSidebar.tsx`

**Interfaces:**

- Produces: `InputProps.appearance?: "default" | "unstyled"`.
- Produces: all 19 compatible native text/search/password controls use `Input`.
- Preserves: the two native checkboxes and commit-message textarea.

#### Task 2 governance closure

- Single target: compatible renderer text inputs use the shared Input contract.
- Owner: renderer form-control adoption.
- Inputs and prerequisites: current `Input` API, 19 compatible native inputs,
  existing form labels, ARIA, and layout CSS.
- Invariant family: controlled values, form validation, labels, focus,
  combobox ARIA, search keyboard behavior, password behavior, and inline-edit
  layout remain unchanged.
- Allowed scope: `Input.tsx`, its test, the nine consumers, and input-specific
  selectors in `global.css`.
- Prohibited scope: checkbox, textarea, select, repository commands, and
  unrelated form redesign.
- Observable evidence: unstyled Input red/green test, exactly two remaining
  native checkbox inputs, 11 affected tests, and typecheck.
- Rollback: revert the Input files, nine consumers, and input-specific CSS.
- Dependencies and shared writes: Task 3 consumes `Button` inside Input's clear
  action; consumer edits are serialized with Task 3 where files overlap.
- Finding: confirmed API gap plus 19 compatible native inputs.
- Failure count: 0.

- [x] **Step 1: Add and verify the failing unstyled Input test**

  Assert that `appearance="unstyled"` renders one native input, preserves the
  class, and creates no `.gn-input` wrapper. Run the shared Input test and
  observe the expected wrapper assertion failure.

- [x] **Step 2: Implement the minimal Input compatibility contract**

  Add `appearance?: "default" | "unstyled"` and forward native props, ref,
  `type`, `disabled`, ARIA state, and merged classes in direct-input mode.

- [x] **Step 3: Import `Input` in each consumer**

  Use `../../shared/ui/Input` from page, widget, and feature directories. Keep
  existing import grouping and do not introduce a barrel file.

- [x] **Step 4: Migrate ordinary form fields**

  Use default `Input` for workspace names, display names, paths, branch/start
  fields, account host/username/token, account test URL, and new branch forms.
  Preserve labels, help text IDs, required, password, maxLength, autocomplete,
  spellcheck, disabled, and controlled props.

- [x] **Step 5: Migrate structure-sensitive fields**

  Use `appearance="unstyled"` for global search, sidebar search, history and
  activity filters, inline branch rename, worktree lock reason, and worktree
  move destination. Preserve every existing native-input class name and ARIA
  combobox attribute.

- [x] **Step 6: Update CSS and explicit labels**

  Redirect legacy selectors away from `.gn-input__control`, add flex/grid
  placement classes, retain monospace path/branch content, and use explicit
  `htmlFor/id` pairs where wrapper insertion replaces a label-wrapped input.

- [x] **Step 7: Verify the input source boundary**

  Run:

  ```powershell
  rg -n '<input\b' apps/desktop/src/renderer/src -g '*.tsx' -g '!*.test.tsx' -g '!Input.tsx'
  ```

  Expected: only the two checkbox inputs remain.

- [x] **Step 8: Run affected input tests and typecheck**

  Run:

  ```powershell
  pnpm vitest run apps/desktop/src/renderer/src/shared/ui/Input.test.tsx apps/desktop/src/renderer/src/features/global-search apps/desktop/src/renderer/src/pages/repository apps/desktop/src/renderer/src/pages/settings apps/desktop/src/renderer/src/pages/workspace-overview apps/desktop/src/renderer/src/widgets/workspace-sidebar
  pnpm typecheck
  ```

  Expected: all selected tests and typecheck pass.

### Task 3: Migrate compatible renderer buttons

**Files:**

- Modify every production TSX file reported by:

  ```powershell
  rg -l '<button\b' apps/desktop/src/renderer/src -g '*.tsx' -g '!*.test.tsx' -g '!Button.tsx'
  ```

- Modify: `apps/desktop/src/renderer/src/shared/ui/Input.tsx`
- Modify: `apps/desktop/src/renderer/src/shared/ui/Menu.tsx`
- Modify: `apps/desktop/src/renderer/src/shared/ui/Toast.tsx`

**Interfaces:**

- Consumes: all `Button` variants from Task 1.
- Produces: `Button.tsx` is the only production renderer file containing the
  native button primitive.

#### Task 3 governance closure

- Single target: compatible renderer button interactions use the shared Button
  contract.
- Owner: renderer button adoption.
- Inputs and prerequisites: Task 1 unstyled variant, 131 consumer buttons, the
  Input clear action, and existing button classes.
- Invariant family: click/submit behavior, event propagation, busy/disabled state,
  ARIA roles, menu/list semantics, draggable regions, and layout remain intact.
- Allowed scope: the 23 button consumer TSX files, button-placement selectors in
  `global.css` and `diff-workspace.css`, and shared label layout in
  `primitives.css`.
- Prohibited scope: Button's native primitive boundary, business handlers,
  navigation logic, command payloads, and unrelated CSS cleanup.
- Observable evidence: no native consumer `<button>`, 49 compact shared
  actions, 83 unstyled specialist buttons, 64 Renderer tests, and typecheck.
- Rollback: revert button consumer files without reverting input migration.
- Dependencies and shared writes: consumes Task 1; overlaps Task 2 in Input and
  shared consumer files, so execution is serialized.
- Finding: confirmed 132 migrations: 131 consumer buttons plus Input's clear
  action.
- Failure count: 1, resolved after replacing explicit optional `undefined` with
  a conditional `emphasis` spread for exact optional property types.

- [x] **Step 1: Import `Button` in each consumer**

  Reuse existing imports where present. Shared UI consumers import `./Button`;
  page, feature, and widget consumers import `../../shared/ui/Button`.

- [x] **Step 2: Migrate ordinary action buttons**

  Replace `button`, `button primary`, `button danger`, and `button small`
  controls with `size="small"` shared default/primary variants and strong danger
  variants. Preserve placement-only classes such as repository hero, dialog
  footer, branch header, and inspector settings classes.

- [x] **Step 3: Migrate specialist buttons**

  Use `variant="unstyled"` and preserve the original class on toolbar, icon,
  quick, panel, title-bar, window, activity-rail, menu item, list row,
  disclosure, tree, toast, and inline action controls.

- [x] **Step 4: Preserve native semantics**

  Keep explicit `type="submit"` where present. Rely on the shared default
  `type="button"` elsewhere. Preserve `aria-*`, `role`, `tabIndex`, title,
  disabled, event handlers, keys, refs, and data attributes.

- [x] **Step 5: Verify the button source boundary**

  Run:

  ```powershell
  rg -n '<button\b' apps/desktop/src/renderer/src -g '*.tsx' -g '!*.test.tsx' -g '!Button.tsx'
  ```

  Expected: no matches.

- [x] **Step 6: Run affected tests**

  Run:

  ```powershell
  pnpm vitest run apps/desktop/src/renderer/src
  ```

  Expected: renderer tests pass with no React DOM nesting or unknown-prop
  warnings.

### Task 4: Integrated verification

**Files:**

- No additional source files are planned.
- Inspect all current task changes with `git diff`.

**Interfaces:**

- Consumes: completed Tasks 1–3.
- Produces: final evidence for the shared-control migration.

#### Task 4 governance closure

- Single target: prove the renderer remains buildable and tested after both
  control migrations.
- Owner: final renderer integration.
- Inputs and prerequisites: completed Tasks 1–3 and their source audits.
- Invariant family: component contracts, consumer TypeScript, CSS build, and current
  application tests all pass together.
- Allowed scope: read-only source audits, diff inspection, tests, typecheck,
  build, and this plan's evidence fields.
- Prohibited scope: new production behavior, Git integration, and unrelated
  cleanup.
- Observable evidence: zero consumer native buttons, two native checkboxes, one
  native textarea, 67 passing test files with 277 tests, successful typecheck,
  successful electron-vite production build, and `git diff --check`.
- Rollback: no edits; failures return to the owning Task.
- Dependencies and shared writes: depends on Tasks 1–3; no production writes.
- Finding: no unresolved integration finding.
- Failure count: 0.

- [x] **Step 1: Inspect the complete diff**

  Run:

  ```powershell
  git diff --check
  git diff --stat
  git diff
  ```

  Confirm there are no unrelated changes, malformed JSX, accidental behavior
  edits, or whitespace errors.

- [x] **Step 2: Run final source audits**

  Run:

  ```powershell
  rg -n '<button\b' apps/desktop/src/renderer/src -g '*.tsx' -g '!*.test.tsx' -g '!Button.tsx'
  rg -n '<input\b' apps/desktop/src/renderer/src -g '*.tsx' -g '!*.test.tsx' -g '!Input.tsx'
  ```

  Expected: no button matches and exactly two checkbox input matches.

- [x] **Step 3: Run final validation**

  Run:

  ```powershell
  pnpm test
  pnpm typecheck
  pnpm build
  ```

  Expected: all commands exit with code 0.

- [x] **Step 4: Report without Git integration**

  Report changed files, migration counts, retained native exceptions, and exact
  verification results. Leave all changes uncommitted and unpushed.
