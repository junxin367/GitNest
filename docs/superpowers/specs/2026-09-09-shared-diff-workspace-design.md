# Shared Diff Workspace Design

**Date:** 2026-09-09
**Updated:** 2026-09-16
**Status:** Approved for direct implementation

## Goal

Replace the repository page and standalone Diff viewer's duplicated file-navigation UI with one complete shared `DiffWorkspace` component. Both entry points must render the same file filter, staged/unstaged/untracked groups, list/tree navigation, file rows, stage controls, and `DiffPanel`, while explicit capability configuration preserves the behavior unique to each entry point.

## Confirmed product decisions

- `DiffWorkspace` owns the complete Diff workspace UI rather than accepting an arbitrary sidebar slot.
- Repository and standalone entry points continue to own asynchronous data loading and Git mutations.
- The standalone window titlebar and window controls remain outside `DiffWorkspace`.
- Repository-only commit UI is implemented inside the shared Diff workspace package and enabled by configuration.
- The repository-only “open in standalone Diff” action is enabled by configuration.
- The repository may provide one optional auxiliary view entry. The first implementation is the “储藏的变更” browser.
- The standalone Diff document toolbar is enabled by configuration.
- The stash browser supports explicit `apply`, `drop`, and `pop` mutations through a right-click menu. It does not create stashes or clear the complete stash list.
- Stash mutation identity is always `stashRef + stashHash`; the immutable hash guards against a reflog selector moving before execution.

## Non-goals

- Do not move IPC or `window.gitnest` calls into the shared component.
- Do not change repository query, staging, unstaging, commit, or push semantics.
- Do not add per-file Git numstat queries. File-row statistics are optional data and appear only when already available.
- Do not expose the repository stash browser or its mutations in the standalone Diff viewer.
- Do not add stash creation, clear-all, arbitrary ref entry, batch stash mutation, or custom Git arguments.
- Do not add a third stash-preview pane. `getStashDiff` is an optional read contract for later use, not part of the default stash-browser layout.
- Do not move standalone window chrome into the shared component.
- Do not refactor unrelated repository page sections.

## Architecture

### Public component

`DiffWorkspace` is the only public workspace component consumed by the two pages. It renders:

1. a shared file navigator;
2. an optional auxiliary-view entry immediately above the commit composer;
3. an optional shared commit composer;
4. the existing shared `DiffPanel` or the active auxiliary content;
5. an optional status bar.

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
  auxiliaryView?: {
    active: boolean;
    busy?: boolean;
    content: ReactNode;
    count?: number;
    label: string;
    onToggle(): void;
  };
  statusbar?: ReactNode;
  treePreference?: DiffWorkspaceTreePreference;
  className?: string;
}
```

The concrete implementation may refine names for consistency with existing code, but it must preserve the boundary: consumers supply data and effects; the shared component owns navigation rendering and transient interaction state.

When `auxiliaryView` is present, its entry is a fixed row between the file navigator and commit composer. It remains available when the worktree has no changes. Activating it hides, but does not unmount, the primary `DiffPanel`; the commit composer also remains mounted. This preserves the controlled commit draft and the Diff panel's search, scroll, and other transient document state.

Selecting a working-tree file through the navigator closes the active auxiliary view before forwarding `onSelectedFileChange`, so the selected file's Diff becomes visible. Inline stage, unstage, discard, and group controls stop at their own actions and must not toggle the auxiliary view.

### Controlled and internal state

The selected file remains controlled because each consumer must start or cancel an asynchronous Diff query when selection changes. `DiffWorkspace` owns transient UI state:

- filter text;
- list/tree view;
- view menu visibility;
- collapsed file sections;
- collapsed tree directories.

The component automatically requests a valid fallback selection when filtering or refreshed file data removes the current visible selection. It must not clear or replace an already displayed same-file Diff during an unrelated background refresh.

The auxiliary content provider owns its own filter, selection, query, loading, and error state. `DiffWorkspace` owns only whether the supplied auxiliary content is visible and the transition back to the primary Diff when a working-tree file is selected.

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

The auxiliary view is supplied as an optional data/action object rather than a page-identity flag. Repository mode supplies the stash browser; standalone mode omits it. The shared workspace owns the entry placement and primary/auxiliary visibility, while the repository owns stash queries and stash-browser content.

## Component responsibilities

### `DiffWorkspace`

- Compose the navigator, document, optional commit region, and optional status bar.
- Own filter, view mode, menu, and collapse state.
- Normalize selection fallback behavior.
- Supply the selected path, scope key, statistics, state, and configured actions to `DiffPanel`.
- Render an optional auxiliary entry directly above the commit composer, including pressed, busy, count, and controlled-region accessibility state.
- Keep primary and auxiliary containers mounted and switch them with visibility state.
- Close the active auxiliary view only when a file-selection action is forwarded to the consumer.

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

### `RepositoryStashBrowser`

- Render exactly two direct panes: the stash list and the selected stash's file list.
- The stash pane shows the reflog selector, subject, time, and available file/addition/deletion totals.
- The file pane shows immutable commit identity and metadata, an in-pane path filter, file rows, binary labels, and available addition/deletion totals.
- Keep list-loading, file-loading, empty-list, empty-files, filtered-empty, error, and retry states distinct.
- Selecting a stash only selects metadata immediately; its file list is loaded lazily.
- Right-clicking a stash first selects that exact summary and opens a pointer-positioned context menu with `恢复`, `删除`, and `恢复并删除`, in that order.
- The menu is viewport-clamped, focuses its first enabled item, supports shared arrow-key navigation, and closes on Escape, outside pointer input, scroll, window blur, resize, scope change, or mutation start.
- Each action opens a confirmation dialog. Apply explains that the stash remains; drop and pop use danger treatment and explain irreversible removal; pop also explains that Git keeps the stash when application fails or conflicts.
- File rows remain read-only and do not introduce per-file stash restore, stage, or mutation behavior.

## Stash query, mutation, and identity contract

The repository bridge exposes the following contracts:

```ts
getStashes(request: {
  queryId: string;
  target: RepositoryTargetDto;
  limit?: number;
}): Promise<GitReadResult<RepositoryStashesDto>>;

