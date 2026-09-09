# Shared Diff Workspace Design

**Date:** 2026-09-09
**Status:** Approved for direct implementation

## Goal

Replace the repository page and standalone Diff viewer's duplicated file-navigation UI with one complete shared `DiffWorkspace` component. Both entry points must render the same file filter, staged/unstaged/untracked groups, list/tree navigation, file rows, stage controls, and `DiffPanel`, while explicit capability configuration preserves the behavior unique to each entry point.

## Confirmed product decisions

- `DiffWorkspace` owns the complete Diff workspace UI rather than accepting an arbitrary sidebar slot.
- Repository and standalone entry points continue to own asynchronous data loading and Git mutations.
- The standalone window titlebar and window controls remain outside `DiffWorkspace`.
- Repository-only commit UI is implemented inside the shared Diff workspace package and enabled by configuration.
- The repository-only “open in standalone Diff” action is enabled by configuration.
- The standalone Diff document toolbar is enabled by configuration.
- No new worktree, commit, push, or pull is part of this task.

## Non-goals

- Do not move IPC or `window.gitnest` calls into the shared component.
- Do not change repository query, staging, unstaging, commit, or push semantics.
- Do not add per-file Git numstat queries. File-row statistics are optional data and appear only when already available.
- Do not move standalone window chrome into the shared component.
- Do not refactor unrelated repository page sections.

## Architecture

### Public component

`DiffWorkspace` is the only public workspace component consumed by the two pages. It renders:

1. a shared file navigator;
2. an optional shared commit composer;
3. the existing shared `DiffPanel`;
4. an optional status bar.

Internal files may contain focused child components, but consumers do not assemble those children themselves.

The component receives normalized `DiffViewerFile` records and a controlled selection:

```ts
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
    event: MouseEvent<HTMLDivElement>,
    file: DiffViewerFile
  ): void;
  panel: DiffWorkspacePanel;
  openStandalone?: DiffWorkspaceOpenStandaloneAction;
  commit?: DiffWorkspaceCommit;
  statusbar?: ReactNode;
  treePreference?: DiffWorkspaceTreePreference;
  className?: string;
}
```

The concrete implementation may refine names for consistency with existing code, but it must preserve the boundary: consumers supply data and effects; the shared component owns navigation rendering and transient interaction state.

### Controlled and internal state

The selected file remains controlled because each consumer must start or cancel an asynchronous Diff query when selection changes. `DiffWorkspace` owns transient UI state:

- filter text;
- list/tree view;
- view menu visibility;
- collapsed file sections;
- collapsed tree directories.

The component automatically requests a valid fallback selection when filtering or refreshed file data removes the current visible selection. It must not clear or replace an already displayed same-file Diff during an unrelated background refresh.

### Capability configuration

`DiffWorkspaceConfiguration` describes available UI capabilities rather than identifying a page variant:

```ts
export interface DiffWorkspaceConfiguration {
  document: DiffDocumentFeatureConfig;
  navigation: {
    allowTreeView: boolean;
    allowRefresh: boolean;
  };
  extensions: {
    openStandaloneDiff: boolean;
    commitRegion: boolean;
    pushRegion: boolean;
    statusbar: boolean;
  };
}

export interface DiffDocumentFeatureConfig {
  layouts: readonly DiffViewerLayout[];
  defaultLayout: DiffViewerLayout;
  showToolbar: boolean;
  allowWrap: boolean;
  showHunkNavigation: boolean;
}
```

Repository configuration:

- unified layout only;
- document toolbar hidden;
- tree/list navigation enabled;
- refresh menu item hidden;
- standalone-open action enabled;
- commit region enabled;
- existing push option enabled inside the commit region;
- status bar hidden unless repository product requirements later enable it.

Standalone configuration:

- split and unified layouts;
- document toolbar visible;
- wrapping and hunk navigation enabled;
- tree/list navigation enabled;
- refresh menu item enabled;
- standalone-open action disabled;
- commit region disabled;
- push option disabled;
- status bar enabled.

An extension is rendered only when both its capability flag and corresponding data/action object are present. Missing action data must disable or omit the control rather than call a no-op.

## Component responsibilities

### `DiffWorkspace`

- Compose the navigator, document, optional commit region, and optional status bar.
- Own filter, view mode, menu, and collapse state.
- Normalize selection fallback behavior.
- Supply the selected path, scope key, statistics, state, and configured actions to `DiffPanel`.

