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
  GitNestBridge,
  RepositoryCommitDiffDto,
  RepositoryCommitDto,
  RepositoryMediaPreviewDto,
  RepositoryTargetDto
} from "@gitnest/contracts";
import { createDefaultAppSettings } from "@gitnest/contracts";

import { RepositoryCommitDetail, RepositoryPage } from "./RepositoryPage";
import { RepositoryCommitDetailBreadcrumb } from "./RepositoryHistory";
import { RepositoryHistory } from "./RepositoryHistory";
import { RepositoryOverview } from "./RepositoryOverview";
import { RepositoryBranches } from "./RepositoryBranches";
import { RepositoryChanges } from "./RepositoryChanges";
import { useRepositoryDetails, type RepositoryDetailsController } from "../../entities/repository/useRepositoryDetails";

(globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;

const TARGET: RepositoryTargetDto = {
  repositoryId: "repository-a",
  worktreeId: "worktree-a"
};
const COMMIT_HASH = "a".repeat(40);
const COMMIT: RepositoryCommitDto["commit"] = {
  hash: COMMIT_HASH,
  shortHash: COMMIT_HASH.slice(0, 7),
  authorName: "June",
  authorEmail: "june@example.com",
  authoredAt: "2026-09-16T08:00:00.000Z",
  committerName: "June",
  committerEmail: "june@example.com",
  committedAt: "2026-09-16T08:00:00.000Z",
  subject: "feat: show commit files",
  body: "Expose changed files in commit details.",
  parentHashes: ["b".repeat(40)],
  refs: ["HEAD -> main"],
  files: [
    {
      path: "src/App.tsx",
      additions: 4,
      deletions: 2,
      binary: false
    },
    {
      path: "assets/logo.png",
      binary: true
    }
  ],
  additions: 4,
  deletions: 2
};

describe("RepositoryCommitDetail", () => {
  let container: HTMLDivElement;
  let root: Root;
  let createObjectUrlDescriptor:
    | PropertyDescriptor
    | undefined;
  let revokeObjectUrlDescriptor:
    | PropertyDescriptor
    | undefined;

  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.stubGlobal(
      "requestAnimationFrame",
      (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      }
    );
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn()
    });
    Object.defineProperty(
      HTMLElement.prototype,
      "scrollIntoView",
      {
        configurable: true,
        value: vi.fn()
      }
    );
    createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(
      URL,
      "createObjectURL"
    );
    revokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(
      URL,
      "revokeObjectURL"
    );
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:commit-media-preview")
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn()
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    if (createObjectUrlDescriptor) {
      Object.defineProperty(
        URL,
        "createObjectURL",
        createObjectUrlDescriptor
      );
    } else {
      Reflect.deleteProperty(URL, "createObjectURL");
    }
    if (revokeObjectUrlDescriptor) {
      Object.defineProperty(
        URL,
        "revokeObjectURL",
        revokeObjectUrlDescriptor
      );
    } else {
      Reflect.deleteProperty(URL, "revokeObjectURL");
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function renderBranches(
    request: React.ComponentProps<typeof RepositoryBranches>["commands"]["request"],
    target = TARGET,
    busy = false,
    current = false
  ) {
    root.render(
      <RepositoryBranches target={target} worktreePath="E:/repo" snapshot={undefined}
        controller={{
          branches: { target, branches: [{ name: "feature/draft", fullName: "refs/heads/feature/draft", remote: false, current }] },
          loading: { branches: false }, error: null
        } as RepositoryDetailsController}
        commands={{
          active: null, busy, preflight: null, error: null, notice: null,
          completionVersion: 0, request, confirm: async () => false,
          dismissPreflight: vi.fn(), cancelOperation: async () => false, clearFeedback: vi.fn()
        }} />
    );
  }

  function editBranchInput(selector: string, value: string) {
    const input = container.querySelector<HTMLInputElement>(selector);
    if (!input) throw new Error(`Branch input not found: ${selector}`);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function startBranchRename() {
    act(() => findButtonByLabel(container, "打开 feature/draft 操作").click());
    act(() => findButtonByText(document.body, "重命名").click());
  }

  it.each([false, true])("focuses an enabled branch action after opening and restores the trigger on Escape (current: %s)", (current) => {
    const nativeFocus = HTMLElement.prototype.focus;
    vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
      if (getComputedStyle(this).visibility !== "hidden") {
        nativeFocus.call(this, options);
      }
    });
    const request = vi.fn(async () => false);
    act(() => renderBranches(request, TARGET, false, current));
    const trigger = findButtonByLabel(container, "打开 feature/draft 操作");
    trigger.focus();
    act(() => trigger.click());
    const expected = findButtonByText(document.body, current ? "重命名" : "切换");
    expect(document.activeElement).toBe(expected);
    act(() => expected.dispatchEvent(new KeyboardEvent("keydown", {
      key: "End", bubbles: true, cancelable: true
    })));
    expect(document.activeElement).toBe(findButtonByText(document.body, current ? "重命名" : "删除"));
    act(() => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape", bubbles: true, cancelable: true
    })));
    expect(document.querySelector(".branch-row-floating-menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(request).not.toHaveBeenCalled();
  });

  it.each(["create", "rename", "menu"] as const)(
    "closes the old branch %s controls when switching repository targets",
    (mode) => {
      const request = vi.fn(async () => false);
      act(() => renderBranches(request));
      if (mode === "create") {
        act(() => findButtonByText(container, "新建分支").click());
        act(() => editBranchInput("#new-branch-name", "feature/old-repository"));
      } else if (mode === "rename") {
        startBranchRename();
        act(() => editBranchInput('[aria-label="重命名 feature/draft"]', "feature/old-repository"));
      } else {
        act(() => findButtonByLabel(container, "打开 feature/draft 操作").click());
      }
      act(() => renderBranches(request, { repositoryId: "repository-b", worktreeId: "worktree-b" }));
      expect(container.querySelector("#new-branch-name")).toBeNull();
      expect(container.querySelector('[aria-label="重命名 feature/draft"]')).toBeNull();
      expect(document.body.querySelector('[role="menu"]')).toBeNull();
      expect(request).not.toHaveBeenCalled();
    }
  );

  it.each(["create", "rename"] as const)(
    "preserves a newer %s draft when the previous request is accepted",
    async (mode) => {
      const pending = deferred<boolean>();
      const request = vi.fn(() => pending.promise);
      act(() => renderBranches(request));
      if (mode === "create") {
        act(() => findButtonByText(container, "新建分支").click());
      } else {
        startBranchRename();
      }
      const selector = mode === "create" ? "#new-branch-name" : '[aria-label="重命名 feature/draft"]';
      act(() => editBranchInput(selector, "feature/submitted"));
      act(() => findButtonByText(container, mode === "create" ? "创建" : "保存").click());
      expect(request).toHaveBeenCalledTimes(1);
      act(() => renderBranches(request, TARGET, true));
      expect(findButtonByText(container, mode === "create" ? "创建" : "保存").disabled).toBe(true);
      act(() => editBranchInput(selector, "feature/next-draft"));
      await act(async () => { pending.resolve(true); });
      expect(container.querySelector<HTMLInputElement>(selector)?.value).toBe("feature/next-draft");
    }
  );

  it("preserves a reopened create form after the previous request is accepted", async () => {
    const pending = deferred<boolean>();
    act(() => renderBranches(vi.fn(() => pending.promise)));
    act(() => findButtonByText(container, "新建分支").click());
    act(() => editBranchInput("#new-branch-name", "feature/submitted"));
    act(() => findButtonByText(container, "创建").click());
    act(() => findButtonByText(container, "收起").click());
    act(() => findButtonByText(container, "新建分支").click());
    await act(async () => { pending.resolve(true); });
    expect(container.querySelector<HTMLInputElement>("#new-branch-name")?.value).toBe("feature/submitted");
  });

  it.each(["create", "rename"] as const)(
    "keeps the %s draft on rejection and closes it after a successful retry",
    async (mode) => {
      const request = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      act(() => renderBranches(request));
      if (mode === "create") {
        act(() => findButtonByText(container, "新建分支").click());
      } else {
        startBranchRename();
      }
      const selector = mode === "create" ? "#new-branch-name" : '[aria-label="重命名 feature/draft"]';
      act(() => editBranchInput(selector, "feature/retry"));
      await act(async () => findButtonByText(container, mode === "create" ? "创建" : "保存").click());
      expect(container.querySelector<HTMLInputElement>(selector)?.value).toBe("feature/retry");
      await act(async () => findButtonByText(container, mode === "create" ? "创建" : "保存").click());
      expect(container.querySelector(selector)).toBeNull();
      expect(request).toHaveBeenCalledTimes(2);
    }
  );

  function renderHistory(
    target = TARGET,
    selectHistoryScope = vi.fn(),
    currentBranch = "feature/source"
  ) {
    const controller = {
      historyScope: null,
      historyDetailOpen: false,
      selectedCommitHash: null,
      commit: null,
      history: {
        target,
        page: { commits: [
          { ...COMMIT, subject: "first visible commit" },
          { ...COMMIT, hash: "c".repeat(40), shortHash: "ccccccc", subject: "second visible commit" }
        ] }
      },
      branches: {
        target,
        branches: [
          { name: currentBranch, fullName: `refs/heads/${currentBranch}`, current: true, remote: false },
          { name: "base", fullName: "refs/heads/base", current: false, remote: false }
        ]
      },
      loading: { history: false, branches: false, commit: false },
      error: null,
      selectHistoryScope,
      selectCommit: vi.fn(),
      loadMoreHistory: vi.fn()
    } as unknown as RepositoryDetailsController;
    root.render(<RepositoryHistory branch={currentBranch} controller={controller}
      onCopyCommitId={vi.fn(async () => undefined)}
      repositoryKey={`${target.repositoryId}:${target.worktreeId}`} target={target} />);
  }

  function editHistoryFilter(value: string) {
    const input = container.querySelector<HTMLInputElement>('[aria-label="筛选提交历史"]');
    if (!input) throw new Error("History filter was not rendered.");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  it("focuses the history branch search only after its menu becomes visible", () => {
    const nativeFocus = HTMLElement.prototype.focus;
    vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
      if (getComputedStyle(this).visibility !== "hidden") {
        nativeFocus.call(this, options);
      }
    });
    act(() => renderHistory());
    const trigger = container.querySelector<HTMLButtonElement>(".history-ref-trigger")!;
    trigger.focus();
    act(() => trigger.click());
    const input = document.querySelector<HTMLInputElement>('[aria-label="搜索查看分支"]')!;
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it.each([{ isComposing: true }, { keyCode: 229 }])(
    "keeps the history branch search open when Escape cancels composition (%j)",
    (composition) => {
      const onChange = vi.fn();
      act(() => renderHistory(TARGET, onChange, "main"));
      const trigger = container.querySelector<HTMLButtonElement>(".history-ref-trigger")!;
      act(() => trigger.click());
      const input = document.querySelector<HTMLInputElement>('[aria-label="搜索查看分支"]')!;
      input.focus();
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "base");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      const event = new KeyboardEvent("keydown", {
        key: "Escape", bubbles: true, cancelable: true, ...composition
      });
      act(() => input.dispatchEvent(event));
      expect(document.querySelector(".history-ref-menu")).not.toBeNull();
      expect(document.activeElement).toBe(input);
      expect(input.value).toBe("base");
      expect(event.defaultPrevented).toBe(false);
      expect(onChange).not.toHaveBeenCalled();
      act(() => input.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Escape", bubbles: true, cancelable: true
      })));
      expect(document.querySelector(".history-ref-menu")).toBeNull();
      expect(document.activeElement).toBe(trigger);
    }
  );

  it("restores the history filter trigger after Escape clears and closes the input", () => {
    act(() => renderHistory());
    const trigger = findButtonByText(container, "筛选");
    act(() => trigger.click());
    act(() => editHistoryFilter("first"));
    const input = container.querySelector<HTMLInputElement>('[aria-label="筛选提交历史"]')!;
    expect(document.activeElement).toBe(input);
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape", bubbles: true, cancelable: true
    })));
    expect(container.querySelector('[aria-label="筛选提交历史"]')).toBeNull();
    expect(container.querySelectorAll(".commit-row")).toHaveLength(2);
    expect(document.activeElement).toBe(trigger);
  });

  it.each([{ isComposing: true }, { keyCode: 229 }])(
    "preserves history filtering when Escape cancels an input method candidate (%j)",
    (composition) => {
      act(() => renderHistory());
      act(() => findButtonByText(container, "筛选").click());
      act(() => editHistoryFilter("first"));
      const input = container.querySelector<HTMLInputElement>('[aria-label="筛选提交历史"]')!;
      const event = new KeyboardEvent("keydown", {
        key: "Escape", bubbles: true, cancelable: true, ...composition
      });
      act(() => input.dispatchEvent(event));
      expect(container.querySelector('[aria-label="筛选提交历史"]')).toBe(input);
      expect(input.value).toBe("first");
      expect(document.activeElement).toBe(input);
      expect(event.defaultPrevented).toBe(false);
    }
  );

  it("restores the full history list when the filter button closes its input", () => {
    act(() => renderHistory());
    act(() => findButtonByText(container, "筛选").click());
    act(() => editHistoryFilter("first"));
    expect(container.querySelectorAll(".commit-row")).toHaveLength(1);
    act(() => findButtonByText(container, "筛选").click());
    expect(container.querySelector('[aria-label="筛选提交历史"]')).toBeNull();
    expect(container.querySelectorAll(".commit-row")).toHaveLength(2);
    act(() => findButtonByText(container, "筛选").click());
    expect(container.querySelector<HTMLInputElement>('[aria-label="筛选提交历史"]')?.value).toBe("");
  });

  it("clears history filtering when switching repositories with the same HEAD scope", async () => {
    installBridge({
      getHistory: vi.fn(async ({ target }) => ({
        ok: true as const,
        value: {
          target,
          page: { commits: [
            { ...COMMIT, subject: "first visible commit" },
            { ...COMMIT, hash: "c".repeat(40), shortHash: "ccccccc", subject: "second visible commit" }
          ] }
        }
      })),
      getBranches: vi.fn(async ({ target }) => ({
        ok: true as const, value: { target, branches: [] }
      }))
    });
    function Harness({ target }: { target: RepositoryTargetDto }) {
      const controller = useRepositoryDetails(target, "history");
      return <RepositoryHistory branch="main" controller={controller}
        onCopyCommitId={vi.fn(async () => undefined)}
        repositoryKey={`${target.repositoryId}:${target.worktreeId}`} target={target} />;
    }
    await act(async () => root.render(<Harness target={TARGET} />));
    act(() => findButtonByText(container, "筛选").click());
    act(() => editHistoryFilter("first"));
    expect(container.querySelectorAll(".commit-row")).toHaveLength(1);
    await act(async () => root.render(
      <Harness target={{ repositoryId: "history-b", worktreeId: "history-b-main" }} />
    ));
    expect(container.querySelector('[aria-label="筛选提交历史"]')).toBeNull();
    expect(container.querySelectorAll(".commit-row")).toHaveLength(2);
  });

  it("preserves the visible history filter during a same-repository refresh", () => {
    act(() => renderHistory());
    act(() => findButtonByText(container, "筛选").click());
    act(() => editHistoryFilter("first"));
    act(() => renderHistory());
    expect(container.querySelector<HTMLInputElement>('[aria-label="筛选提交历史"]')?.value).toBe("first");
    expect(container.querySelectorAll(".commit-row")).toHaveLength(1);
  });

  it.each(["overview", "branches", "history"] as const)(
    "keeps loaded empty %s content visible while refreshing",
    async (tab) => {
      const pendingHistory = deferred<Awaited<ReturnType<GitNestBridge["repository"]["getHistory"]>>>();
      const pendingBranches = deferred<Awaited<ReturnType<GitNestBridge["repository"]["getBranches"]>>>();
      installBridge({
        getHistory: vi.fn().mockResolvedValueOnce({
          ok: true, value: { target: TARGET, page: { commits: [] } }
        }).mockReturnValue(pendingHistory.promise),
        getBranches: vi.fn().mockResolvedValueOnce({
          ok: true, value: { target: TARGET, branches: [] }
        }).mockReturnValue(pendingBranches.promise)
      });
      let controller: RepositoryDetailsController | undefined;
      const committedSkeletonStates: boolean[] = [];
      function Harness() {
        controller = useRepositoryDetails(TARGET, tab);
        React.useLayoutEffect(() => {
          committedSkeletonStates.push(Boolean(container.querySelector(".gn-skeleton")));
        });
        if (tab === "overview") {
          return <RepositoryOverview controller={controller} directoryOpening={false}
            onCopyCommitId={async () => undefined} onOpenDirectory={vi.fn()} onOpenTab={vi.fn()}
            snapshot={undefined} worktreeCount={1} repositoryName="Repository" repositoryPath="E:/repo" />;
        }
        if (tab === "history") {
          return <RepositoryHistory branch="main" controller={controller}
            onCopyCommitId={async () => undefined} repositoryKey={`${TARGET.repositoryId}:${TARGET.worktreeId}`}
            target={TARGET} />;
        }
        return <RepositoryBranches controller={controller} snapshot={undefined} target={TARGET}
          worktreePath="E:/repo" commands={{
            active: null, busy: false, preflight: null, error: null, notice: null,
            completionVersion: 0, request: async () => false, confirm: async () => false,
            dismissPreflight: vi.fn(), cancelOperation: async () => false, clearFeedback: vi.fn()
          }} />;
      }
      await act(async () => { root.render(<Harness />); });
      expect(committedSkeletonStates[0]).toBe(true);
      expect(container.querySelector(".gn-skeleton")).toBeNull();
      const content = container.textContent;
      let refreshing: Promise<void> | undefined;
      act(() => { refreshing = controller?.reload(tab); });
      expect(container.querySelector(".gn-skeleton")).toBeNull();
      expect(container.textContent).toBe(content);
      await act(async () => {
        pendingHistory.resolve({ ok: true, value: { target: TARGET, page: { commits: [] } } });
        pendingBranches.resolve({ ok: true, value: { target: TARGET, branches: [] } });
        await refreshing;
      });
    }
  );

  it("replaces history rows when switching refs and exits the skeleton on failure", async () => {
    const nextHistory = deferred<Awaited<ReturnType<GitNestBridge["repository"]["getHistory"]>>>();
    installBridge({
      getHistory: vi.fn().mockResolvedValueOnce({
        ok: true, value: { target: TARGET, page: { commits: [] } }
      }).mockReturnValue(nextHistory.promise),
      getBranches: vi.fn(async () => ({
        ok: true as const, value: { target: TARGET, branches: [] }
      }))
    });
    let controller: RepositoryDetailsController | undefined;
    function Harness() {
      controller = useRepositoryDetails(TARGET, "history");
      return <RepositoryHistory branch="main" controller={controller}
        onCopyCommitId={async () => undefined}
        repositoryKey={`${TARGET.repositoryId}:${TARGET.worktreeId}`} target={TARGET} />;
    }
    await act(async () => { root.render(<Harness />); });
    let selecting: Promise<void> | undefined;
    act(() => {
      selecting = controller?.selectHistoryScope({ kind: "ref", ref: "refs/heads/develop" });
    });
    expect(container.querySelector(".repository-history-skeleton")).toBeNull();
    expect(container.querySelector(".repository-history-content-skeleton")).not.toBeNull();
    await act(async () => {
      nextHistory.resolve({
        ok: false,
        error: { code: "COMMAND_FAILED", message: "所选引用已删除", details: {} }
      });
      await selecting;
    });
    expect(container.querySelector(".gn-skeleton")).toBeNull();
    expect(container.textContent).toContain("所选引用已删除");
  });

  it("stops the changes skeleton after an initial read is cancelled", async () => {
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    const pending = deferred<Awaited<ReturnType<GitNestBridge["repository"]["getChanges"]>>>();
    installBridge({ getChanges: vi.fn(() => pending.promise) });
    function Harness() {
      const controller = useRepositoryDetails(TARGET, "changes");
      const props = {
        controller, target: TARGET, workspaceId: "cancelled-changes",
        appSettings: { settings: createDefaultAppSettings() },
        commands: { busy: false, active: null }, mutations: { active: null },
        externalApplications: { profiles: [] }, commitMessage: "",
        aiGenerating: false, pushAfterCommit: false,
        onCommitMessageChange: vi.fn(), onGenerateAi: vi.fn(),
        onPushAfterCommitChange: vi.fn(), onCommitted: vi.fn()
      } as unknown as React.ComponentProps<typeof RepositoryChanges>;
      return <RepositoryChanges {...props} />;
    }
    await act(async () => { root.render(<Harness />); });
    expect(container.querySelector(".gn-skeleton")).not.toBeNull();
    await act(async () => {
      pending.resolve({ ok: false, error: { code: "COMMAND_CANCELLED", message: "查询已取消", details: {} } });
    });
    expect(container.querySelector(".gn-skeleton")).toBeNull();
  });

  it("shares browsing preferences across a repository's worktrees and workspaces while isolating other repositories", async () => {
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    installBridge({
      getChanges: vi.fn(async ({ target }) => ({
        ok: true as const,
        value: {
          target,
          snapshot: {
            branch: "main", head: "head", ahead: 0, behind: 0,
            staged: 0, unstaged: 1, untracked: 0, conflicted: 0,
            refreshedAt: "2026-10-05T00:00:00.000Z",
            changes: [{
              path: "src/app.ts", kind: "ordinary" as const,
              indexStatus: ".", worktreeStatus: "M"
            }]
          }
        }
      }))
    });
    const settings = createDefaultAppSettings();
    settings.repositoryFileBrowsing[TARGET.repositoryId] = {
      fileView: "tree", treeDirectoriesCollapsed: true
    };
    const update = vi.fn(async () => true);
    function Harness({ target, workspaceId }: {
      target: RepositoryTargetDto; workspaceId: string;
    }) {
      const controller = useRepositoryDetails(target, "changes");
      const props = {
        controller, target, workspaceId,
        appSettings: { settings, update },
        commands: { busy: false, active: null }, mutations: { active: null },
        externalApplications: { profiles: [] }, commitMessage: "",
        aiGenerating: false, pushAfterCommit: false,
        onCommitMessageChange: vi.fn(), onGenerateAi: vi.fn(),
        onPushAfterCommitChange: vi.fn(), onCommitted: vi.fn()
      } as unknown as React.ComponentProps<typeof RepositoryChanges>;
      return <RepositoryChanges {...props} />;
    }
    await act(async () => root.render(<Harness target={TARGET} workspaceId="workspace-a" />));
    expect(container.querySelector(".diff-workspace-tree-directory")?.getAttribute("aria-expanded")).toBe("false");
    await act(async () => root.render(
      <Harness target={{ ...TARGET, worktreeId: "linked-worktree" }} workspaceId="workspace-b" />
    ));
    expect(container.querySelector(".diff-workspace-tree-directory")?.getAttribute("aria-expanded")).toBe("false");
    act(() => findButtonByLabel(container, "打开变更文件视图菜单").click());
    await act(async () => findButtonByText(document.body, "展开目录").click());
    expect(update).toHaveBeenLastCalledWith({
      repositoryFileBrowsing: {
        repositoryId: TARGET.repositoryId, treeDirectoriesCollapsed: false
      }
    }, { silent: true });
    act(() => findButtonByLabel(container, "打开变更文件视图菜单").click());
    await act(async () => findButtonByText(document.body, "以列表形式查看").click());
    expect(update).toHaveBeenLastCalledWith({
      repositoryFileBrowsing: { repositoryId: TARGET.repositoryId, fileView: "list" }
    }, { silent: true });
    await act(async () => root.render(
      <Harness target={{ repositoryId: "other-repository", worktreeId: "other-worktree" }} workspaceId="workspace-b" />
    ));
    expect(container.querySelector(".diff-workspace-tree-directory")).toBeNull();
    expect(container.querySelector(".diff-workspace-file")).not.toBeNull();
  });

  it("shows the scheduled first commit file query in the first committed frame", async () => {
    installBridge({ getCommitDiff: vi.fn(() => new Promise<never>(() => undefined)) });
    const frames: string[] = [];
    function Harness() {
      React.useLayoutEffect(() => { frames.push(container.innerHTML); });
      return <RepositoryCommitDetail commit={COMMIT} target={TARGET} view="files" />;
    }
    await act(async () => { root.render(<Harness />); });
    expect(frames[0]).toContain("gn-skeleton");
    expect(frames[0]).not.toContain("选择文件查看 Diff");
  });

  it("keeps loaded commit file content when reselecting during context expansion", async () => {
    const expanding = deferred<Awaited<ReturnType<GitNestBridge["repository"]["getCommitDiff"]>>>();
    const reselecting = deferred<Awaited<ReturnType<GitNestBridge["repository"]["getCommitDiff"]>>>();
    installBridge({
      getCommitDiff: vi.fn()
        .mockResolvedValueOnce({ ok: true, value: createCommitDiff("src/App.tsx", "@@ -1 +1 @@\n-oldValue\n+loadedValue") })
        .mockReturnValueOnce(expanding.promise)
        .mockReturnValueOnce(reselecting.promise)
    });
    await act(async () => {
      root.render(<RepositoryCommitDetail commit={COMMIT} target={TARGET} view="files" />);
    });
    act(() => { findButtonByLabel(container, "展开第 1 个变更块上下各 10 行").click(); });
    expect(container.textContent).toContain("loadedValue");
    act(() => { findButtonByTitle(container, "src/App.tsx").click(); });
    expect(container.textContent).toContain("loadedValue");
    expect(container.querySelector(".gn-skeleton")).toBeNull();
    await act(async () => {
      reselecting.resolve({ ok: true, value: createCommitDiff("src/App.tsx", "@@ -1 +1 @@\n-oldValue\n+newestValue") });
      expanding.resolve({ ok: false, error: { code: "COMMAND_FAILED", message: "过期展开失败", details: {} } });
    });
    expect(container.textContent).toContain("newestValue");
    expect(container.textContent).not.toContain("过期展开失败");
  });

  it("switches the breadcrumb between commit details and changed files", () => {
    act(() => {
      root.render(<CommitDetailBreadcrumbHarness />);
    });

    const detailsButton = findViewButton(
      container,
      "details"
    );
    const filesButton = findViewButton(container, "files");
    expect(detailsButton.getAttribute("aria-current")).toBe(
      "page"
    );
    expect(filesButton.hasAttribute("aria-current")).toBe(false);

    act(() => {
      filesButton.click();
    });

    expect(detailsButton.hasAttribute("aria-current")).toBe(
      false
    );
    expect(filesButton.getAttribute("aria-current")).toBe(
      "page"
    );
    expect(container.textContent).toContain("+4");
    expect(container.textContent).toContain("-2");
  });

  it("renders commit details and changed files as mutually exclusive views", async () => {
    const getCommitDiff = vi.fn(async () => ({
      ok: true as const,
      value: createCommitDiff(
        "src/App.tsx",
        [
          "@@ -1 +1 @@",
          "-const oldValue = true;",
          "+const newValue = true;"
        ].join("\n")
      )
    }));
    installBridge({ getCommitDiff });

    act(() => {
      root.render(
        <RepositoryCommitDetail
          commit={COMMIT}
          target={TARGET}
          view="details"
        />
      );
    });
    await act(async () => {
      await flushAsyncWork();
    });

    expect(
      container.querySelector(".history-commit-overview")
    ).not.toBeNull();
    expect(
      container.querySelector(".history-commit-files")
    ).toBeNull();
    expect(container.textContent).toContain(COMMIT.subject);
    expect(container.textContent).toContain(COMMIT.body);
    expect(getCommitDiff).not.toHaveBeenCalled();

    await act(async () => {
      root.render(
        <RepositoryCommitDetail
          commit={COMMIT}
          target={TARGET}
          view="files"
        />
      );
      await flushAsyncWork();
    });

    expect(
      container.querySelector(".history-commit-overview")
    ).toBeNull();
    expect(
      container.querySelector(".history-commit-files")
    ).not.toBeNull();
    expect(
      container.querySelector(
        "details.history-commit-files"
      )
    ).toBeNull();
    expect(container.textContent).toContain("App.tsx");
    expect(container.textContent).toContain("src");
    expect(container.textContent).toContain("logo.png");
    expect(container.textContent).toContain("二进制");
    expect(container.textContent).toContain("+4");
    expect(container.textContent).toContain("-2");

    expect(getCommitDiff).toHaveBeenCalledWith({
      queryId: expect.stringMatching(/^commit_diff_/),
      target: TARGET,
      commitHash: COMMIT_HASH,
      path: "src/App.tsx",
      contextLines: 3
    });
    expect(
      findButtonByTitle(container, "src/App.tsx").getAttribute(
        "aria-current"
      )
    ).toBe("true");
    expect(container.textContent).toContain("oldValue");
    expect(container.textContent).toContain("newValue");
  });

  it("keeps the latest selected file when diff responses arrive out of order", async () => {
    const first = deferred<RepositoryCommitDiffDto>();
    const second = deferred<RepositoryCommitDiffDto>();
    const getCommitDiff = vi.fn(
      (
        request: Parameters<
          GitNestBridge["repository"]["getCommitDiff"]
        >[0]
      ) =>
        (request.path === "src/App.tsx"
          ? first.promise
          : second.promise
        ).then((value) => ({
          ok: true as const,
          value
        }))
    );
    const cancelQuery = vi.fn(async () => ({
      ok: true as const,
      value: undefined
    }));
    installBridge({ cancelQuery, getCommitDiff });

    act(() => {
      root.render(
        <RepositoryCommitDetail
          commit={COMMIT}
          target={TARGET}
          view="files"
        />
      );
    });
    act(() => {
      findButtonByTitle(container, "assets/logo.png").click();
    });

    await act(async () => {
      second.resolve(
        createCommitDiff(
          "assets/logo.png",
          "Binary files differ",
          true
        )
      );
      await flushAsyncWork();
    });
    await act(async () => {
      first.resolve(
        createCommitDiff(
          "src/App.tsx",
          "@@ -1 +1 @@\n-old\n+stale"
        )
      );
      await flushAsyncWork();
    });

    expect(cancelQuery).toHaveBeenCalledTimes(1);
    expect(
      findButtonByTitle(
        container,
        "assets/logo.png"
      ).getAttribute("aria-current")
    ).toBe("true");
    expect(container.textContent).toContain("二进制文件");
    expect(container.textContent).not.toContain("stale");
    expect(
      container
        .querySelector(".commit-detail-body")
        ?.getAttribute("data-history-commit-view")
    ).toBe("files");
  });

  it("previews supported media from the selected commit", async () => {
    const getCommitDiff = vi.fn(
      async (
        request: Parameters<
          GitNestBridge["repository"]["getCommitDiff"]
        >[0]
      ) => ({
        ok: true as const,
        value:
          request.path === "assets/logo.png"
            ? createCommitDiff(
                request.path,
                "Binary files differ",
                true,
                {
                  status: "available",
                  kind: "image",
                  mimeType: "image/png",
                  size: 4,
                  content: Uint8Array.from([0, 1, 2, 3])
                }
              )
            : createCommitDiff(
                request.path,
                "@@ -1 +1 @@\n-old\n+new"
              )
      })
    );
    installBridge({ getCommitDiff });

    act(() => {
      root.render(
        <RepositoryCommitDetail
          commit={COMMIT}
          target={TARGET}
          view="files"
        />
      );
    });
    await act(async () => {
      await flushAsyncWork();
    });
    await act(async () => {
      findButtonByTitle(container, "assets/logo.png").click();
      await flushAsyncWork();
    });

    const preview = container.querySelector<HTMLImageElement>(
      'img[alt="assets/logo.png 图片预览"]'
    );
    expect(preview?.src).toBe("blob:commit-media-preview");
    expect(
      container.querySelector(
        '.diff-viewer-code[aria-label="文件预览"]'
      )
    ).not.toBeNull();
    expect(container.textContent).not.toContain(
      "二进制文件不在 Renderer 中加载内容"
    );
  });

  it("retries a failed context expansion without hiding the existing diff", async () => {
    const getCommitDiff = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true as const,
        value: createCommitDiff(
          "src/App.tsx",
          "@@ -1 +1 @@\n-oldValue\n+newValue"
        )
      })
      .mockResolvedValueOnce({
        ok: false as const,
        error: {
          code: "COMMAND_FAILED" as const,
          message: "temporary failure",
          details: {}
        }
      })
      .mockResolvedValueOnce({
        ok: true as const,
        value: createCommitDiff(
          "src/App.tsx",
          "@@ -1 +1 @@\n-oldValue\n+expandedValue"
        )
      });
    installBridge({ getCommitDiff });

    act(() => {
      root.render(
        <RepositoryCommitDetail
          commit={COMMIT}
          target={TARGET}
          view="files"
        />
      );
    });
    await act(async () => {
      await flushAsyncWork();
    });

    await act(async () => {
      findButtonByLabel(
        container,
        "展开第 1 个变更块上下各 10 行"
      ).click();
      await flushAsyncWork();
    });

    expect(getCommitDiff).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("temporary failure");
    expect(container.textContent).toContain("newValue");

    await act(async () => {
      findButtonByText(container, "重试").click();
      await flushAsyncWork();
    });

    expect(getCommitDiff).toHaveBeenCalledTimes(3);
    expect(getCommitDiff).toHaveBeenLastCalledWith({
      queryId: expect.stringMatching(/^commit_diff_/),
      target: TARGET,
      commitHash: COMMIT_HASH,
      path: "src/App.tsx",
      contextLines: 10
    });
    expect(container.textContent).toContain("expandedValue");
  });
});

