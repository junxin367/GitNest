# Shared Form Control Adoption Design

**Design date:** 2026-09-09
**Revised:** 2026-09-10

## Objective

Migrate compatible renderer controls to the shared React `Button`, `Input`,
and `Textarea` components while preserving keyboard behavior, accessible
names, and layout-sensitive specialist controls. The revision also aligns the
commit composer with the approved repository behavior: commit the staged index
when it is non-empty, otherwise stage and commit all current changes.

The initial migration covered native buttons and ordinary single-line inputs.
This revision adds the remaining visible multi-line input to the shared
component boundary. Hidden textarea elements created only as clipboard
fallbacks remain implementation utilities rather than form controls.

## Scope

The migration covers `apps/desktop/src/renderer/src`.

- Ordinary action buttons use the shared visual variants:
  `default`, `primary`, and `danger`.
- Existing toolbar, icon, title-bar, window, navigation, menu-item, list-row,
  disclosure, and other layout-sensitive buttons use an unstyled compatibility
  variant and keep their existing class names.
- Ordinary text, search, and password form fields use the shared `Input`
  presentation.
- Layout-sensitive search, combobox, and inline-edit fields use an unstyled
  compatibility presentation and keep their existing native-input class names.
- Native checkboxes remain unchanged.
- Visible multi-line form fields use the shared `Textarea` presentation.
- Hidden clipboard fallback textareas remain unchanged.
- The native `<button>` inside `Button` and the native `<input>` inside `Input`
  remain the primitive boundaries. `Textarea` owns the native `<textarea>`
  primitive boundary.

Unrelated Electron behavior, persistence, repository commands, and renderer
refactors remain outside scope. The repository commit mutation and Git writer
are in scope only for the approved staged-or-all commit rule.

## Shared Button Contract

Add `unstyled` to `ButtonVariant`.

When `variant="unstyled"`:

- render a native button through the shared component;
- retain the shared default `type="button"`;
- retain native props, refs, disabled state, and `loading`-driven disabling;
- preserve the supplied class name without adding the `gn-button` visual class;
- do not promise the shared spinner presentation, because the consuming legacy
  class remains responsible for visuals.

All other variants retain the current `gn-button` structure and styling.

Ordinary legacy classes map as follows:

| Existing markup | Shared component |
| --- | --- |
| `className="button"` | `size="small"` |
| `className="button primary"` | `size="small" variant="primary"` |
| `className="button danger"` | `size="small" variant="danger" emphasis="strong"` |
| `className="button small"` | `size="small"` |
| Layout-specific class | `variant="unstyled"` plus the original class |

Additional layout-specific classes may remain alongside a visual shared
variant when they only control placement rather than the control skin.
The compact size preserves the former `.button` height while the shared
variant supplies the visual skin.

## Shared Input Contract

Add `appearance?: "default" | "unstyled"` to `Input`, defaulting to
`"default"`.

Default appearance retains the current field wrapper, label, leading/trailing
content, clear action, state, size, and help-text contract.

Unstyled appearance:

- renders one native input directly, with no field wrapper;
- forwards refs and native input props;
- applies `className` and `inputClassName` to the native input;
- preserves the requested input type and disabled state;
- rejects no runtime props, but consumers must not use wrapper-only features
  (`label`, `leading`, `trailing`, `onClear`, `helpText`) in this mode.

The unstyled mode exists only for DOM-structure compatibility. New ordinary
forms should use the default appearance.

## Shared Textarea Contract

Add a dedicated React `Textarea` component and matching prototype
`GitNestTextarea` component rather than continuing to overload `Input` with a
multiline option.

The component mirrors the ordinary `Input` field contract:

- `small`, `medium`, and `large` sizes;
- `default` and `error` states;
- optional label, help text, full-width layout, field class, and native
  textarea class;
- forwarded native textarea attributes and ref.

The outer `.gn-textarea` element owns the only border, background, radius,
hover state, focus state, error state, and disabled presentation. The inner
native `.gn-textarea__control` has no border, outline, or box shadow. Focus is
rendered as one border-color change on the outer component, never as a second
outline.

Iconless `Input` controls and all current `Textarea` controls use the shared
`--space-2` token for exactly 8 px of left content spacing. Inputs with a
leading icon retain their existing icon layout and spacing.

All visible renderer and prototype textarea fields use this component. The
prototype `GitNestInput` multiline option is removed from component examples
and is no longer used by application pages.

## Commit Scope Behavior

The commit action is decided from a fresh repository snapshot inside
`RepositoryMutationService.commit`:

1. If conflicts exist, reject the commit.
2. If the staged index is non-empty, create the commit without touching
   unstaged or untracked files.
3. If the staged index is empty and unstaged or untracked changes exist, run
   `git add --all` and create the commit within the same serialized Worktree
   mutation.
4. If the repository has no changes, reject the commit.

The renderer enables submission when the subject is non-empty, no mutation is
busy, no conflicts exist, and at least one staged, unstaged, or untracked
change exists. The button text is `提交已暂存变更` when staged changes exist and
`提交全部变更` when the fallback will be used. The staged count remains aligned
to the right side of the commit header.

## Migration Rules

Every migrated control must preserve:

- `aria-*`, `role`, `title`, `tabIndex`, and accessible labels;
- event handlers and event propagation behavior;
- `disabled`, form `type`, `name`, `required`, autocomplete, spellcheck, length,
  focus, and controlled-value props;
- existing class names on specialist controls;
- current conditional rendering and list keys;
- current keyboard interactions, including Escape, Enter, arrow navigation,
  and menu behavior.

No control is converted solely by visual similarity. Native checkboxes remain
because their semantics are not represented by the text-input components.
Hidden clipboard fallback textareas are excluded because they are never visible
or interactive form controls.

## Error Handling

The commit mutation keeps existing conflict and message validation. It returns
an invalid-request error when neither staged nor working-tree changes exist,
and propagates staging or commit failures without reporting success.

The shared components continue to express invalid and disabled states through
native attributes. Consumer-specific error messages remain unchanged.

## Testing

1. Keep component tests for the unstyled `Button` and `Input` contracts and add
   long-term component tests for the `Textarea` border/attribute contract.
2. Add service and Git argument tests for staged-only and stage-all fallback
   commit behavior.
3. Run existing tests for shared UI, Diff workspace, repository header,
   dialogs, pages, and renderer interactions affected by migrated controls.
4. Run a source audit confirming no native production `<button>` remains
   outside `Button.tsx`, no compatible native text/search/password input
   remains outside `Input.tsx`, and no visible native `<textarea>` remains
   outside `Textarea.tsx`.
5. Run the repository test suite, typecheck, and production build once the
   migration is stable.

## Rollback

The shared Textarea migration and staged-or-all commit behavior are independent
rollback boundaries. Reverting commit behavior removes `stageAll` without
requiring the form-control migration to be reverted.

## Authorization

The user approved the mixed-unification strategy on 2026-09-09 and approved
this Textarea and staged-or-all commit revision on 2026-09-10. This task does
not authorize a worktree, Git commit, push, pull request, or unrelated cleanup.