### `DiffFileNavigator`

- Build staged, unstaged, and untracked sections from normalized files.
- Render the exact same row markup in both entry points.
- Render full path in list mode and basename in tree mode.
- Render status badge, stage label, optional `+N/-N` statistics, and the stage/unstage button.
- Render compact directory nodes using the existing `changeTree` model.
- Forward repository-only context-menu requests without owning the external-application menu.

### `DiffCommitComposer`

- Move the existing repository commit form from `RepositoryPage.tsx` into the shared workspace package.
- Preserve the existing controlled subject/body values, validation, loading state, guidance text, and submit behavior.
- Preserve the existing push checkbox/value behavior behind `pushRegion`; do not introduce an additional push operation.

### `DiffPanel`

- Remain responsible for Diff parsing, split/unified rendering, search, wrapping, hunk navigation, and path copying.
- Add an explicit `showToolbar` capability. Repository mode hides the toolbar; standalone mode shows it.
- Continue rendering a separator before header actions so the repository standalone-open action has the confirmed visual division.

## Consumer data flow

### Repository page

1. Convert `controller.changes.snapshot.changes` with `buildDiffViewerFiles`.
2. Pass `controller.selectedChange` as the controlled file key.
3. Translate `onSelectedFileChange` to `controller.selectChange(file.change, file.mode)`.
4. Translate stage and unstage callbacks to `useRepositoryMutations`.
5. Pass the current `controller.diff`, loading state, and notice as panel data.
6. Pass existing commit subject/body state and `createCommit` callback through the shared commit contract.
7. Keep the external-application context menu in `RepositoryPage`, opened through `onFileContextMenu`.
8. Keep tree-collapse persistence through a small preference adapter passed to the shared component.

### Standalone Diff viewer

1. Continue loading the file list and selected Diff through `window.gitnest.repository`.
2. Pass its `files`, `selectedKey`, query states, mutation callbacks, and refresh callback to `DiffWorkspace`.
3. Remove local filter, grouping, tree, row-rendering, and view-menu code.
4. Keep document-title updates, titlebar controls, toasts, and query cancellation in `DiffViewerApp`.

## Error and empty states

- Initial repository page loading and whole-page read failure remain owned by `RepositoryPage`.
- Inside an already mounted workspace, file-list errors, clean-worktree state, and filtered-empty state render through the shared navigator.
- Diff loading, read failure, removed change, binary, truncated, and empty-text states continue through `DiffPanel`.
- Failed refreshes may preserve the previous file list and appear as a toast in the standalone viewer.
- Mutation failures remain reported by the existing consumer mutation hooks.

## Styling

- Shared navigator, workspace layout, row, tree, commit region, and status-bar styles move under shared `diff-workspace-*` class names.
- Both entry points use the same row dimensions and typography.
- The confirmed file row follows the standalone popup structure: primary file path/name, second-line stage label and optional `+N/-N` values, with a compact stage action on the right.
- Repository and standalone files may retain outer layout classes for container sizing only; they must not provide separate row or navigation implementations.
- The header action separator remains part of `DiffPanel`.

## Prototype alignment

The browser prototype remains a review fixture rather than production code. Its shared `GitNestDiffWorkspace` configuration must demonstrate:

- repository capabilities with commit and standalone-open enabled;
- standalone capabilities with document toolbar enabled and repository extensions disabled;
- the corrected `WorkspaceStateServiceTest.java` row and header-action separator.

The production React component is the source of truth for architecture.

## Testing and verification

- Extend the existing `DiffWorkspace.test.tsx`; do not create a throwaway test file.
- Verify shared filtering, section rendering, list/tree switching, controlled selection, stage/unstage callbacks, toolbar capability, standalone-open capability, and commit capability.
- Keep `DiffViewerApp.test.tsx` focused on the standalone adapter, titlebar, async query, and feature configuration.
- Use existing repository controller tests for async same-file Diff preservation.
- Run targeted workspace/viewer tests, desktop typecheck, desktop build, and `git diff --check`.
- Manually inspect both repository and standalone configurations in the prototype/browser.

## Rollback boundary

The shared workspace package and the two consumer migrations form one public UI contract. They can be rolled back together without changing IPC, Git services, or persisted repository data. Prototype changes are independently reversible and do not affect application behavior.
