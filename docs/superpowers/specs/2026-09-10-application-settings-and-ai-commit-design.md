# Application Settings and AI Commit Design

**Date:** 2026-09-10
**Status:** Ready for review

## Goal

Replace the current account-focused formal settings page with a complete
settings experience that matches the Workspace Shell prototype's layout:
a fixed left section navigator and focused right-side setting cards.

The feature must provide exactly four sections:

1. General
2. AI Commit Message
3. Git
4. Accounts and Authentication

The same work introduces one versioned application-settings document,
restores the last business view, applies the selected default terminal,
optionally fetches all repositories after the initial Workspace load, and
generates a commit message from the selected repository's staged Diff
through an OpenAI-compatible Chat Completions endpoint.

## Confirmed product decisions

- Remove the Workspace settings section from both the formal application
  and the prototype.
- Remove the keyboard-shortcuts settings section from both surfaces.
- Remove the dangerous-operation confirmation switch. Dangerous
  operations always require the existing explicit confirmation flow and
  cannot be disabled by a user preference.
- Restoring the last view applies only to the Workspace and repository
  business views. Settings and Operations are never startup destinations.
- A restored repository view includes its last repository tab and uses the
  Workspace's persisted selected target. If that target is unavailable,
  startup falls back to the Workspace overview.
- The AI URL accepts either a base URL or a complete
  `/chat/completions` endpoint.
- Subsequent ambiguous details use the recommended behavior in this
  design.
- AI generation fills the commit-message editor only. It never stages,
  unstages, commits, pushes, pulls, rebases, or changes branches.
- Startup remote checking performs Fetch only.
- The API Key may be stored as plaintext in
  `userData/settings/app-settings.json`, as explicitly requested.
- Existing Git account tokens remain in the protected credential vault.
  This task does not move account tokens into `app-settings.json`.

## Non-goals

- Do not add Workspace scanning settings.
- Do not add keyboard-shortcut editing or display.
- Do not add a setting that weakens any confirmation requirement.
- Do not add Pull, Merge, Rebase, automatic Commit, automatic Stage, or
  automatic Push behavior.
- Do not add provider-specific API headers, Azure deployment discovery,
  streaming responses, tool calls, or model enumeration.
- Do not import SSH private keys, change global Git configuration, or
  replace the existing account credential vault.
- Do not refactor unrelated Workspace, repository, Worktree, or account
  behavior.

## Considered approaches

### Renderer-owned settings

Store settings in React state and `localStorage`, and call the AI endpoint
from the Renderer.

This is the smallest implementation, but it cannot satisfy the required
`userData` path, gives startup services no authoritative settings source,
and unnecessarily exposes the persisted API Key and network request
details to the Renderer.

### One main-process application-settings service

Use one versioned JSON document, one serialized settings service, typed IPC
contracts, a Renderer controller, and a main-process AI service.

This is the selected approach. It gives startup restoration, default
terminal selection, startup Fetch, the settings UI, the standalone Diff
window, and AI requests one consistent settings snapshot. It also permits
the Key to be plaintext at rest without returning the saved value to the
Renderer.

### Separate General, Git, AI, and navigation stores

Give each settings domain its own file and service.

This provides strong isolation but creates multiple load states, migration
paths, write queues, and cross-domain coordination points for a small
settings surface. It also conflicts with the required single
`app-settings.json` destination.

## Architecture

### Layer ownership

The feature follows the existing package boundaries:

- `packages/contracts` owns public DTOs, request contracts, bridge
  methods, and IPC channel names.
- `packages/application` owns settings normalization, serialized updates,
  public redaction, and AI commit-message orchestration.
- `packages/persistence-json` owns the versioned JSON repository backed by
  `AtomicJsonStore`.
- `apps/desktop/src/main` selects the concrete `userData` path, registers
  services, validates IPC input, and supplies the HTTP adapter.