getStashFiles(request: {
  queryId: string;
  target: RepositoryTargetDto;
  stashRef: string;
}): Promise<GitReadResult<RepositoryStashFilesDto>>;

getStashDiff?(request: {
  queryId: string;
  target: RepositoryTargetDto;
  stashRef: string;
  path: string;
  contextLines?: number;
}): Promise<GitReadResult<RepositoryStashDiffDto>>;

mutateStash(request: {
  target: RepositoryTargetDto;
  stashRef: string;
  stashHash: string;
  action: "apply" | "drop" | "pop";
}): Promise<GitReadResult<RepositoryStashMutationDto>>;
```

`getStashes` is one bounded Git list query. It returns summary metadata and any statistics available without issuing an N+1 query per stash. `getStashFiles` runs only after a stash is selected. `getStashDiff` may support a later per-file document experience, but the current accepted UI remains the two-pane list-and-files browser.

All state and requests are scoped by `repositoryId + worktreeId`. The consumer assigns an independent `queryId` to list and file reads, cancels the previous request of the same kind, cancels all active reads on scope change or unmount, and rejects responses whose query generation or current-query identity is stale.

The stash commit hash is the stable identity. A reflog selector such as `stash@{0}` is a display label and request selector that can move when another process creates, drops, or reorders stashes. Selection persistence therefore records both ref and hash, refresh restores by hash first, and a file response is accepted only when its returned hash matches the hash captured for the selected list item. A mismatch clears the detail and asks the user to reload instead of showing data under the wrong stash.

Every mutation request includes both the displayed ref and the full hash captured from that list item. Inside the serialized Worktree mutation, the Git adapter resolves the ref immediately before executing the write and rejects the request unless it still resolves to the expected hash. Apply may use the validated immutable commit hash; drop and pop operate on the validated reflog selector because they update the stash reflog. This check prevents an external stash insertion, deletion, or reorder from redirecting the requested mutation to another entry.

Action semantics are:

- `apply`: apply the stash to the current Worktree and keep the stash entry;
- `drop`: remove the selected stash without applying it;
- `pop`: apply the stash and let Git remove it only after a successful application. Failed or conflicted pop keeps the stash.

All three actions run through the existing serialized Worktree mutation runtime and return the operation identity through the typed `GitReadResult`. Apply and pop can modify both the index and Worktree. The consumer therefore refreshes repository changes after every completed invocation, including failures, because Git may leave conflicts or partial changes. A successful mutation also reloads the stash list; selection is restored by hash when the entry remains, otherwise it falls back to an adjacent/current entry.

Stash file/stat parsing includes tracked, staged, and saved untracked files. Untracked content is compared from its stash parent tree (including the root-tree case) so it is not misreported as deletion of unrelated files. Binary entries set `binary: true` and may omit textual additions/deletions; the UI displays a binary label rather than invented counts.

IPC validation bounds `limit` and `contextLines`, accepts only exact `stash@{non-negative integer}` selectors, requires a complete 40- or 64-character hexadecimal hash for mutation, validates paths, and passes arguments directly to Git. No stash request is assembled as a shell command. Read and mutation errors use the existing typed `GitReadResult`; cancellation is not surfaced as a user error.

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
9. Scope stash view activity, selection, list, files, loading, and errors to the current repository/worktree key.
10. Load the bounded stash list on first activation and lazily call `getStashFiles` for the selected record.
11. Pass “储藏的变更” and `RepositoryStashBrowser` through `auxiliaryView`; selecting a working-tree file closes it and returns to Diff.
12. Route stash menu actions through the repository-owned mutation controller with the selected summary's ref and hash, never by looking up only the current ref at confirmation time.
13. Refresh repository changes after every apply/pop attempt and reload the stash list after successful apply/drop/pop. Surface operation feedback through the repository toast area.

### Standalone Diff viewer

1. Continue loading the file list and selected Diff through `window.gitnest.repository`.
2. Pass its `files`, `selectedKey`, query states, mutation callbacks, and refresh callback to `DiffWorkspace`.
3. Remove local filter, grouping, tree, row-rendering, and view-menu code.
4. Keep document-title updates, titlebar controls, toasts, and query cancellation in `DiffViewerApp`.

## Error and empty states

- Initial repository page loading and whole-page read failure remain owned by `RepositoryPage`.
- Inside an already mounted workspace, file-list errors, clean-worktree state, and filtered-empty state render through the shared navigator.
- The fixed stash entry remains visible in the clean-worktree state.
- Diff loading, read failure, removed change, binary, truncated, and empty-text states continue through `DiffPanel`.
- Stash list/file loading, empty, filtered-empty, hash-mismatch, and read-failure states render inside the two stash panes; retry reloads the list and current selection.
- Failed refreshes may preserve the previous file list and appear as a toast in the standalone viewer.
- Mutation failures remain reported by the existing consumer mutation hooks.
- A stale ref/hash mutation is rejected before the stash write and tells the user to reload.
- A failed or conflicted apply/pop refreshes the repository snapshot so conflict markers, staged entries, and Worktree changes become actionable. Pop feedback also states that the stash was retained.

## Styling

- Shared navigator, workspace layout, row, tree, commit region, and status-bar styles move under shared `diff-workspace-*` class names.
- Both entry points use the same row dimensions and typography.
- The confirmed file row follows the standalone popup structure: primary file path/name, second-line stage label and optional `+N/-N` values, with a compact stage action on the right.
- Repository and standalone files may retain outer layout classes for container sizing only; they must not provide separate row or navigation implementations.
- The header action separator remains part of `DiffPanel`.
- The auxiliary entry uses the shared sidebar width and sits directly above the commit region. Its active state is exposed with `aria-pressed` and its content with `aria-controls`.
- The stash browser fills the right content area and has exactly two direct grid panes. Responsive sizing may change their widths but must not introduce a third pane.
- The stash context menu uses the shared menu surface and item components; destructive items use the danger tone. Confirmation dialogs use the existing command-dialog focus trap and busy-state treatment.

## Prototype alignment

The browser prototype remains a review fixture rather than production code. Its shared `GitNestDiffWorkspace` configuration must demonstrate:

- repository capabilities with commit and standalone-open enabled;
- the fixed “储藏的变更” entry above the commit composer, including a clean-worktree example;
- the active two-pane stash list/file view and the return-to-Diff behavior when a working-tree file is selected;
- the stash right-click menu, its three actions, their distinct confirmation copy, and prototype-only success feedback without executing Git;
- standalone capabilities with document toolbar enabled and repository extensions disabled;
- the corrected `WorkspaceStateServiceTest.java` row and header-action separator.

The production React component is the source of truth for architecture.

## Testing and verification

- Extend the existing `DiffWorkspace.test.tsx`; do not create a throwaway test file.
- Verify shared filtering, section rendering, list/tree switching, controlled selection, stage/unstage callbacks, toolbar capability, standalone-open capability, and commit capability.
- Verify the auxiliary entry position and accessibility state, primary Diff mount preservation, toggle behavior, and automatic return to Diff on working-tree file selection.
- Verify inline stage, unstage, discard, and group controls do not close the active stash view.
- Verify `RepositoryStashBrowser` has exactly two direct panes and covers list/file loading, empty, error/retry, filtering, binary rows, and selection.
- Verify right-click selects the target stash, opens a viewport-clamped accessible menu, exposes the three actions in order, and closes on Escape, outside input, scroll, blur, resize, scope change, and mutation start.
- Verify confirmation text and danger treatment for apply/drop/pop, busy duplicate prevention, and forwarding of the exact selected summary's ref and hash.
- Verify repository stash state is isolated per repository/worktree, files load lazily, old requests are cancelled, and stale or hash-mismatched responses cannot replace current data.
- Verify mutation success/error feedback, stash-list refresh, repository snapshot refresh on both successful and failed apply/pop, and selection fallback after drop/pop.
- Verify contracts, IPC validation, preload forwarding, stash parsing, bounded/literal Git arguments, exact ref/hash mutation validation, and integration fixtures for apply-keep, drop, pop-remove, ref/hash mismatch, and conflicted pop retention in addition to tracked, staged, untracked, binary, and per-file Diff data.
- Keep `DiffViewerApp.test.tsx` focused on the standalone adapter, titlebar, async query, and feature configuration.
- Use existing repository controller tests for async same-file Diff preservation.
- Run targeted workspace/viewer tests, desktop typecheck, desktop build, and `git diff --check`.
- Manually inspect both repository and standalone configurations in the prototype/browser.

## Rollback boundary

The shared workspace auxiliary-view support and repository stash browser can be rolled back without changing existing Diff, commit, stage, push, or pull semantics. Stash read and mutation contracts span contracts, Git core/CLI, application services, IPC, preload, and renderer and must be rolled back together if removed. Apply/pop can modify the index and Worktree, while drop/pop can update the stash reflog; their confirmation, immutable-hash guard, serialized execution, and refresh behavior are therefore part of the same rollback boundary. Prototype changes are independently reversible and do not affect application behavior.