describe("RepositoryPage AI commit requests", () => {
  let container: HTMLDivElement;
  let root: Root;
  const generate = vi.fn<GitNestBridge["ai"]["generateCommitMessage"]>();
  const requestCommand = vi.fn(async () => false);
  const noOp = () => undefined;
  const workspace = {
    id: "ai-workspace",
    repositories: [],
    worktrees: []
  } as unknown as NonNullable<React.ComponentProps<typeof RepositoryPage>["workspace"]>;
  const settings = createDefaultAppSettings();
  Object.assign(settings.ai, {
    enabled: true,
    apiKeyConfigured: true,
    apiUrl: "https://example.test",
    model: "model",
    prompt: "generate"
  });

  beforeEach(() => {
    generate.mockReset();
    requestCommand.mockClear();
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      setTimeout(() => callback(0), 0)
    );
    vi.stubGlobal("cancelAnimationFrame", clearTimeout);
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true, value: vi.fn()
    });
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true, value: vi.fn()
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    installBridge({
      getChanges: vi.fn<GitNestBridge["repository"]["getChanges"]>(async ({ target }) => ({
        ok: true,
        value: {
          target,
          snapshot: {
            branch: "main", head: "abcdef", ahead: 0, behind: 0,
            staged: 1, unstaged: 0, untracked: 0, conflicted: 0,
            refreshedAt: "2026-10-04T00:00:00.000Z",
            changes: [{
              path: "a.ts", kind: "ordinary",
              indexStatus: "M", worktreeStatus: "."
            }]
          }
        }
      })),
      getDiff: vi.fn<GitNestBridge["repository"]["getDiff"]>(async ({ target, path, mode }) => ({
        ok: true,
        value: {
          target,
          diff: {
            path, mode, content: "@@ -1 +1 @@\n-old\n+new",
            binary: false, truncated: false, additions: 1, deletions: 1
          }
        }
      }))
    });
    Object.defineProperty(window.gitnest, "ai", {
      configurable: true,
      value: { generateCommitMessage: generate }
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it.each([false, true])("clears only the submitted draft after commit refresh (A/B/A navigation: %s)", async (navigate) => {
    await renderRepository("a");
    const getChanges = vi.mocked(window.gitnest.repository.getChanges);
    const initialChanges = await getChanges.mock.results[0]!.value;
    const refresh = deferred<Awaited<ReturnType<typeof getChanges>>>();
    getChanges.mockReturnValueOnce(refresh.promise);
    window.gitnest.repository.createCommit = vi.fn(async ({ target, subject }) => ({
      ok: true as const,
      value: {
        target,
        operationId: "committed-a",
        commit: { hash: COMMIT_HASH, shortHash: COMMIT_HASH.slice(0, 7), subject }
      }
    }));
    editMessage("fix: first commit");
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".diff-workspace-commit-submit")!.click();
      await flushAsyncWork();
    });
    expect(getChanges).toHaveBeenCalledTimes(2);
    expect(messageInput().disabled).toBe(true);
    if (navigate) {
      await renderRepository("b");
      await renderRepository("a");
      editMessage("fix: next commit draft");
    }
    await act(async () => {
      refresh.resolve(initialChanges);
      await flushAsyncWork();
    });
    expect(messageInput().value).toBe(navigate ? "fix: next commit draft" : "");
  });

  it("preserves a new AI draft that arrives while an earlier message is being committed", async () => {
    const aiResponse = deferred<Awaited<ReturnType<typeof generate>>>();
    const commitResponse = deferred<Awaited<ReturnType<GitNestBridge["repository"]["createCommit"]>>>();
    generate.mockReturnValueOnce(aiResponse.promise);
    window.gitnest.repository.createCommit = vi.fn(() => commitResponse.promise);
    await renderRepository("a");
    editMessage("fix: submitted message");
    clickGenerate();
    act(() => {
      container.querySelector<HTMLButtonElement>(".diff-workspace-commit-submit")!.click();
    });
    expect(window.gitnest.repository.createCommit).toHaveBeenCalledWith({
      target: { repositoryId: "a", worktreeId: "a-wt" },
      subject: "fix: submitted message"
    });
    expect(messageInput().disabled).toBe(true);
    await act(async () => aiResponse.resolve(aiSuccess("feat: newly generated draft")));
    expect(messageInput().value).toBe("feat: newly generated draft");
    await act(async () => {
      commitResponse.resolve({
        ok: true,
        value: {
          target: { repositoryId: "a", worktreeId: "a-wt" },
          operationId: "commit-before-ai",
          commit: { hash: COMMIT_HASH, shortHash: COMMIT_HASH.slice(0, 7), subject: "fix: submitted message" }
        }
      });
      await flushAsyncWork();
    });
    expect(messageInput().value).toBe("feat: newly generated draft");
    expect(messageInput().disabled).toBe(false);
  });

  it.each([false, true])("keeps commit success separate from push failure and scope changes (navigate: %s)", async (navigate) => {
    const commitResponse = deferred<Awaited<ReturnType<GitNestBridge["repository"]["createCommit"]>>>();
    const createCommit = vi.fn(() => commitResponse.promise);
    window.gitnest.repository.createCommit = createCommit;
    await renderRepository("a");
    editMessage("fix: submitted before push");
    act(() => {
      container.querySelector<HTMLInputElement>('[name="push-after-commit"]')!.click();
    });
    act(() => {
      container.querySelector<HTMLButtonElement>(".diff-workspace-commit-submit")!.click();
    });
    if (navigate) {
      await renderRepository("b");
      editMessage("fix: repository B draft");
    }
    await act(async () => {
      commitResponse.resolve({
        ok: true,
        value: {
          target: { repositoryId: "a", worktreeId: "a-wt" },
          operationId: "commit-then-push",
          commit: { hash: COMMIT_HASH, shortHash: COMMIT_HASH.slice(0, 7), subject: "fix: submitted before push" }
        }
      });
      await flushAsyncWork();
    });
    expect(createCommit).toHaveBeenCalledTimes(1);
    if (navigate) {
      expect(requestCommand).not.toHaveBeenCalled();
      expect(messageInput().value).toBe("fix: repository B draft");
    } else {
      expect(requestCommand).toHaveBeenCalledTimes(1);
      expect(requestCommand).toHaveBeenCalledWith({
        type: "push", targets: [{ repositoryId: "a", worktreeId: "a-wt" }]
      });
      expect(messageInput().value).toBe("");
    }
  });

  it("keeps the newer AI result after A/B/A navigation and reversed responses", async () => {
    const first = deferred<Awaited<ReturnType<typeof generate>>>();
    const second = deferred<Awaited<ReturnType<typeof generate>>>();
    generate.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await renderRepository("a");
    clickGenerate();
    await renderRepository("b");
    await renderRepository("a");
    clickGenerate();
    expect(generate).toHaveBeenCalledTimes(2);
    await act(async () => second.resolve(aiSuccess("feat: newer snapshot")));
    expect(messageInput().value).toBe("feat: newer snapshot");
    await act(async () => first.resolve(aiSuccess("feat: obsolete snapshot")));
    expect(messageInput().value).toBe("feat: newer snapshot");
  });

  it("keeps the newer AI request busy when the older request settles first", async () => {
    const first = deferred<Awaited<ReturnType<typeof generate>>>();
    const second = deferred<Awaited<ReturnType<typeof generate>>>();
    generate.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await renderRepository("a");
    clickGenerate();
    await renderRepository("b");
    await renderRepository("a");
    clickGenerate();
    await act(async () => first.resolve(aiSuccess("feat: obsolete snapshot")));
    expect(generateButton().disabled).toBe(true);
    expect(messageInput().value).toBe("");
    await act(async () => second.resolve(aiSuccess("feat: latest")));
    expect(generateButton().disabled).toBe(false);
  });

  it("preserves user edits made while an AI response is pending", async () => {
    const pending = deferred<Awaited<ReturnType<typeof generate>>>();
    generate.mockReturnValueOnce(pending.promise);
    await renderRepository("a");
    clickGenerate();
    editMessage("fix: 用户手写的提交信息");
    await act(async () => pending.resolve(aiSuccess("feat: obsolete draft")));
    expect(messageInput().value).toBe("fix: 用户手写的提交信息");
    expect(generateButton().disabled).toBe(false);
    expect(container.textContent).not.toContain("AI 提交信息已生成");
  });

  it.each(["result", "rejection"])(
    "ignores an older AI %s failure while the newer request is pending",
    async (failureKind) => {
      const first = deferred<Awaited<ReturnType<typeof generate>>>();
      const second = deferred<Awaited<ReturnType<typeof generate>>>();
      generate
        .mockReturnValueOnce(first.promise.then((result) => {
          if (failureKind === "rejection") {
            throw new Error("obsolete AI failure");
          }
          return result;
        }))
        .mockReturnValueOnce(second.promise);
      await renderRepository("a");
      clickGenerate();
      await renderRepository("b");
      await renderRepository("a");
      clickGenerate();
      await act(async () => first.resolve({
        ok: false,
        error: {
          code: "COMMAND_FAILED",
          message: "obsolete AI failure",
          details: {}
        }
      }));
      expect(container.textContent).not.toContain("obsolete AI failure");
      expect(generateButton().disabled).toBe(true);
      await act(async () => second.resolve(aiSuccess("feat: latest")));
      expect(messageInput().value).toBe("feat: latest");
      expect(generateButton().disabled).toBe(false);
    }
  );

  it("still writes an unsuperseded late result into its original repository draft", async () => {
    const pending = deferred<Awaited<ReturnType<typeof generate>>>();
    generate.mockReturnValueOnce(pending.promise);
    await renderRepository("a");
    clickGenerate();
    await renderRepository("b");
    editMessage("fix: B draft");
    await act(async () => pending.resolve(aiSuccess("feat: A result")));
    expect(messageInput().value).toBe("fix: B draft");
    await renderRepository("a");
    expect(messageInput().value).toBe("feat: A result");
  });

  it("does not apply an unmounted page response after the repository page reopens", async () => {
    const oldPage = deferred<Awaited<ReturnType<typeof generate>>>();
    const newPage = deferred<Awaited<ReturnType<typeof generate>>>();
    generate.mockReturnValueOnce(oldPage.promise).mockReturnValueOnce(newPage.promise);
    await renderRepository("a");
    clickGenerate();
    act(() => root.render(<div>设置</div>));
    await renderRepository("a");
    clickGenerate();
    await act(async () => oldPage.resolve(aiSuccess("feat: closed page")));
    expect(messageInput().value).toBe("");
    expect(generateButton().disabled).toBe(true);
    await act(async () => newPage.resolve(aiSuccess("feat: reopened page")));
    expect(messageInput().value).toBe("feat: reopened page");
  });

  async function renderRepository(repositoryId: string) {
    const props = {
      workspace,
      target: { repositoryId, worktreeId: `${repositoryId}-wt` },
      snapshots: [], operations: [], tab: "changes",
      commands: { clearFeedback: noOp, completionVersion: 0, request: requestCommand },
      terminals: { clearFeedback: noOp },
      externalApplications: { profiles: [] },
      appSettings: { settings },
      onOpenTab: noOp
    } as unknown as React.ComponentProps<typeof RepositoryPage>;
    await act(async () => {
      root.render(<RepositoryPage key={workspace.id} {...props} />);
      await flushAsyncWork();
    });
    await act(flushAsyncWork);
  }

  function generateButton() {
    return findButtonByLabel(container, "使用 AI 生成提交信息");
  }
  function clickGenerate() {
    act(() => generateButton().click());
  }
  function messageInput() {
    return container.querySelector<HTMLTextAreaElement>('[name="commit-message"]')!;
  }
  function editMessage(message: string) {
    act(() => {
      const input = messageInput();
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype, "value"
      )?.set?.call(input, message);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(messageInput().value).toBe(message);
  }
  function aiSuccess(message: string): Awaited<ReturnType<typeof generate>> {
    return {
      ok: true,
      value: { message, stagedFiles: 1, truncated: false }
    };
  }
});