- `apps/desktop/src/preload` exposes only the fixed settings and AI
  methods.
- `apps/desktop/src/renderer` owns draft form state, user feedback,
  startup coordination, and the four-section UI.

The formal `SettingsPage` must not call the filesystem, Git executable, or
remote AI endpoint directly.

### Application settings document

The canonical file is:

```text
<userData>/settings/app-settings.json
```

The first schema is conceptually:

```ts
interface AppSettingsDocumentV1 {
  schemaVersion: 1;
  general: {
    restoreLastView: boolean;
    defaultTerminalKind: ExternalTerminalKindDto | null;
  };
  appearance: {
    theme: "dark" | "light";
  };
  diff: {
    fileView: "list" | "tree";
    layout: "split" | "unified";
    wrap: boolean;
    treeDirectoriesCollapsed: boolean;
  };
  git: {
    fetchMode: "manual" | "startup";
  };
  ai: {
    enabled: boolean;
    apiUrl: string;
    model: string;
    apiKey: string;
    prompt: string;
  };
  navigation: {
    lastContentView: "workspace" | "repository";
    workspaceTab: WorkspaceTabDto;
    repositoryTab: RepositoryTabDto;
  };
  updatedAt: string;
}
```

Defaults:

- restore last view: enabled;
- default terminal: `null`, meaning choose the first currently available
  terminal until the user makes a selection;
- theme: dark;
- Diff file view: list;
- Diff layout: unified;
- Diff wrapping: disabled;
- tree directories: expanded;
- Fetch mode: manual;
- AI: disabled;
- API URL, model, and Key: empty;
- AI prompt: a bundled Chinese Conventional Commits prompt;
- last content view: Workspace overview.

The JSON repository uses `AtomicJsonStore`, validates the complete
document, supports future schema migration, and preserves malformed data
instead of overwriting it. Missing data returns defaults. The first
successful settings update creates the file.

### Public settings snapshot and Key handling

The settings load result includes a public settings snapshot plus
`storageState: "missing" | "persisted"`. The migration coordinator uses
`missing` to decide whether legacy Renderer preferences may seed the first
document; ordinary updates return `persisted`.

The public Renderer settings snapshot mirrors the document except that it
never contains the saved API Key. It exposes:

```ts
ai: {
  enabled: boolean;
  apiUrl: string;
  model: string;
  prompt: string;
  apiKeyConfigured: boolean;
}
```

Update requests are patches rather than whole-document replacements. The
main-process service serializes all patches through one write queue and
merges each patch against its latest in-memory canonical value. This
prevents the main window and standalone Diff window from overwriting each
other with stale snapshots.

AI Key rules:

- omitting `apiKey` preserves the saved Key;
- a non-empty `apiKey` replaces it;
- an empty or whitespace-only `apiKey` is rejected by the save validator;
- clearing uses a dedicated request with `confirmed: true`;
- after a successful save, the Renderer clears its Key input;
- test requests may carry a newly typed Key transiently; otherwise they
  use the saved Key;
- Key values never appear in IPC responses, diagnostic events, error
  details, or toasts.

Only the AI API Key follows this plaintext-at-rest rule. Existing HTTPS Git
account tokens continue to use `SafeStorageCredentialVault`.

## Contracts and services

### Settings contracts

Add bridge methods equivalent to:

```ts
settings.get(): Promise<GitReadResult<AppSettingsLoadDto>>;
settings.update(
  request: UpdateAppSettingsRequest
): Promise<GitReadResult<AppSettingsDto>>;
settings.clearAiApiKey(
  request: ClearAiApiKeyRequest
): Promise<GitReadResult<AppSettingsDto>>;
```

`UpdateAppSettingsRequest` accepts bounded optional patches for General,
appearance, Diff, Git, AI, and navigation fields. IPC validation rejects
unknown enum values, oversized strings, malformed URLs where applicable,
and unbounded objects.

