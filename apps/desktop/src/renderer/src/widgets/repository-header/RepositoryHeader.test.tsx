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
import { OpenInControl } from "./OpenInControl";
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

  it("scopes Workspace tab counts to the selected entry", () => {
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
          workspace={multiEntryWorkspace}
          workspaceCommandBusy={false}
          workspaceRepositoryCount={2}
          workspaceTab="repositories"
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

    const tabCount = (label: string) =>
      Array.from(
        container.querySelectorAll<HTMLButtonElement>(
          '.context-tabs [role="tab"]'
        )
      )
        .find((tab) => tab.textContent?.includes(label))
        ?.querySelector(".tab-count")?.textContent;

    expect(tabCount("仓库")).toBe("2");
    expect(tabCount("活动")).toBe("2");
    expect(tabCount("Worktrees")).toBe("3");
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
          workspace={repositoryWorkspace}
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

    const actionGroup = container.querySelector(
      ".repository-header-action-group"
    );
    const actionGroupChildren = Array.from(
      actionGroup?.children ?? []
    );
    expect(actionGroupChildren[0]?.classList).toContain(
      "toolbar-divider"
    );
    expect(actionGroupChildren[1]?.classList).toContain(
      "header-branch-switcher"
    );
    expect(actionGroupChildren[2]?.classList).toContain(
      "open-in-control"
    );
  });

  it("keeps the open-in menu open for internal scrolling and closes it for page scrolling", () => {
    const preferredProfile = {
      kind: "vscode" as const,
      label: "Visual Studio Code"
    };
    const applications: ExternalApplicationController = {
      ...externalApplications,
      profiles: [
        preferredProfile,
        {
          kind: "cursor",
          label: "Cursor"
        }
      ],
      preferredProfile,
      reload: vi.fn(async () => undefined)
    };

    act(() => {
      root.render(
        <OpenInControl
          applications={applications}
          scope="repository"
        />
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="选择打开方式"]'
    );
    act(() => {
      trigger?.click();
    });

    const menu = document.querySelector<HTMLDivElement>(
      ".open-in-menu"
    );
    expect(menu).not.toBeNull();
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");

    act(() => {
      menu?.dispatchEvent(new Event("scroll"));
    });

    expect(document.querySelector(".open-in-menu")).toBe(menu);
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");

    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });

    expect(document.querySelector(".open-in-menu")).toBeNull();
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
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

const repositoryWorkspace: WorkspaceDetailsDto = {
  ...workspace,
  repositories: [
    {
      id: "repository",
      name: "core",
      commonDir: "C:\\workspace\\.git",
      canonicalCommonDir: "c:\\workspace\\.git",
      primaryWorktreeId: "worktree",
      worktreeIds: ["worktree"]
    }
  ],
  worktrees: [
    {
      id: "worktree",
      repositoryId: "repository",
      name: "core",
      path: "C:\\workspace",
      canonicalPath: "c:\\workspace",
      head: "1234567890abcdef",
      branch: "main",
      isPrimary: true,
      isBare: false,
      isDetached: false,
      isLocked: false,
      isPrunable: false
    }
  ],
  selectedTarget: {
    repositoryId: "repository",
    worktreeId: "worktree"
  }
};

const multiEntryWorkspace: WorkspaceDetailsDto = {
  schemaVersion: 1,
  id: "multi-entry-workspace",
  name: "Multi-entry Workspace",
  entries: [
    {
      id: "entry-a",
      displayName: "Workspace A",
      path: "C:\\workspace-a",
      canonicalPath: "c:\\workspace-a",
      excludes: [],
      order: 0,
      groups: [
        {
          id: "group-a",
          name: "Workspace A",
          collapsed: false,
          targets: [
            {
              repositoryId: "repository-a",
              worktreeId: "worktree-a"
            },
            {
              repositoryId: "repository-a",
              worktreeId: "worktree-a-linked"
            },
            {
              repositoryId: "repository-b",
              worktreeId: "worktree-b"
            }
          ]
        }
      ],
      scanIssues: [],
      lastScannedAt: "2026-09-16T00:00:00.000Z",
      kind: "workspace-directory"
    },
    {
      id: "entry-c",
      displayName: "Workspace C",
      path: "C:\\workspace-c",
      canonicalPath: "c:\\workspace-c",
      excludes: [],
      order: 1,
      groups: [],
      scanIssues: [],
      lastScannedAt: "2026-09-16T00:00:00.000Z",
      kind: "standalone-repository",
      target: {
        repositoryId: "repository-c",
        worktreeId: "worktree-c"
      }
    }
  ],
  repositories: [
    {
      id: "repository-a",
      name: "Repository A",
      commonDir: "C:\\repository-a\\.git",
      canonicalCommonDir: "c:\\repository-a\\.git",
      primaryWorktreeId: "worktree-a",
      worktreeIds: ["worktree-a", "worktree-a-linked"]
    },
    {
      id: "repository-b",
      name: "Repository B",
      commonDir: "C:\\repository-b\\.git",
      canonicalCommonDir: "c:\\repository-b\\.git",
      primaryWorktreeId: "worktree-b",
      worktreeIds: ["worktree-b"]
    },
    {
      id: "repository-c",
      name: "Repository C",
      commonDir: "C:\\repository-c\\.git",
      canonicalCommonDir: "c:\\repository-c\\.git",
      primaryWorktreeId: "worktree-c",
      worktreeIds: ["worktree-c"]
    }
  ],
  worktrees: [
    createWorktree("repository-a", "worktree-a"),
    createWorktree("repository-a", "worktree-a-linked"),
    createWorktree("repository-b", "worktree-b"),
    createWorktree("repository-c", "worktree-c")
  ],
  selectedEntryId: "entry-a",
  updatedAt: "2026-09-16T00:00:00.000Z"
};

function createWorktree(repositoryId: string, id: string) {
  return {
    id,
    repositoryId,
    name: id,
    path: `C:\\${id}`,
    canonicalPath: `c:\\${id}`,
    head: "1234567890abcdef",
    branch: "main",
    isPrimary: id === `worktree-${repositoryId.slice(-1)}`,
    isBare: false,
    isDetached: false,
    isLocked: false,
    isPrunable: false
  };
}