function CommitDetailBreadcrumbHarness() {
  const [view, setView] = React.useState<
    "details" | "files"
  >("details");

  return (
    <RepositoryCommitDetailBreadcrumb
      additions={4}
      deletions={2}
      fileCount={2}
      onViewChange={setView}
      view={view}
    />
  );
}

function installBridge(
  repository: Partial<GitNestBridge["repository"]>
): void {
  Object.defineProperty(window, "gitnest", {
    configurable: true,
    value: {
      repository: {
        cancelQuery: vi.fn(async () => ({
          ok: true as const,
          value: undefined
        })),
        ...repository
      }
    } as unknown as GitNestBridge
  });
}

function createCommitDiff(
  path: string,
  content: string,
  binary = false,
  media?: RepositoryMediaPreviewDto
): RepositoryCommitDiffDto {
  return {
    target: TARGET,
    commit: {
      hash: COMMIT_HASH
    },
    diff: {
      path,
      content,
      binary,
      truncated: false,
      additions: binary ? 0 : 1,
      deletions: binary ? 0 : 1,
      ...(media ? { media } : {})
    }
  };
}

function findButtonByTitle(
  rootNode: ParentNode,
  title: string
): HTMLButtonElement {
  const button = rootNode.querySelector<HTMLButtonElement>(
    `button[title="${title}"]`
  );
  if (!button) {
    throw new Error(`Button not found: ${title}`);
  }
  return button;
}

function findButtonByLabel(
  rootNode: ParentNode,
  label: string
): HTMLButtonElement {
  const button = rootNode.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`
  );
  if (!button) {
    throw new Error(`Button not found: ${label}`);
  }
  return button;
}

function findButtonByText(
  rootNode: ParentNode,
  text: string
): HTMLButtonElement {
  const button = [...rootNode.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === text
  );
  if (!button) {
    throw new Error(`Button not found: ${text}`);
  }
  return button;
}

function findViewButton(
  rootNode: ParentNode,
  view: "details" | "files"
): HTMLButtonElement {
  const button = rootNode.querySelector<HTMLButtonElement>(
    `button[data-history-commit-view="${view}"]`
  );
  if (!button) {
    throw new Error(`Commit detail view button not found: ${view}`);
  }
  return button;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