`AppSettingsLoadDto` contains `{ settings, storageState }`; the internal
document and every update response remain authoritative after the first
successful write.

Recommended limits:

- API URL: 2,048 characters;
- model: 256 characters;
- API Key: 8,192 characters;
- prompt: 12,000 characters.

### Settings service

`AppSettingsService`:

- loads and caches the validated document;
- returns defaults when no document exists;
- redacts the Key from public snapshots;
- applies serialized field patches;
- writes through the JSON repository;
- clears the AI Key only after explicit confirmation;
- exposes an internal settings reader to the AI service;
- reports persistence failures without exposing saved content.

### AI contracts

Add bridge methods equivalent to:

```ts
ai.testConnection(
  request: TestAiConnectionRequest
): Promise<GitReadResult<AiConnectionTestResultDto>>;

ai.generateCommitMessage(
  request: GenerateAiCommitMessageRequest
): Promise<GitReadResult<AiCommitMessageDto>>;
```

The test request contains the current draft URL and model plus an optional
new Key. The generation request contains only a validated
`RepositoryTargetDto`; generation always uses the saved AI settings.

The generation result contains:

- generated message;
- staged file count;
- whether the assembled Diff input was truncated.

### AI service

`AiCommitMessageService` performs five bounded steps:

1. Read and validate the saved AI settings.
2. Resolve the requested target against the current Workspace.
3. Read the repository snapshot and select only paths whose index status is
   staged.
4. Read each selected path's staged Diff through the existing Git client,
   assemble a bounded prompt, and represent binary files with metadata
   rather than binary content.
5. Send the request through the OpenAI-compatible HTTP adapter and return
   the normalized message.

No staged path produces a `NO_STAGED_CHANGES`-style invalid-request error.
Unstaged and untracked content is never substituted.

Diff collection reuses the existing per-file Diff implementation so it
inherits literal path handling, binary detection, cancellation, and
per-command output limits. Reads use bounded concurrency. The assembled
input:

- lists all staged paths;
- includes text Diff content until a 120,000-character aggregate limit;
- marks omitted or truncated content explicitly;
- retains binary-file names and status;
- treats repository content as untrusted data rather than model
  instructions.

### OpenAI-compatible HTTP adapter

URL normalization:

- trim surrounding whitespace;
- accept only `http:` and `https:`;
- reject embedded username/password credentials and URL fragments;
- if the path already ends in `/chat/completions`, use it unchanged;
- otherwise trim trailing slashes and append `/chat/completions`;
- preserve a valid query string on a complete endpoint.

Requests use:

- `POST`;
- `Content-Type: application/json`;
- `Authorization: Bearer <key>`;
- a minimal Chat Completions body containing `model` and `messages`.

The system message combines a fixed safety prefix with the user's custom
prompt. The user message contains repository name, branch, staged paths,
and the bounded staged Diff.

The adapter:

- uses a 30-second timeout for connection tests;
- uses a 60-second timeout for generation;
- rejects response bodies above 1 MiB;
- accepts a non-empty `choices[0].message.content` string;
- trims one surrounding Markdown code fence when present;
- rejects empty or oversized generated messages;
- maps authentication, timeout, network, status-code, and response-shape
  failures to stable errors without returning provider response bodies.

Connection testing sends a minimal completion request with the configured
model and ignores the returned text. This verifies URL, authentication,
model availability, and the compatible response shape rather than merely
checking that a host is reachable.

## Renderer state and data flow

### `useAppSettings`

A new controller loads settings once and exposes:

- canonical public settings;
- editable section drafts;
- load/save/clear states;
- save, patch, and reload actions;
- persistence error and success feedback.

The Workspace hook and settings hook load in parallel. The application may
render its shell with safe defaults while loading, but startup restoration
and startup Fetch wait for both controllers to settle.

Theme and Diff preference changes outside the settings page use narrow
settings patches and update optimistically. A failed write restores the
last canonical value and shows non-secret feedback.

