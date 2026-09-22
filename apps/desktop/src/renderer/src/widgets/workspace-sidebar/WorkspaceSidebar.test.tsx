/** @vitest-environment jsdom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

import type {
  RepositoryStatusSnapshotDto,
  RepositoryTargetDto,
  WorkspaceDetailsDto
} from "@gitnest/contracts";

import { WorkspaceSidebar } from "./WorkspaceSidebar";
import { readTapdKeywordPreference } from "./tapdKeywordPreferences";

describe("WorkspaceSidebar", () => {
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
    document
      .querySelectorAll(
        ".menu-surface, .gn-dialog-backdrop"
      )
      .forEach((element) => element.remove());
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("matches the prototype Workspace root and toggles its repository tree", () => {
    const onRefresh = vi.fn();
    const onRescan = vi.fn(async () => true);
    const onOpenWorkspace = vi.fn();

    act(() => {
      root.render(
        <WorkspaceSidebar
          activeView="repository"
          busy={false}
          sidebarHidden={false}
          snapshots={snapshots}
          workspace={workspace}
          workspaces={[
            {
              id: workspace.id,
              name: workspace.name,
              updatedAt: workspace.updatedAt
            }
          ]}
          onCreateWorkspace={vi.fn(async () => true)}
          onDeleteWorkspace={vi.fn(async () => true)}
          onOpenWorkspace={onOpenWorkspace}
          onRenameWorkspace={vi.fn(async () => true)}
          onRefresh={onRefresh}
          onRemoveRepository={vi.fn(async () => true)}
          onRescan={onRescan}
          onSelectTarget={vi.fn()}
          onSetGroupCollapsed={vi.fn(async () => undefined)}
          onSwitchWorkspace={vi.fn(async () => true)}
        />
      );
    });

    expect(container.textContent).toContain("核心仓库");
    expect(container.textContent).toContain("GitNest");
    expect(container.textContent).toContain("GitNest Docs");
    expect(container.textContent).not.toContain("添加目录");

    const workspaceOverview =
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="打开 GitNest Workspace 概览"]'
      );
    expect(workspaceOverview?.textContent).toContain(
      "GitNest Workspace"
    );
    expect(workspaceOverview?.textContent).toContain(
      "E:\\code\\GitNest"
    );
    expect(workspaceOverview?.textContent).not.toContain(
      "Workspace 概览"
    );
    expect(workspaceOverview?.getAttribute("aria-current")).toBe(
      null
    );
    expect(workspaceOverview?.getAttribute("aria-expanded")).toBe(
      "true"
    );
    act(() => workspaceOverview?.click());
    expect(onOpenWorkspace).toHaveBeenCalledOnce();
    expect(workspaceOverview?.getAttribute("aria-expanded")).toBe(
      "false"
    );
    expect(
      container.querySelector(".workspace-root")?.classList
    ).toContain("collapsed");
    expect(
      container
        .querySelector("#workspace-root-body")
        ?.getAttribute("aria-hidden")
    ).toBe("true");

    const directory = container.querySelector<HTMLElement>(
      "[data-workspace-directory]"
    );
    expect(directory?.textContent).toContain("E:\\code\\GitNest");
    expect(directory?.getAttribute("title")).toBe(
      "E:\\code\\GitNest"
    );

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="刷新 Workspace 状态"]'
        )
        ?.click();
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="重新扫描 Workspace"]'
        )
        ?.click();
    });

    expect(onRefresh).toHaveBeenCalledOnce();
    expect(onRescan).toHaveBeenCalledOnce();
  });

  it("marks the Workspace root as current on Workspace pages", () => {
    renderSidebar({ activeView: "workspace" });

    expect(
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="打开 GitNest Workspace 概览"]'
        )
        ?.getAttribute("aria-current")
    ).toBe("page");
  });

  it("uses the shared sidebar search input with one clear control", () => {
    renderSidebar();

    const search = container.querySelector<HTMLInputElement>(
      'input[aria-label="筛选仓库"]'
    );
    expect(search).not.toBeNull();
    expect(search?.type).toBe("text");
    expect(search?.classList).toContain("gn-input__control");
    expect(
      search
        ?.closest(".gn-input")
        ?.getAttribute("data-size")
    ).toBe("small");
    expect(
      container.querySelectorAll(
        'button[aria-label="清除仓库筛选"]'
      )
    ).toHaveLength(0);

    act(() => setInputValue(search, "GitNest"));

    const clearControls = container.querySelectorAll(
      'button[aria-label="清除仓库筛选"]'
    );
    expect(clearControls).toHaveLength(1);

    act(() => {
      (clearControls[0] as HTMLButtonElement).click();
    });

    expect(search?.value).toBe("");
    expect(
      container.querySelectorAll(
        'button[aria-label="清除仓库筛选"]'
      )
    ).toHaveLength(0);
  });

  it("collapses a top-level group by its group identifier", () => {
    const onSetGroupCollapsed = vi.fn(
      async () => undefined
    );

    renderSidebar({ onSetGroupCollapsed });

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="核心仓库"]'
        )
        ?.click();
    });

    expect(onSetGroupCollapsed).toHaveBeenCalledWith(
      "group-core",
      true
    );
  });

  it("filters the direct repository rows to targets with local changes", () => {
    renderSidebar();

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="仓库筛选菜单"]'
        )
        ?.click();
    });
    const changedOnly = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]'
      )
    ).find((button) =>
      button.textContent?.includes("变更仓库")
    );
    expect(changedOnly).toBeDefined();

    act(() => changedOnly?.click());

    expect(container.textContent).toContain("GitNest");
    expect(container.textContent).not.toContain("GitNest Docs");
  });

  it("renames a top-level group from its context menu", async () => {
    renderSidebar();

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="核心仓库"]'
        )
        ?.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            clientX: 40,
            clientY: 40
          })
        );
    });

    const rename = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]'
      )
    ).find((button) =>
      button.textContent?.includes("重命名分组")
    );
    expect(rename).toBeDefined();
    act(() => rename?.click());

    const input = document.querySelector<HTMLInputElement>(
      "#workspace-group-display-name"
    );
    expect(input).not.toBeNull();
    act(() => setInputValue(input, "产品仓库"));

    const submit = document.querySelector<HTMLButtonElement>(
      'button[form="workspace-group-rename-form"]'
    );
    await act(async () => {
      submit?.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("产品仓库");
  });

  it("exposes Workspace actions from the root context menu", () => {
    renderSidebar();

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="打开 GitNest Workspace 概览"]'
        )
        ?.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            clientX: 40,
            clientY: 40
          })
        );
    });

    const actions = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]'
      )
    );
    expect(actions.map((button) => button.textContent)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("修改显示名称"),
        expect.stringContaining("设置 TAPD 关键字"),
        expect.stringContaining("重新扫描"),
        expect.stringContaining("删除 Workspace")
      ])
    );
    expect(
      actions.find((button) =>
        button.textContent?.includes("删除 Workspace")
      )?.disabled
    ).toBe(true);
  });

  it("omits TAPD settings from the Workspace switcher", () => {
    renderSidebar();

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="切换 Workspace"]'
        )
        ?.click();
    });

    const actions = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"], [role="menuitemradio"]'
      )
    ).map((button) => button.textContent);

    expect(actions).toEqual(
      expect.arrayContaining([
        expect.stringContaining("新建 Workspace"),
        expect.stringContaining("删除当前 Workspace")
      ])
    );
    expect(actions).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining("设置 TAPD 关键字")
      ])
    );
  });

  it("stores the TAPD keyword from the Workspace root context menu", async () => {
    renderSidebar();

    openWorkspaceContextMenu();
    const openTapd = findMenuItem("设置 TAPD 关键字");
    expect(openTapd).toBeDefined();
    act(() => openTapd?.click());

    const input = document.querySelector<HTMLInputElement>(
      "#workspace-tapd-keyword"
    );
    expect(input).not.toBeNull();
    act(() => setInputValue(input, " TAPD-2468 "));

    const submit = document.querySelector<HTMLButtonElement>(
      'button[form="workspace-tapd-keyword-form"]'
    );
    await act(async () => {
      submit?.click();
      await Promise.resolve();
    });

    expect(
      readTapdKeywordPreference(
        localStorage,
        workspace.id
      )
    ).toBe("TAPD-2468");
  });

  it("renames the Workspace from its root context menu", async () => {
    const onRenameWorkspace = vi.fn(async () => true);
    renderSidebar({ onRenameWorkspace });

    openWorkspaceContextMenu();
    const rename = findMenuItem("修改显示名称");
    expect(rename).toBeDefined();
    act(() => rename?.click());

    const input = document.querySelector<HTMLInputElement>(
      "#workspace-name"
    );
    expect(input?.value).toBe("GitNest Workspace");
    act(() => setInputValue(input, "产品工作区"));

    const submit = document.querySelector<HTMLButtonElement>(
      'button[form="workspace-rename-form"]'
    );
    await act(async () => {
      submit?.click();
      await Promise.resolve();
    });

    expect(onRenameWorkspace).toHaveBeenCalledWith(
      workspace.id,
      "产品工作区"
    );
  });

  it("removes the repository selected from its context menu", async () => {
    const onRemoveRepository = vi.fn(async () => true);
    renderSidebar({ onRemoveRepository });

    const repository = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".repository-row"
      )
    ).find((button) =>
      button.textContent?.includes("GitNest Docs")
    );

    act(() => {
      repository?.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          clientX: 40,
          clientY: 40
        })
      );
    });

    const remove = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]'
      )
    ).find((button) =>
      button.textContent?.includes("移出 Workspace")
    );
    expect(remove).toBeDefined();

    act(() => remove?.click());
    const confirm = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button")
    ).find((button) =>
      button.textContent?.includes("确认移出")
    );
    expect(confirm).toBeDefined();

    await act(async () => {
      confirm?.click();
      await Promise.resolve();
    });

    expect(onRemoveRepository).toHaveBeenCalledWith(
      docsTarget
    );
  });

  it("does not offer to remove the Workspace root repository", () => {
    const onRemoveRepository = vi.fn(async () => true);
    renderSidebar({ onRemoveRepository });

    const repository = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".repository-row"
      )
    ).find((button) =>
      button.textContent?.includes("GitNest")
    );

    act(() => {
      repository?.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          clientX: 40,
          clientY: 40
        })
      );
    });

    const rootRepository = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]'
      )
    ).find((button) =>
      button.textContent?.includes("Workspace 根仓库")
    );

    expect(rootRepository?.disabled).toBe(true);
    expect(onRemoveRepository).not.toHaveBeenCalled();
  });

  function renderSidebar(
    overrides: Partial<
      React.ComponentProps<typeof WorkspaceSidebar>
    > = {}
  ) {
    act(() => {
      root.render(
        <WorkspaceSidebar
          activeView="repository"
          busy={false}
          sidebarHidden={false}
          snapshots={snapshots}
          workspace={workspace}
          workspaces={[
            {
              id: workspace.id,
              name: workspace.name,
              updatedAt: workspace.updatedAt
            }
          ]}
          onCreateWorkspace={vi.fn(async () => true)}
          onDeleteWorkspace={vi.fn(async () => true)}
          onOpenWorkspace={vi.fn()}
          onRenameWorkspace={vi.fn(async () => true)}
          onRefresh={vi.fn()}
          onRemoveRepository={vi.fn(async () => true)}
          onRescan={vi.fn(async () => true)}
          onSelectTarget={vi.fn()}
          onSetGroupCollapsed={vi.fn(async () => undefined)}
          onSwitchWorkspace={vi.fn(async () => true)}
          {...overrides}
        />
      );
    });
  }

  function openWorkspaceContextMenu() {
    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="打开 GitNest Workspace 概览"]'
        )
        ?.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            clientX: 40,
            clientY: 40
          })
        );
    });
  }

  function findMenuItem(label: string) {
    return Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]'
      )
    ).find((button) => button.textContent?.includes(label));
  }
});

function setInputValue(
  input: HTMLInputElement | null,
  value: string
) {
  if (!input) {
    return;
  }
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(
    new Event("input", { bubbles: true })
  );
}

const repositoryTarget: RepositoryTargetDto = {
  repositoryId: "repository-gitnest",
  worktreeId: "worktree-gitnest"
};

const docsTarget: RepositoryTargetDto = {
  repositoryId: "repository-docs",
  worktreeId: "worktree-docs"
};

const workspace: WorkspaceDetailsDto = {
  schemaVersion: 2,
  id: "workspace-gitnest",
  name: "GitNest Workspace",
  path: "E:\\code\\GitNest",
  canonicalPath: "e:\\code\\gitnest",
  excludes: [],
  groups: [
    {
      id: "group-core",
      name: "核心仓库",
      targets: [repositoryTarget, docsTarget],
      collapsed: false
    }
  ],
  scanIssues: [],
  lastScannedAt: "2026-09-22T08:00:00.000Z",
  repositories: [
    {
      id: "repository-gitnest",
      name: "GitNest",
      commonDir: "E:\\code\\GitNest\\.git",
      canonicalCommonDir: "e:\\code\\gitnest\\.git",
      primaryWorktreeId: "worktree-gitnest",
      worktreeIds: ["worktree-gitnest"]
    },
    {
      id: "repository-docs",
      name: "GitNest Docs",
      commonDir: "E:\\code\\GitNest\\docs\\.git",
      canonicalCommonDir: "e:\\code\\gitnest\\docs\\.git",
      primaryWorktreeId: "worktree-docs",
      worktreeIds: ["worktree-docs"]
    }
  ],
  worktrees: [
    {
      id: "worktree-gitnest",
      repositoryId: "repository-gitnest",
      name: "GitNest",
      path: "E:\\code\\GitNest",
      canonicalPath: "e:\\code\\gitnest",
      gitDir: "E:\\code\\GitNest\\.git",
      head: "1111111",
      branch: "main",
      isPrimary: true,
      isBare: false,
      isDetached: false,
      isLocked: false,
      isPrunable: false
    },
    {
      id: "worktree-docs",
      repositoryId: "repository-docs",
      name: "GitNest Docs",
      path: "E:\\code\\GitNest\\docs",
      canonicalPath: "e:\\code\\gitnest\\docs",
      gitDir: "E:\\code\\GitNest\\docs\\.git",
      head: "2222222",
      branch: "docs",
      isPrimary: true,
      isBare: false,
      isDetached: false,
      isLocked: false,
      isPrunable: false
    }
  ],
  selectedTarget: repositoryTarget,
  updatedAt: "2026-09-22T08:00:00.000Z"
};

const snapshots: RepositoryStatusSnapshotDto[] = [
  {
    ...repositoryTarget,
    branch: "main",
    head: "1111111",
    upstream: "origin/main",
    ahead: 0,
    behind: 0,
    staged: 0,
    unstaged: 1,
    untracked: 0,
    conflicted: 0,
    refreshPending: false,
    stale: false,
    refreshedAt: "2026-09-22T08:00:00.000Z"
  },
  {
    ...docsTarget,
    branch: "docs",
    head: "2222222",
    upstream: "origin/docs",
    ahead: 0,
    behind: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
    refreshPending: false,
    stale: false,
    refreshedAt: "2026-09-22T08:00:00.000Z"
  }
];
