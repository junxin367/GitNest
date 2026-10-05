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
  OpenExternalApplicationRequest,
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
    vi.stubGlobal("gitnest", {
      system: {
        listExternalApplications: vi.fn(async () => ({
          ok: true,
          value: [
            { kind: "vscode", label: "Visual Studio Code" },
            { kind: "cursor", label: "Cursor" }
          ]
        })),
        openExternalApplication: vi.fn(async (request: OpenExternalApplicationRequest) => ({
          ok: true,
          value: { kind: request.kind, label: "Visual Studio Code", scope: request.context.scope }
        }))
      }
    });
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
    const onAddDirectory = vi.fn(async () => true);
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
          onAddDirectory={onAddDirectory}
          onOpenWorkspace={onOpenWorkspace}
          onRenameWorkspace={vi.fn(async () => true)}
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
    expect(container.textContent).toContain("添加目录");

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

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          "button.sidebar-add-directory"
        )
        ?.click();
    });
    expect(onAddDirectory).toHaveBeenCalledOnce();

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="重新扫描 Workspace"]'
        )
        ?.click();
    });

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

  it("indexes repository metadata and snapshots once while preserving first matches", () => {
    const targetCount = 100;
    const targets = Array.from({ length: targetCount }, (_, index) => ({
      repositoryId: `repository-${index}`,
      worktreeId: `worktree-${index}`
    }));
    const repositories = targets.map((target, index) => ({
      id: target.repositoryId,
      name: `Repository ${index}`,
      commonDir: `C:\\workspace\\repository-${index}\\.git`,
      canonicalCommonDir: `c:\\workspace\\repository-${index}\\.git`,
      primaryWorktreeId: target.worktreeId,
      worktreeIds: [target.worktreeId]
    }));
    const worktrees = targets.map((target, index) => ({
      id: target.worktreeId,
      repositoryId: target.repositoryId,
      name: `Worktree ${index}`,
      path: `C:\\workspace\\repository-${index}`,
      canonicalPath: `c:\\workspace\\repository-${index}`,
      gitDir: `C:\\workspace\\repository-${index}\\.git`,
      head: `${index}`.padStart(40, "0"),
      branch: `branch-${index}`,
      isPrimary: true,
      isBare: false,
      isDetached: false,
      isLocked: false,
      isPrunable: false
    }));
    const largeSnapshots = targets.map((target, index) =>
      createSnapshot(target, {
        branch: `snapshot-${index}`,
        unstaged: index === 0 ? 1 : 0
      })
    );
    const reads = {
      repositories: 0,
      worktrees: 0,
      snapshots: 0
    };
    const indexedWorkspace: WorkspaceDetailsDto = {
      ...workspace,
      groups: [
        {
          ...workspace.groups[0]!,
          targets
        }
      ],
      repositories: countIndexedReads(
        repositories,
        () => reads.repositories += 1
      ),
      worktrees: countIndexedReads(
        worktrees,
        () => reads.worktrees += 1
      )
    };

    renderSidebar({
      workspace: indexedWorkspace,
      snapshots: countIndexedReads(
        largeSnapshots,
        () => reads.snapshots += 1
      )
    });

    expect(
      container.querySelectorAll(".repository-row")
    ).toHaveLength(targetCount);
    expect(reads).toEqual({
      repositories: targetCount,
      worktrees: targetCount,
      snapshots: targetCount
    });

    const duplicateWorkspace: WorkspaceDetailsDto = {
      ...workspace,
      groups: [
        {
          ...workspace.groups[0]!,
          targets: [repositoryTarget]
        }
      ],
      repositories: [
        {
          ...workspace.repositories[0]!,
          name: "First repository"
        },
        {
          ...workspace.repositories[0]!,
          name: "Second repository"
        }
      ],
      worktrees: [
        {
          ...workspace.worktrees[0]!,
          name: "First worktree"
        },
        {
          ...workspace.worktrees[0]!,
          name: "Second worktree"
        }
      ]
    };
    renderSidebar({
      workspace: duplicateWorkspace,
      snapshots: [
        {
          ...snapshots[0]!,
          branch: "first-branch"
        },
        {
          ...snapshots[0]!,
          branch: "second-branch"
        }
      ]
    });

    const row = container.querySelector(".repository-row");
    expect(row?.textContent).toContain("First worktree");
    expect(row?.textContent).toContain("first-branch");
    expect(row?.textContent).not.toContain("Second worktree");
    expect(row?.textContent).not.toContain("second-branch");
  });

  async function openSidebarContextMenu(kind: "workspace" | "group" | "repository") {
    const origin = kind === "workspace"
      ? container.querySelector<HTMLButtonElement>(".workspace-root-heading")
      : kind === "group"
        ? container.querySelector<HTMLButtonElement>(".group-header")
        : [...container.querySelectorAll<HTMLButtonElement>(".repository-row")]
          .find((button) => button.textContent?.includes("GitNest Docs"));
    if (!origin) throw new Error(`Missing ${kind} context menu origin`);
    await act(async () => {
      origin.focus();
      origin.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 40, clientY: 40 }));
    });
    return origin;
  }

  it.each(["workspace", "group", "repository"] as const)(
    "focuses the first enabled action when opening the %s context menu",
    async (kind) => {
      renderSidebar({ busy: kind === "workspace" });
      await openSidebarContextMenu(kind);
      const first = document.querySelector<HTMLButtonElement>(
        '.workspace-context-menu [role="menuitem"]:not(:disabled)'
      );
      expect(first).not.toBeNull();
      expect(document.activeElement).toBe(first);
    }
  );

  it.each([
    { key: "Escape", shiftKey: false },
    { key: "Tab", shiftKey: false },
    { key: "Tab", shiftKey: true }
  ])("closes the repository context menu on $key (shift: $shiftKey) and restores its row", async ({ key, shiftKey }) => {
    renderSidebar();
    const origin = await openSidebarContextMenu("repository");
    const action = findMenuItem("Open In")!;
    act(() => action.focus());
    const event = new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
    act(() => action.dispatchEvent(event));
    expect(document.querySelector(".workspace-context-menu")).toBeNull();
    expect(document.activeElement).toBe(origin);
    expect(event.defaultPrevented).toBe(key === "Escape");
  });

  it.each([
    { kind: "workspace", action: "修改显示名称" },
    { kind: "group", action: "重命名分组" },
    { kind: "repository", action: "移出 Workspace" }
  ] as const)("returns from the $kind dialog to the context menu's original row", async ({ kind, action }) => {
    renderSidebar();
    const origin = await openSidebarContextMenu(kind);
    const menuAction = findMenuItem(action)!;
    act(() => {
      menuAction.focus();
      menuAction.click();
    });
    const dialog = document.querySelector<HTMLElement>(".gn-dialog")!;
    expect(dialog).not.toBeNull();
    expect(dialog.contains(document.activeElement)).toBe(true);
    act(() => dialog.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape", bubbles: true, cancelable: true
    })));
    expect(document.querySelector(".gn-dialog")).toBeNull();
    expect(document.activeElement).toBe(origin);
  });

  it.each([false, true])("closes both repository menus on Tab from an application (shift: %s)", async (shiftKey) => {
    renderSidebar();
    const origin = await openSidebarContextMenu("repository");
    await act(async () => findMenuItem("Open In")?.click());
    const application = document.querySelector<HTMLButtonElement>(
      '.workspace-context-open-in-submenu [role="menuitem"]'
    )!;
    expect(application).not.toBeNull();
    act(() => application.focus());
    const event = new KeyboardEvent("keydown", {
      key: "Tab", shiftKey, bubbles: true, cancelable: true
    });
    act(() => application.dispatchEvent(event));
    expect(document.querySelector(".workspace-context-menu")).toBeNull();
    expect(document.querySelector(".workspace-context-open-in-submenu")).toBeNull();
    expect(document.activeElement).toBe(origin);
    expect(event.defaultPrevented).toBe(false);
  });

  it.each(["group", "repository"] as const)(
    "dismisses the %s context menu when its target disappears from Workspace data",
    async (kind) => {
      renderSidebar();
      await openSidebarContextMenu(kind);
      if (kind === "repository") {
        act(() => findMenuItem("Open In")?.click());
      }
      const nextWorkspace = {
        ...workspace,
        groups: kind === "group" ? [] : workspace.groups.map((group) => ({
          ...group,
          targets: group.targets.filter((target) => target.repositoryId !== docsTarget.repositoryId)
        })),
        repositories: workspace.repositories.filter((repository) => repository.id !== docsTarget.repositoryId),
        worktrees: workspace.worktrees.filter((worktree) => worktree.id !== docsTarget.worktreeId)
      };
      renderSidebar({ workspace: nextWorkspace });
      expect(document.querySelector(".workspace-context-menu")).toBeNull();
      expect(document.querySelector(".workspace-context-open-in-submenu")).toBeNull();
      expect(window.gitnest.system.openExternalApplication).not.toHaveBeenCalled();
    }
  );

  it("keeps focus on an outside control when it dismisses a sidebar context menu", async () => {
    renderSidebar();
    await openSidebarContextMenu("workspace");
    const outside = container.querySelector<HTMLInputElement>('[aria-label="筛选仓库"]')!;
    act(() => {
      outside.focus();
      outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(document.querySelector(".workspace-context-menu")).toBeNull();
    expect(document.activeElement).toBe(outside);
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

  async function openRepositoryApplications(name = "GitNest Docs") {
    const repository = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".repository-row")
    ).find((button) => button.textContent?.includes(name));
    await act(async () => {
      repository?.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true, clientX: 40, clientY: 40
      }));
    });
    act(() => findMenuItem("Open In")?.click());
  }

  it("opens the right-clicked repository without selecting it or using the selected repository", async () => {
    const onSelectTarget = vi.fn();
    renderSidebar({
      workspace: { ...workspace, selectedTarget: repositoryTarget },
      onSelectTarget
    });
    await openRepositoryApplications();
    const application = findMenuItem("Visual Studio Code")!;
    expect(application).toBeDefined();
    act(() => application.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(document.querySelector(".workspace-context-open-in-submenu")).not.toBeNull();
    await act(async () => application.click());
    expect(window.gitnest.system.openExternalApplication).toHaveBeenCalledWith({
      context: { scope: "repository", target: docsTarget }, kind: "vscode"
    });
    expect(onSelectTarget).not.toHaveBeenCalled();
    expect(document.querySelector(".workspace-context-menu")).toBeNull();
  });

  it("keeps application opening available for the Workspace root repository", async () => {
    renderSidebar();
    await openRepositoryApplications("GitNest");
    await act(async () => findMenuItem("Cursor")?.click());
    expect(window.gitnest.system.openExternalApplication).toHaveBeenCalledWith({
      context: { scope: "repository", target: repositoryTarget }, kind: "cursor"
    });
  });

  it("reports a launch failure and allows retrying the same repository", async () => {
    vi.mocked(window.gitnest.system.openExternalApplication).mockResolvedValueOnce({
      ok: false, error: { code: "COMMAND_FAILED", message: "应用启动失败", details: {} }
    });
    renderSidebar();
    await openRepositoryApplications();
    await act(async () => findMenuItem("Visual Studio Code")?.click());
    expect(document.body.textContent).toContain("应用启动失败");
    expect(document.querySelector(".workspace-context-open-in-submenu")).not.toBeNull();
    await act(async () => findMenuItem("Visual Studio Code")?.click());
    expect(window.gitnest.system.openExternalApplication).toHaveBeenCalledTimes(2);
    expect(document.querySelector(".workspace-context-menu")).toBeNull();
  });

  it("returns focus from the application submenu and closes it when switching workspaces", async () => {
    renderSidebar();
    await openRepositoryApplications();
    const application = findMenuItem("Visual Studio Code")!;
    const trigger = findMenuItem("Open In")!;
    expect(document.activeElement).toBe(application);
    act(() => application.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape", bubbles: true, cancelable: true
    })));
    expect(document.querySelector(".workspace-context-open-in-submenu")).toBeNull();
    expect(document.querySelector(".workspace-context-menu")).not.toBeNull();
    expect(document.activeElement).toBe(trigger);
    act(() => trigger.dispatchEvent(new KeyboardEvent("keydown", {
      key: "ArrowRight", bubbles: true, cancelable: true
    })));
    expect(document.querySelector(".workspace-context-open-in-submenu")).not.toBeNull();
    renderSidebar({ workspace: { ...workspace, id: "other-workspace" } });
    expect(document.querySelector(".workspace-context-menu")).toBeNull();
    expect(document.querySelector(".workspace-context-open-in-submenu")).toBeNull();
    expect(window.gitnest.system.openExternalApplication).not.toHaveBeenCalled();
  });

  it("shows the empty application state without offering a launch", async () => {
    vi.mocked(window.gitnest.system.listExternalApplications).mockResolvedValue({
      ok: true, value: []
    });
    renderSidebar();
    await openRepositoryApplications();
    expect(document.body.textContent).toContain("未检测到可用应用");
    expect(findMenuItem("Visual Studio Code")).toBeUndefined();
  });

  it("focuses the repository Open In submenu after application discovery finishes", async () => {
    let finishDiscovery!: () => void;
    const discovery = new Promise<void>((resolve) => { finishDiscovery = resolve; });
    vi.mocked(window.gitnest.system.listExternalApplications).mockImplementation(async () => {
      await discovery;
      return { ok: true, value: [{ kind: "vscode", label: "Visual Studio Code" }] };
    });
    renderSidebar();
    await openRepositoryApplications();
    expect(document.querySelector(".workspace-context-open-in-submenu")?.textContent).toContain("正在检测可用应用");
    expect(findMenuItem("Visual Studio Code")).toBeUndefined();
    await act(async () => finishDiscovery());
    const application = findMenuItem("Visual Studio Code");
    expect(application).toBeDefined();
    expect(document.activeElement).toBe(application);
    expect(window.gitnest.system.openExternalApplication).not.toHaveBeenCalled();
  });

  it("keeps the new repository application menu open when an old launch finishes", async () => {
    let finishLaunch!: () => void;
    const launching = new Promise<void>((resolve) => { finishLaunch = resolve; });
    vi.mocked(window.gitnest.system.openExternalApplication).mockImplementationOnce(async (request) => {
      await launching;
      return {
        ok: true,
        value: { kind: request.kind, label: "Visual Studio Code", scope: request.context.scope }
      };
    });
    renderSidebar();
    await openRepositoryApplications();
    act(() => findMenuItem("Visual Studio Code")?.click());
    expect(window.gitnest.system.openExternalApplication).toHaveBeenCalledWith({
      context: { scope: "repository", target: docsTarget }, kind: "vscode"
    });
    await openRepositoryApplications("GitNest");
    const nextMenu = document.querySelector(".workspace-context-open-in-submenu");
    expect(nextMenu).not.toBeNull();
    await act(async () => finishLaunch());
    expect(document.querySelector(".workspace-context-open-in-submenu")).toBe(nextMenu);
    expect(document.activeElement).toBe(findMenuItem("Visual Studio Code"));
    await act(async () => findMenuItem("Cursor")?.click());
    expect(window.gitnest.system.openExternalApplication).toHaveBeenLastCalledWith({
      context: { scope: "repository", target: repositoryTarget }, kind: "cursor"
    });
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

  const dialogActions = ["group", "rename", "tapd", "remove", "delete", "switcher-delete"] as const;

  function openSidebarDialog(action: typeof dialogActions[number]) {
    if (action === "group" || action === "remove") {
      const selector = action === "group" ? ".group-header" : ".repository-row";
      const button = [...container.querySelectorAll<HTMLButtonElement>(selector)]
        .find((candidate) => action === "group" || candidate.textContent?.includes("GitNest Docs"));
      act(() => button?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })));
      act(() => findMenuItem(action === "group" ? "重命名分组" : "移出 Workspace")?.click());
    } else if (action === "switcher-delete") {
      act(() => container.querySelector<HTMLButtonElement>('[aria-label="切换 Workspace"]')?.click());
      act(() => findMenuItem("删除当前 Workspace")?.click());
    } else {
      openWorkspaceContextMenu();
      act(() => findMenuItem(
        action === "rename" ? "修改显示名称" : action === "tapd" ? "设置 TAPD 关键字" : "删除 Workspace"
      )?.click());
    }
    expect(document.querySelector(".gn-dialog")).not.toBeNull();
  }

  function workspaceChoices() {
    return [
      { id: workspace.id, name: workspace.name, updatedAt: workspace.updatedAt },
      { id: "workspace-other", name: "Other", updatedAt: workspace.updatedAt }
    ];
  }

  it.each(dialogActions.flatMap((action) =>
    (["Escape", "backdrop"] as const).map((dismissal) => ({ action, dismissal }))
  ))("cancels the $action dialog with $dismissal without submitting", ({ action, dismissal }) => {
    const onRenameWorkspace = vi.fn(async () => true);
    const onRemoveRepository = vi.fn(async () => true);
    const onDeleteWorkspace = vi.fn(async () => true);
    renderSidebar({ workspaces: workspaceChoices(), onRenameWorkspace, onRemoveRepository, onDeleteWorkspace });
    openSidebarDialog(action);
    act(() => {
      if (dismissal === "backdrop") {
        document.querySelector<HTMLElement>(".gn-dialog-backdrop")?.click();
      } else {
        document.querySelector(".gn-dialog")?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
        );
      }
    });
    expect(document.querySelector(".gn-dialog")).toBeNull();
    expect(onRenameWorkspace).not.toHaveBeenCalled();
    expect(onRemoveRepository).not.toHaveBeenCalled();
    expect(onDeleteWorkspace).not.toHaveBeenCalled();
  });

  it.each(["rename", "remove", "delete", "switcher-delete"] as const)(
    "shows a failed %s action inside its dialog and allows retry",
    async (action) => {
      const request = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      const onClearFeedback = vi.fn();
      const props = {
        workspaces: workspaceChoices(), onClearFeedback,
        onRenameWorkspace: request, onRemoveRepository: request, onDeleteWorkspace: request
      };
      renderSidebar(props);
      openSidebarDialog(action);
      if (action === "rename") {
        act(() => setInputValue(document.querySelector("#workspace-name"), "重试名称"));
      }
      const confirm = () => {
        const button = [...document.querySelectorAll<HTMLButtonElement>(".gn-dialog button")]
          .find((candidate) => candidate.textContent?.includes(
            action === "rename" ? "保存名称" : action === "remove" ? "确认移出" : "确认删除"
          ));
        expect(button).toBeDefined();
        button?.click();
      };
      await act(async () => confirm());
      renderSidebar({
        ...props,
        error: { code: "SCAN_FAILED", message: "配置文件无法写入，请检查目录权限", details: {} }
      });
      expect(document.querySelector(".gn-dialog [role='alert']")?.textContent).toContain("配置文件无法写入");
      expect(onClearFeedback).toHaveBeenCalledOnce();
      if (action === "rename") {
        expect(document.querySelector<HTMLInputElement>("#workspace-name")?.value).toBe("重试名称");
      }
      await act(async () => confirm());
      expect(request).toHaveBeenCalledTimes(2);
      expect(document.querySelector(".gn-dialog")).toBeNull();
      expect(document.querySelector('[role="alert"]')).toBeNull();
    }
  );

  it.each(["rename", "remove", "delete", "switcher-delete"] as const)(
    "keeps a submitting %s dialog open on Escape and permits cancellation after failure",
    async (action) => {
      let finish!: (accepted: boolean) => void;
      const request = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
      renderSidebar({
        workspaces: workspaceChoices(),
        onRenameWorkspace: request, onRemoveRepository: request, onDeleteWorkspace: request
      });
      openSidebarDialog(action);
      if (action === "rename") {
        act(() => setInputValue(document.querySelector("#workspace-name"), "待保存名称"));
      }
      const confirm = [...document.querySelectorAll<HTMLButtonElement>(".gn-dialog button")]
        .find((candidate) => candidate.textContent?.includes(
          action === "rename" ? "保存名称" : action === "remove" ? "确认移出" : "确认删除"
        ));
      act(() => confirm?.click());
      expect(request).toHaveBeenCalledOnce();
      const escape = () => document.querySelector(".gn-dialog")?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
      );
      act(escape);
      expect(document.querySelector(".gn-dialog")).not.toBeNull();
      await act(async () => finish(false));
      act(escape);
      expect(document.querySelector(".gn-dialog")).toBeNull();
    }
  );

  it("keeps an already loaded empty Workspace visible while rescanning", () => {
    renderSidebar({
      busy: true,
      workspace: {
        ...workspace,
        repositories: [],
        worktrees: [],
        groups: []
      }
    });

    expect(container.querySelector(".gn-skeleton-surface")).toBeNull();
    expect(container.textContent).toContain("尚未发现仓库");
  });

  it("shows a skeleton only while the initial Workspace is unavailable", () => {
    renderSidebar({ busy: true, workspace: null });
    expect(container.querySelector(".gn-skeleton-surface")).not.toBeNull();
  });

  it("replaces the transition skeleton immediately when an empty Workspace arrives", () => {
    renderSidebar();
    renderSidebar({ busy: true, workspace: null });
    expect(container.querySelector(".gn-skeleton-surface")).not.toBeNull();
    renderSidebar({
      workspace: {
        ...workspace,
        id: "empty-workspace",
        repositories: [],
        worktrees: [],
        groups: []
      }
    });
    expect(container.querySelector(".gn-skeleton-surface")).toBeNull();
    expect(container.textContent).toContain("尚未发现仓库");
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
          onAddDirectory={vi.fn(async () => true)}
          onOpenWorkspace={vi.fn()}
          onRenameWorkspace={vi.fn(async () => true)}
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

function countIndexedReads<Value>(
  values: Value[],
  onRead: () => void
): Value[] {
  return new Proxy(values, {
    get(target, property, receiver) {
      if (
        typeof property === "string" &&
        /^\d+$/.test(property)
      ) {
        onRead();
      }
      return Reflect.get(target, property, receiver);
    }
  });
}

function createSnapshot(
  target: RepositoryTargetDto,
  overrides: Partial<RepositoryStatusSnapshotDto> = {}
): RepositoryStatusSnapshotDto {
  return {
    ...target,
    branch: "main",
    head: "a".repeat(40),
    upstream: "origin/main",
    ahead: 0,
    behind: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
    refreshPending: false,
    stale: false,
    refreshedAt: "2026-10-05T00:00:00.000Z",
    ...overrides
  };
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