### Startup navigation restoration

Startup restoration runs once per Renderer lifetime after settings and
Workspace loading finish:

1. If restoration is disabled, open Workspace overview.
2. If the saved view is Workspace, restore its saved Workspace tab.
3. If the saved view is repository and the Workspace has a valid persisted
   selected target, open that target and restore its repository tab.
4. Otherwise open Workspace overview.

Normal navigation writes only `workspace` or `repository` to
`lastContentView`. Visiting Settings or Operations does not replace the
last business view. Repository and Workspace tab changes persist their
respective tab values.

The Workspace remains the owner of `selectedTarget`; the settings file does
not duplicate repository or Worktree identity.

### Startup Fetch

Startup Fetch is a Renderer-level coordinator over the existing repository
command pipeline:

1. Wait for settings and the initial Workspace to load.
2. Check that `git.fetchMode` is `startup`.
3. Capture the initial Workspace target list.
4. Submit Fetch commands only, using batches no larger than the existing
   50-target command limit.
5. Mark the startup attempt complete so Workspace events, focus refreshes,
   account reloads, and component rerenders cannot trigger it again.

If the application starts without a Workspace, the first successfully
loaded Workspace becomes the initial Workspace and receives the one
attempt. An empty target list completes the attempt without a command.

Fetch remains confirmation-free because the existing command service
classifies it as a remote-reference update. All non-Fetch repository
commands continue to require confirmation. Batch failures are visible
through the existing operation center and feedback surfaces; one failed
repository does not authorize Pull or another recovery mutation.

Both the existing manual “Fetch all” entry points and startup Fetch should
reuse one batching helper so large Workspaces behave consistently.

### Default terminal

The effective terminal is resolved as:

1. the saved terminal kind when it is currently available;
2. otherwise the first discovered terminal profile;
3. otherwise unavailable.

An unavailable saved preference is not erased. The General section shows
the fallback state, and the Activity Rail terminal tooltip identifies the
effective terminal. The Activity Rail opens that effective profile.

### Diff preferences

The existing component-local Diff controls become controlled preferences:

- file list/tree mode;
- split/unified layout where the active configuration permits it;
- line wrapping where permitted;
- initial tree-directory collapse behavior.

Repository mode continues to enforce its capability configuration. For
example, a saved split preference falls back to unified in a repository
surface that only permits unified, without overwriting the saved
preference. The General section displays the current theme and saved Diff
preferences.

## Formal settings UI

### Page layout

The page uses:

- the existing full-page Settings route;
- a page heading and concise description;
- a left card-style navigation column;
- a right stack of setting cards;
- one active section at a time;
- responsive stacking at the existing narrow desktop breakpoint.

The page navigator contains exactly four items and no placeholder or hidden
items.

### General

Cards:

1. Application behavior
   - “Remember last opened view” switch.
   - A permanent note that dangerous operations always require
     confirmation; no switch is rendered.
2. Default terminal
   - Available-profile selector.
   - Effective/fallback/unavailable status.
3. Current preferences
   - Theme.
   - Diff file view.
   - Diff layout.
   - line wrapping.
   - tree-directory initial state.

### AI Commit Message

Cards:

1. AI generation
   - enable switch;
   - API URL;
   - model;
   - masked API Key input;
   - saved-Key status;
   - prompt textarea;
   - Save AI Settings;
   - Test Connection;
   - Clear Key.
2. Behavior boundary
   - staged Diff only;
   - fills the editor only;
   - never stages, commits, or pushes.

Save validates URL, model, prompt, and Key replacement semantics. Test uses
the current draft without implicitly saving it. Clear Key opens a
confirmation dialog whose default focus is Cancel and whose backend request
also requires `confirmed: true`.

### Git

Cards:

1. Git runtime
   - version and executable;
   - availability/error state.
