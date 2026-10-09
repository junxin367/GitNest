/** @vitest-environment jsdom */

import React, { act, useLayoutEffect } from "react";
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
import { BranchSwitchDialog } from "./BranchSwitchDialog";
import { useRepositoryBranchOptions } from "../../entities/repository/useRepositoryBranchOptions";

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
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps loaded empty branches visible while refreshing and resets when switching repositories", async () => {
    vi.useFakeTimers();
    const getBranches = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: { branches: [] } })
      .mockImplementation(() => new Promise(() => undefined));
    vi.stubGlobal("gitnest", { repository: { getBranches, cancelQuery: vi.fn() } });
    let reload: () => Promise<void> = async () => undefined;
    function Harness({ repositoryId }: { repositoryId: string }) {
      const options = useRepositoryBranchOptions({ repositoryId, worktreeId: "main" }, true);
      reload = options.reload;
      return <BranchSwitchDialog branches={options.branches} currentBranch="main"
        errorMessage={options.error?.message ?? null} loading={options.loading}
        hasLoaded={options.hasLoaded} isDisabled={() => false} onCancel={vi.fn()}
        onRetry={options.reload} onSelect={vi.fn()} />;
    }
    await act(async () => { root.render(<Harness repositoryId="one" />); });
    expect(document.body.textContent).toContain("暂无可切换的本地分支");
    act(() => { void reload(); vi.advanceTimersByTime(200); });
    expect(document.body.querySelector(".branch-switch-list-skeleton")).toBeNull();
    act(() => { root.render(<Harness repositoryId="two" />); });
    act(() => { vi.advanceTimersByTime(200); });
    expect(document.body.querySelector(".branch-switch-list-skeleton")).not.toBeNull();
  });

  it("reports loading before effects on initial load, target switch, and re-enabling", async () => {
    const getBranches = vi.fn().mockImplementation(() => new Promise(() => undefined));
    vi.stubGlobal("gitnest", { repository: { getBranches, cancelQuery: vi.fn() } });
    const frames: Array<{ loading: boolean; hasLoaded: boolean }> = [];
    function Harness({ repositoryId, enabled = true }: { repositoryId: string; enabled?: boolean }) {
      const options = useRepositoryBranchOptions({ repositoryId, worktreeId: "main" }, enabled);
      useLayoutEffect(() => {
        frames.push({ loading: options.loading, hasLoaded: options.hasLoaded });
      });
      return null;
    }

    await act(async () => { root.render(<Harness repositoryId="one" />); });
    expect(frames[0]).toEqual({ loading: true, hasLoaded: false });
    frames.length = 0;
    await act(async () => { root.render(<Harness repositoryId="two" />); });
    expect(frames[0]).toEqual({ loading: true, hasLoaded: false });
    await act(async () => { root.render(<Harness repositoryId="two" enabled={false} />); });
    expect(frames.at(-1)?.loading).toBe(false);
    frames.length = 0;
    await act(async () => { root.render(<Harness repositoryId="two" />); });
    expect(frames[0]).toEqual({ loading: true, hasLoaded: false });
  });

  it.each([
    ["ArrowDown", "feature/first", "feature/last"],
    ["ArrowUp", "feature/last", "feature/first"],
    ["Home", "feature/last", "feature/first"],
    ["End", "feature/first", "feature/last"]
  ])("navigates selectable branches with %s before activation", (key, from, to) => {
    const onSelect = vi.fn();
    act(() => root.render(
      <BranchSwitchDialog
        branches={["main", "feature/first", "occupied", "feature/last"].map(
          (name) => ({
            fullName: `refs/heads/${name}`,
            name,
            head: "abc",
            current: name === "main",
            remote: false
          })
        )}
        currentBranch="main"
        errorMessage={null}
        loading={false}
        hasLoaded
        isDisabled={(branch) => branch.name === "occupied"}
        onCancel={vi.fn()}
        onRetry={vi.fn()}
        onSelect={onSelect}
      />
    ));
    const option = (name: string) => Array.from(
      document.querySelectorAll<HTMLButtonElement>(".branch-switch-option")
    ).find((candidate) => candidate.querySelector("strong")?.textContent === name)!;
    act(() => option(from!).focus());
    const navigationKey = new KeyboardEvent("keydown", {
      key, bubbles: true, cancelable: true
    });

    act(() => option(from!).dispatchEvent(navigationKey));

    expect(document.activeElement).toBe(option(to!));
    expect(navigationKey.defaultPrevented).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
    expect(option("main").disabled).toBe(true);
    expect(option("occupied").disabled).toBe(true);
    act(() => (document.activeElement as HTMLButtonElement).click());
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(to);
  });

  it("shows a retryable refresh error alongside already loaded branches", async () => {
    const retry = vi.fn();
    await act(async () => {
      root.render(<BranchSwitchDialog
        branches={[{ fullName: "refs/heads/feature", name: "feature", head: "abc", current: false, remote: false }]}
        currentBranch="main"
        errorMessage="读取分支失败"
        loading={false}
        hasLoaded
        isDisabled={() => false}
        onCancel={vi.fn()}
        onRetry={retry}
        onSelect={vi.fn()}
      />);
    });
    expect(document.body.textContent).toContain("feature");
    expect(document.body.textContent).toContain("读取分支失败");
    const button = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button"))
      .find(candidate => candidate.textContent?.trim() === "重试");
    expect(button).toBeDefined();
    await act(async () => { button!.click(); });
    expect(retry).toHaveBeenCalledOnce();
    expect(document.body.querySelector(".branch-switch-list-skeleton")).toBeNull();
  });

  it.each(["error", "notice"] as const)(
    "shows and dismisses repository command %s feedback in every Workspace tab",
    (kind) => {
      vi.useFakeTimers();
      const clearFeedback = vi.fn();
      const feedback = {
        error: kind === "error"
          ? { code: "INVALID_REQUEST" as const, message: "No remote configured.", details: {} }
          : null,
        notice: kind === "notice" ? "Fetch completed." : null,
        clearFeedback
      };
      const render = (
        view: "workspace" | "repository",
        workspaceTab: "overview" | "repositories" | "activity" | "worktrees"
      ) => act(() => {
        root.render(<RepositoryHeader
          commandActive={null} commandCompletionVersion={0} commandLocked={false}
          commandFeedback={feedback}
          externalApplications={externalApplications} inspectorOpen={false}
          refreshing={false} repositoryTab="overview" snapshots={[]} view={view}
          workspace={multiEntryWorkspace} workspaceCommandBusy={false} workspaceTab={workspaceTab}
          onFetch={vi.fn()} onFetchWorkspace={vi.fn()} onOpenOperations={vi.fn()}
          onOpenRepository={vi.fn()} onOpenSettings={vi.fn()} onOpenWorkspace={vi.fn()}
          onPull={vi.fn()} onPullWorkspace={vi.fn()} onPushWorkspace={vi.fn()} onPush={vi.fn()}
          onRefresh={vi.fn()} onRepositoryTabChange={vi.fn()} onSwitchBranch={vi.fn()}
          onToggleInspector={vi.fn()} onWorkspaceTabChange={vi.fn()}
        />);
      });
      for (const tab of ["overview", "repositories", "activity", "worktrees"] as const) {
        render("workspace", tab);
        expect(document.body.querySelectorAll(".toast")).toHaveLength(1);
        expect(document.body.querySelector(".toast")?.textContent).toContain(
          feedback.error?.message ?? feedback.notice
        );
      }
      act(() => {
        document.body.querySelector<HTMLButtonElement>(
          'button[aria-label="关闭仓库操作提示"]'
        )?.click();
      });
      expect(clearFeedback).toHaveBeenCalledOnce();
      render("repository", "overview");
      expect(document.body.querySelector(".toast")).toBeNull();
    }
  );

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
          workspace={multiEntryWorkspace}
          workspaceCommandBusy={false}
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
      'button[title="批量 Pull Workspace 中的全部 3 个仓库"]'
    );
    const fetch = container.querySelector<HTMLButtonElement>(
      'button[title="Fetch Workspace 中的全部 3 个仓库"]'
    );

    expect(pull?.textContent).toContain("Pull");
    expect(pull?.querySelector(".toolbar-count")).toBeNull();
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

  it("counts every entry in the current Workspace regardless of selection", () => {
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

    expect(tabCount("仓库")).toBe("3");
    expect(tabCount("活动")).toBe("3");
    expect(tabCount("Worktrees")).toBe("4");
    expect(container.querySelector(".context-summary strong")?.textContent)
      .toBe("Multi-repository Workspace");
  });

  it("shows a branch-count badge only after a positive count arrives", async () => {
    let resolveBranches!: (value: unknown) => void;
    const getBranches = vi.fn(() => new Promise((resolve) => {
      resolveBranches = resolve;
    }));
    vi.stubGlobal("gitnest", { repository: { getBranches, cancelQuery: vi.fn() } });
    await act(async () => root.render(
      <RepositoryHeader
        commandActive={null} commandCompletionVersion={0} commandLocked={false}
        externalApplications={externalApplications} inspectorOpen={false}
        refreshing={false} repositoryTab="changes" snapshots={[]} view="repository"
        workspace={repositoryWorkspace} workspaceCommandBusy={false} workspaceTab="overview"
        onFetch={vi.fn()} onFetchWorkspace={vi.fn()} onOpenOperations={vi.fn()}
        onOpenRepository={vi.fn()} onOpenSettings={vi.fn()} onOpenWorkspace={vi.fn()}
        onPull={vi.fn()} onPullWorkspace={vi.fn()} onPushWorkspace={vi.fn()} onPush={vi.fn()}
        onRefresh={vi.fn()} onRepositoryTabChange={vi.fn()} onSwitchBranch={vi.fn()}
        onToggleInspector={vi.fn()} onWorkspaceTabChange={vi.fn()}
      />
    ));
    const tab = Array.from(container.querySelectorAll('[role="tab"]'))
      .find((node) => node.textContent?.startsWith("分支"))!;
    expect(tab.querySelector(".tab-count")).toBeNull();
    await act(async () => resolveBranches({
      ok: true,
      value: {
        branches: Array.from({ length: 123 }, (_, index) => ({
          name: `branch-${index}`, fullName: `refs/heads/branch-${index}`,
          head: "abc", current: false, remote: false
        }))
      }
    }));
    const slot = tab.querySelector(".tab-count")!;
    expect(slot).not.toBeNull();
    expect(slot.hasAttribute("data-empty")).toBe(false);
    expect(slot.hasAttribute("aria-hidden")).toBe(false);
    expect(slot.textContent).toBe("123");
  });

  it.each([0, 4])("shows a Pull badge only for local behind status (%i)", (behind) => {
    const target = repositoryWorkspace.selectedTarget!;
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
          snapshots={[
            {
              ...target,
              head: "head",
              ahead: 0,
              behind,
              staged: 0,
              unstaged: 0,
              untracked: 0,
              conflicted: 0,
              refreshPending: false,
              stale: false,
              refreshedAt: "2026-09-22T00:00:00.000Z"
            },
            {
              repositoryId: "another-workspace-repository",
              worktreeId: "another-workspace-worktree",
              head: "foreign",
              ahead: 0,
              behind: 10,
              staged: 0,
              unstaged: 0,
              untracked: 0,
              conflicted: 0,
              refreshPending: false,
              stale: false,
              refreshedAt: "2026-09-22T00:00:00.000Z"
            }
          ]}
          view="workspace"
          workspace={repositoryWorkspace}
          workspaceCommandBusy={false}
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
    const badge = container.querySelector(
      'button[title="批量 Pull Workspace 中的全部 1 个仓库"] .toolbar-count'
    );
    expect(badge?.textContent ?? null).toBe(behind > 0 ? "1" : null);
  });

  it("shows repository actions without a force-push control", () => {
    const profile = { kind: "vscode" as const, label: "Visual Studio Code" };
    const open = vi.fn(async () => true);
    const onOpenManagement = vi.fn();
    act(() => {
      root.render(
        <RepositoryHeader
          commandActive={null}
          commandCompletionVersion={0}
          commandLocked={false}
          externalApplications={{
            ...externalApplications,
            profiles: [profile],
            preferredProfile: profile,
            open
          }}
          inspectorOpen={false}
          refreshing={false}
          repositoryTab="changes"
          snapshots={[]}
          view="repository"
          workspace={repositoryWorkspace}
          workspaceCommandBusy={false}
          workspaceTab="overview"
          onFetch={vi.fn()}
          onFetchWorkspace={vi.fn()}
          onOpenOperations={vi.fn()}
          onOpenRepository={vi.fn()}
          onOpenSettings={vi.fn()}
          onOpenManagement={onOpenManagement}
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
    expect(container.textContent).not.toContain("远程与标签");
    expect(onOpenManagement).not.toHaveBeenCalled();

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
    const openWorkspace = container.querySelector<HTMLButtonElement>(
      '[aria-label="使用 Visual Studio Code 打开Workspace 根目录"]'
    );
    expect(openWorkspace).not.toBeNull();
    act(() => openWorkspace?.click());
    expect(open).toHaveBeenCalledWith("vscode");
  });

  function createOpenInApplications(): ExternalApplicationController {
    const profile = { kind: "vscode" as const, label: "Visual Studio Code" };
    return {
      ...externalApplications,
      profiles: [profile, { kind: "cursor", label: "Cursor" }],
      preferredProfile: profile,
      reload: vi.fn(async () => undefined)
    };
  }

  function renderOpenIn(applications = createOpenInApplications()) {
    act(() => root.render(<OpenInControl applications={applications} scope="workspace" />));
    return container.querySelector<HTMLButtonElement>('[aria-label="选择打开方式"]')!;
  }

  it("focuses the first Open In choice after its hidden positioning surface becomes visible", () => {
    const focus = HTMLElement.prototype.focus;
    vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (
      this: HTMLElement,
      options?: FocusOptions
    ) {
      // Match Chromium, which refuses focus inside the first hidden positioning frame.
      if (this.closest<HTMLElement>(".menu-surface")?.style.visibility === "hidden") return;
      focus.call(this, options);
    });
    const trigger = renderOpenIn();
    act(() => trigger.focus());
    act(() => trigger.click());
    const first = document.querySelector<HTMLButtonElement>('.open-in-menu [role="menuitem"]');
    expect(first).not.toBeNull();
    expect(document.activeElement).toBe(first);
  });

  it.each([
    { key: "Escape", shiftKey: false },
    { key: "Tab", shiftKey: false },
    { key: "Tab", shiftKey: true }
  ])("closes Open In on $key (shift: $shiftKey) and returns focus to its trigger", ({ key, shiftKey }) => {
    const trigger = renderOpenIn();
    act(() => trigger.click());
    const first = document.querySelector<HTMLButtonElement>('.open-in-menu [role="menuitem"]')!;
    act(() => first.focus());
    const event = new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
    act(() => first.dispatchEvent(event));
    expect(document.querySelector(".open-in-menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(event.defaultPrevented).toBe(key === "Escape");
  });

  it("opens Open In with ArrowDown and focuses its choices without reloading an already open menu", () => {
    const applications = createOpenInApplications();
    const trigger = renderOpenIn(applications);
    act(() => trigger.focus());
    const event = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
    act(() => trigger.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    const first = document.querySelector<HTMLButtonElement>('.open-in-menu [role="menuitem"]');
    expect(first).not.toBeNull();
    expect(document.activeElement).toBe(first);
    expect(applications.reload).toHaveBeenCalledOnce();
    act(() => trigger.dispatchEvent(new KeyboardEvent("keydown", {
      key: "ArrowDown", bubbles: true, cancelable: true
    })));
    expect(applications.reload).toHaveBeenCalledOnce();
  });

  it("keeps cached Open In choices keyboard reachable while their availability is refreshing", () => {
    const applications = createOpenInApplications();
    const trigger = renderOpenIn(applications);
    act(() => trigger.click());
    renderOpenIn({ ...applications, loading: true });
    expect(trigger.disabled).toBe(false);
    const first = document.querySelector<HTMLButtonElement>('.open-in-menu [role="menuitem"]')!;
    act(() => first.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape", bubbles: true, cancelable: true
    })));
    expect(document.activeElement).toBe(trigger);
    act(() => trigger.dispatchEvent(new KeyboardEvent("keydown", {
      key: "ArrowDown", bubbles: true, cancelable: true
    })));
    expect(document.querySelector(".open-in-menu")).not.toBeNull();
    expect(applications.reload).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(document.querySelector('.open-in-menu [role="menuitem"]'));
  });

  it("does not steal focus from an outside control when a pointer closes Open In", () => {
    const trigger = renderOpenIn();
    const outside = document.createElement("button");
    container.append(outside);
    act(() => trigger.click());
    act(() => {
      outside.focus();
      outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(document.querySelector(".open-in-menu")).toBeNull();
    expect(document.activeElement).toBe(outside);
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
  schemaVersion: 2,
  id: "workspace",
  name: "Workspace",
  path: "C:\\workspace",
  canonicalPath: "c:\\workspace",
  excludes: [],
  groups: [],
  scanIssues: [],
  lastScannedAt: "2026-09-08T00:00:00.000Z",
  repositories: [],
  worktrees: [],
  updatedAt: "2026-09-08T00:00:00.000Z"
};

const repositoryWorkspace: WorkspaceDetailsDto = {
  ...workspace,
  groups: [
    {
      id: "group",
      name: "原/根仓库",
      targets: [
        {
          repositoryId: "repository",
          worktreeId: "worktree"
        }
      ],
      collapsed: false
    }
  ],
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
  schemaVersion: 2,
  id: "multi-repository-workspace",
  name: "Multi-repository Workspace",
  path: "C:\\workspace",
  canonicalPath: "c:\\workspace",
  excludes: [],
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
    },
    {
      id: "group-c",
      name: "Workspace C",
      collapsed: false,
      targets: [
        {
          repositoryId: "repository-c",
          worktreeId: "worktree-c"
        }
      ]
    }
  ],
  scanIssues: [],
  lastScannedAt: "2026-09-16T00:00:00.000Z",
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
  selectedTarget: {
    repositoryId: "repository-a",
    worktreeId: "worktree-a"
  },
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
