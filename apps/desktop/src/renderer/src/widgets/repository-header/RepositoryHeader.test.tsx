/** @vitest-environment jsdom */

import React, { act } from "react";
import {
  createRoot,
  type Root
} from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

import type { WorkspaceDetailsDto } from "@gitnest/contracts";

import type { ExternalApplicationController } from "../../features/external-application/useExternalApplications";
import { RepositoryHeader } from "./RepositoryHeader";

describe("RepositoryHeader", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("React", React);
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("shows and invokes Workspace Pull and Fetch actions", () => {
    const onPullWorkspace = vi.fn();
    const onFetchWorkspace = vi.fn();

    act(() => {
      root.render(
        <RepositoryHeader
          commandActive={null}
          commandCompletionVersion={0}
          commandLocked={false}
          externalApplications={externalApplications}
          inspectorOpen={false}
          refreshing={false}
          repositoryTab="overview"
          snapshots={[]}
          view="workspace"
          workspace={workspace}
          workspaceCommandBusy={false}
          workspaceRepositoryCount={2}
          workspaceTab="overview"
          onFetch={vi.fn()}
          onFetchWorkspace={onFetchWorkspace}
          onOpenOperations={vi.fn()}
          onOpenRepository={vi.fn()}
          onOpenSettings={vi.fn()}
          onOpenWorkspace={vi.fn()}
          onPull={vi.fn()}
          onPullWorkspace={onPullWorkspace}
          onPushWorkspace={vi.fn()}
          onPush={vi.fn()}
          onRefresh={vi.fn()}
          onRepositoryTabChange={vi.fn()}
          onSwitchBranch={vi.fn()}
          onToggleInspector={vi.fn()}
          onWorkspaceTabChange={vi.fn()}
        />
      );
    });

    const pull = container.querySelector<HTMLButtonElement>(
      'button[title="批量 Pull Workspace 中的全部 2 个仓库"]'
    );
    const fetch = container.querySelector<HTMLButtonElement>(
      'button[title="Fetch Workspace 中的全部 2 个仓库"]'
    );

    expect(pull?.textContent).toContain("Pull");
    expect(pull?.textContent).toContain("2");
    expect(fetch?.textContent).toContain("Fetch");
    expect(fetch?.textContent).not.toContain("Fetch 全部");
    expect(
      container.querySelector(".toolbar-divider")
    ).not.toBeNull();

    act(() => {
      pull?.click();
      fetch?.click();
    });
    expect(onPullWorkspace).toHaveBeenCalledOnce();
    expect(onFetchWorkspace).toHaveBeenCalledOnce();
  });

  it("shows repository actions without a force-push control", () => {
    act(() => {
      root.render(
        <RepositoryHeader
          commandActive={null}
          commandCompletionVersion={0}
          commandLocked={false}
          externalApplications={externalApplications}
          inspectorOpen={false}
          refreshing={false}
          repositoryTab="changes"
          snapshots={[]}
          view="repository"
          workspace={workspace}
          workspaceCommandBusy={false}
          workspaceRepositoryCount={0}
          workspaceTab="overview"
          onFetch={vi.fn()}
          onFetchWorkspace={vi.fn()}
          onOpenOperations={vi.fn()}
          onOpenRepository={vi.fn()}
          onOpenSettings={vi.fn()}
          onOpenWorkspace={vi.fn()}
          onPull={vi.fn()}
          onPullWorkspace={vi.fn()}
          onPushWorkspace={vi.fn()}
          onPush={vi.fn()}
          onRefresh={vi.fn()}
          onRepositoryTabChange={vi.fn()}
          onSwitchBranch={vi.fn()}
          onToggleInspector={vi.fn()}
          onWorkspaceTabChange={vi.fn()}
        />
      );
    });

    expect(
      container.querySelectorAll(
        ".repository-actions .toolbar-button"
      )
    ).toHaveLength(4);
  });
});

const externalApplications: ExternalApplicationController = {
  profiles: [],
  preferredProfile: undefined,
  loading: false,
  active: null,
  error: null,
  reload: async () => {},
  open: async () => true,
  openFile: async () => true,
  clearError: () => {}
};

const workspace: WorkspaceDetailsDto = {
  schemaVersion: 1,
  id: "workspace",
  name: "Workspace",
  entries: [
    {
      kind: "workspace-directory",
      id: "entry",
      displayName: "Workspace",
      path: "C:\\workspace",
      canonicalPath: "c:\\workspace",
      excludes: [],
      order: 0,
      groups: [],
      scanIssues: [],
      lastScannedAt: "2026-09-08T00:00:00.000Z"
    }
  ],
  repositories: [],
  worktrees: [],
  selectedEntryId: "entry",
  updatedAt: "2026-09-08T00:00:00.000Z"
};