2. Remote-check strategy
   - Manual Fetch;
   - Check on startup;
   - exact explanation that startup behavior updates remote-tracking refs
     only and does not Pull, Merge, Rebase, or modify working-tree changes.

### Accounts and Authentication

Move the current formal account experience into this section without
weakening its contracts:

- account addition;
- HTTPS Token and system SSH;
- host-default binding;
- selected-repository binding;
- connection testing;
- removal impact and confirmed deletion;
- Credential Helper status;
- SSH Agent status;
- `.ssh/config` status;
- account loading, error, empty, and success states.

The section may split the current large page into focused internal
components, but behavior remains backed by the existing `useAccounts`
controller and account IPC.

## Commit composer integration

When saved AI settings are enabled, `DiffCommitComposer` shows a secondary
“Generate with AI” action near the message input.

The action is enabled only when:

- the selected repository target exists;
- staged count is greater than zero;
- no conflicting commit mutation or AI generation is active;
- saved URL, model, prompt, and Key are configured.

On success, the returned text replaces the commit-message field and marks
the existing controlled draft dirty. Existing push-checkbox state is not
changed. The user must still press the normal commit button, and any later
Push still follows the existing explicit commit flow.

On failure, the current commit message remains unchanged.

## Dangerous-operation invariant

No `confirmDangerous` field exists in the document, DTO, UI, or prototype.

The implementation must retain and test the authoritative backend
requirements:

- repository commands other than Fetch require confirmed preflight;
- dangerous Worktree commands require confirmed preflight;
- account deletion requires impact inspection and explicit confirmation;
- AI Key clearing requires explicit confirmation.

Renderer visibility is not the security boundary. Direct IPC calls without
the required confirmation state must still be rejected.

## Error handling

- Settings load failure: run with safe defaults, expose a persistent
  settings error, and do not overwrite malformed data.
- Settings save failure: keep the last canonical snapshot and retain form
  input so the user can retry.
- No terminal profiles: disable the Activity Rail terminal action and show
  an unavailable state.
- Startup Fetch failure: report through repository-command and operation
  feedback; do not retry automatically in the same session.
- AI disabled or incomplete: do not show an active generation path.
- No staged changes: preserve the message and show a specific error.
- AI timeout/network/authentication/provider error: preserve the message,
  expose concise guidance, and omit response bodies and secrets.
- Target changed during generation: ignore the stale result in the
  Renderer; the service validates the target before Diff collection.
- Partial or truncated Diff: include an explicit marker in the model input
  and return `truncated: true` for user feedback.

## Prototype alignment

Update `prototypes/workspace-shell/index.html` so the review fixture matches
the formal product:

- keep the left navigation and right card layout;
- expose only General, AI Commit Message, Git, and Accounts and
  Authentication;
- remove Workspace and keyboard-shortcut sections;
- remove the dangerous-confirmation switch;
- add model, saved-Key status, and Clear Key to the AI card;
- demonstrate base-URL/full-endpoint normalization in copy;
- make generated commit text depend on staged changes only;
- remove the prototype fallback to all changes;
- keep generation as a simulation and state clearly that the prototype
  does not perform a network or Git write;
- add account/authentication cards that mirror the formal account statuses
  and actions;
- show the same startup Fetch and default-terminal descriptions as the
  formal application.

The formal React application remains the source of truth for behavior.

## Migration and compatibility

- `app-settings.json` starts at schema version 1.
- A missing document uses defaults and is created on first successful
  update.
- Existing `gitnest.theme` localStorage is imported only when no persisted
  application settings document exists, then the legacy key is removed
  after a successful settings write.
- Existing per-Workspace tree-directory preference may be used as the
  initial migration source for the active Workspace. Once the application
  settings value is saved, the new service is authoritative.
- Existing open-in application preferences are outside this task and stay
  in their current storage.
- Existing account metadata, credential files, Workspace data, snapshots,
  operations, and window state keep their current locations and schemas.

