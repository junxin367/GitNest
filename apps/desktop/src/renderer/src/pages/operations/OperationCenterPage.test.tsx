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

import type {
  WorkspaceDetailsDto,
  WorkspaceOperationDto
} from "@gitnest/contracts";

import type { RepositoryCommandController } from "../../features/repository-command/useRepositoryCommands";
import { OperationCenterPage } from "./OperationCenterPage";

describe("OperationCenterPage duration timer", () => {
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not schedule idle repaint ticks", () => {
    const setIntervalSpy = vi.spyOn(
      globalThis,
      "setInterval"
    );

    act(() => {
      render(
        [
          createOperation("failed"),
          createOperation("interrupted")
        ],
        workspace
      );
    });

    expect(setIntervalSpy).not.toHaveBeenCalled();
  });

  it("describes operation history as manual work instead of background telemetry", () => {
    act(() => {
      render([]);
    });

    expect(container.textContent).toContain(
      "添加 Workspace 后，手动刷新、同步或 Git 操作会显示在这里。"
    );
    expect(container.textContent).not.toContain("后台任务");
  });

  it("ticks only while an operation is active", () => {
    const setIntervalSpy = vi.spyOn(
      globalThis,
      "setInterval"
    );
    const clearIntervalSpy = vi.spyOn(
      globalThis,
      "clearInterval"
    );

    act(() => {
      render([createOperation("running")]);
    });
    expect(setIntervalSpy).toHaveBeenCalledOnce();

    act(() => {
      render([createOperation("succeeded")]);
    });
    expect(clearIntervalSpy).toHaveBeenCalledOnce();
  });

  it("renders four metrics and prototype-aligned operation cards", () => {
    const onOpenTarget = vi.fn();

    act(() => {
      render(
        [
          createOperation("running", {
            targetIds: ["repository-a:worktree-a"]
          })
        ],
        workspace,
        onOpenTarget
      );
    });

    expect(
      container.querySelectorAll(
        ".operation-metric-grid > .operation-metric"
      )
    ).toHaveLength(4);
    expect(container.textContent).not.toContain(
      "Workspace 批量同步"
    );
    expect(container.textContent).toContain(
      "最近操作中的异常记录"
    );
    expect(container.textContent).not.toContain(
      "需要人工处理"
    );
    expect(
      container.querySelector(".operation-history-heading")
        ?.textContent
    ).toContain("最近任务优先");

    const card = container.querySelector(
      ".operation-history-card"
    );
    expect(
      card?.querySelector(".operation-history-head")
    ).not.toBeNull();
    expect(
      card?.querySelector(".operation-history-foot")
    ).not.toBeNull();
    expect(
      card
        ?.querySelector('[role="progressbar"]')
        ?.getAttribute("aria-valuenow")
    ).toBe("50");

    const targetButton = Array.from(
      card?.querySelectorAll<HTMLButtonElement>("button") ?? []
    ).find(
      (button) => button.title === "C:\\repository-a"
    );
    expect(targetButton).not.toBeNull();

    act(() => targetButton?.click());

    expect(onOpenTarget).toHaveBeenCalledWith({
      repositoryId: "repository-a",
      worktreeId: "worktree-a"
    });
  });

  it("keeps completed records compact with a timestamp footer", () => {
    act(() => {
      render(
        [
          createOperation("succeeded", {
            targetIds: ["repository-a:worktree-a"]
          })
        ],
        workspace
      );
    });

    const card = container.querySelector(
      ".operation-history-card"
    );
    expect(
      card?.querySelector(".operation-history-head")
        ?.textContent
    ).toContain("Repository A·读取仓库状态已完成");
    expect(
      card?.querySelector(".operation-history-message")
        ?.textContent
    ).toBe("刷新仓库状态");
    expect(
      card?.querySelector(".operation-history-meta")
        ?.textContent
    ).toContain("2026/09/17");
    expect(
      card?.querySelector('[role="progressbar"]')
    ).toBeNull();
    expect(card?.textContent).not.toContain("成功 1 · 失败 0");
  });

  function render(
    operations: WorkspaceOperationDto[],
    activeWorkspace: WorkspaceDetailsDto | null = null,
    onOpenTarget = vi.fn()
  ) {
    root.render(
      <OperationCenterPage
        commands={commands}
        loading={false}
        onOpenTarget={onOpenTarget}
        operations={operations}
        workspace={activeWorkspace}
      />
    );
  }
});

const commands: RepositoryCommandController = {
  active: null,
  busy: false,
  preflight: null,
  error: null,
  notice: null,
  completionVersion: 0,
  request: vi.fn(async () => true),
  confirm: vi.fn(async () => true),
  dismissPreflight: vi.fn(),
  cancelOperation: vi.fn(async () => true),
  clearFeedback: vi.fn()
};

function createOperation(
  state: WorkspaceOperationDto["state"],
  overrides: Partial<WorkspaceOperationDto> = {}
): WorkspaceOperationDto {
  return {
    id: "operation",
    kind: "status",
    scope: "workspace",
    targetIds: [],
    state,
    progress: state === "succeeded" ? 1 : 0.5,
    succeeded: state === "succeeded" ? 1 : 0,
    failed: 0,
    message: "刷新仓库状态",
    startedAt: "2026-09-17T12:00:00.000Z",
    ...(state === "succeeded"
      ? { finishedAt: "2026-09-17T12:00:01.000Z" }
      : {}),
    ...overrides
  };
}

const workspace: WorkspaceDetailsDto = {
  schemaVersion: 2,
  id: "workspace",
  name: "Test Workspace",
  path: "C:\\repository-a",
  canonicalPath: "c:\\repository-a",
  excludes: [],
  groups: [
    {
      id: "group",
      name: "原/根仓库",
      targets: [
        {
        repositoryId: "repository-a",
        worktreeId: "worktree-a"
        }
      ],
      collapsed: false
    }
  ],
  scanIssues: [],
  lastScannedAt: "2026-09-17T12:00:00.000Z",
  repositories: [
    {
      id: "repository-a",
      name: "Repository A",
      commonDir: "C:\\repository-a\\.git",
      canonicalCommonDir: "c:\\repository-a\\.git",
      primaryWorktreeId: "worktree-a",
      worktreeIds: ["worktree-a"]
    }
  ],
  worktrees: [
    {
      id: "worktree-a",
      repositoryId: "repository-a",
      name: "Repository A",
      path: "C:\\repository-a",
      canonicalPath: "c:\\repository-a",
      head: "aaaaaaaaaaaaaaaa",
      branch: "main",
      isPrimary: true,
      isBare: false,
      isDetached: false,
      isLocked: false,
      isPrunable: false
    }
  ],
  selectedTarget: {
    repositoryId: "repository-a",
    worktreeId: "worktree-a"
  },
  updatedAt: "2026-09-17T12:00:00.000Z"
};