## Testing

### Contracts, persistence, and IPC

- DTO and bridge type coverage for get, patch, clear Key, test, and
  generate.
- Preload whitelist tests for every new channel.
- IPC sender validation and request-size validation.
- Default document, round-trip persistence, plaintext AI Key at the
  required path, public redaction, Key preservation, Key replacement, Key
  clearing, schema rejection, atomic-write recovery, and serialized patch
  tests.

### Settings and startup

- Four and only four navigation sections render.
- Workspace/shortcut/dangerous-toggle controls do not render.
- Last Workspace and repository tabs restore correctly.
- Settings and Operations are not restored.
- Missing repository targets fall back to Workspace overview.
- Restore-disabled startup opens Workspace overview.
- Saved default terminal is used by the Activity Rail.
- Unavailable saved terminal falls back without deleting the preference.
- Startup Fetch runs exactly once after settings and Workspace load.
- Manual mode performs no startup Fetch.
- Empty Workspaces perform no Git command.
- Large Workspaces use 50-target batches.
- Startup flow never submits Pull, Merge, Rebase, Commit, Stage, or Push.

### AI

- Base URLs and complete endpoints normalize correctly.
- Invalid protocols and credential-bearing URLs are rejected.
- Test connection uses current drafts and an optional transient Key.
- Saved Keys never appear in returned DTOs or errors.
- Only staged paths are collected.
- Mixed staged/unstaged files contribute only staged Diff content.
- Binary and truncated files produce bounded metadata.
- No staged changes reject generation.
- HTTP authentication, timeout, network, non-success, oversized body, bad
  JSON, empty choices, and malformed content errors are stable and
  non-secret.
- A successful result fills the controlled commit message.
- Failure preserves the previous message.
- Generation never invokes mutation or repository-command methods.

### Existing account and safety behavior

- Current account add, bind, unbind, test, removal-impact, and deletion
  tests remain valid after component extraction.
- Direct unconfirmed dangerous IPC calls remain rejected.
- Fetch remains the only repository command without confirmation.

### Visual and build verification

- Targeted Vitest suites.
- Root typecheck.
- Desktop build.
- `git diff --check`.
- Formal Settings page visual inspection at 1440 × 900 and 1100 × 812 in
  both themes.
- Prototype inspection at the same representative sizes.
- Commit composer inspection with AI disabled, configured, loading,
  successful, and failed states.

No test may contact a real AI provider. HTTP integration tests use a local
bounded test server, and Git tests use temporary repositories.

## Acceptance criteria

The feature is complete when:

1. The formal and prototype settings pages expose exactly the four required
   sections in a left-nav/right-card layout.
2. No dangerous-confirmation preference exists, and backend confirmations
   remain mandatory.
3. Settings persist atomically to the required `app-settings.json` path.
4. The saved AI Key is plaintext in that file but absent from all public
   responses and logs.
5. Last business view and tab restoration follows the confirmed fallback
   rules.
6. The Activity Rail uses the effective saved default terminal.
7. Startup mode performs one Fetch-only pass after the initial Workspace
   load and manual mode performs none.
8. The account/authentication section retains every existing account and
   system-auth capability.
9. AI settings can save, test, replace, and clear a Key.
10. AI generation uses staged Diff only and fills the commit message
    without causing any Git mutation.
11. Targeted tests, typecheck, build, and visual inspection pass without
    overwriting the user's existing unrelated changes.

## Rollback boundary

The settings repository/service, new IPC surface, Renderer settings
controller, startup coordinator, AI service, commit-composer integration,
formal settings components, and prototype alignment form one feature
boundary.

They can be removed together while retaining the existing Workspace,
repository-command, account, credential-vault, terminal-discovery, and
window-state implementations. Existing account tokens and Workspace files
are never migrated into the new document, so rollback does not require
credential or Workspace data conversion.
