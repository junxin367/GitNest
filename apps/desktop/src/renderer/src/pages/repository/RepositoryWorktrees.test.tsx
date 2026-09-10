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

import type { WorktreeCommandController } from "../../features/worktree-command/useWorktreeCommands";
import { RepositoryWorktrees } from "./RepositoryWorktrees";

describe("RepositoryWorktrees summary card", () => {
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

  it("opens the directory from click, Enter, and Space on the whole card", () => {
    const onOpenDirectory = vi.fn();

    act(() => {
      root.render(
        <RepositoryWorktrees
          commands={commands}
          directoryOpening={false}
          onOpenDirectory={onOpenDirectory}
          repositoryId="repository"
          snapshots={[]}
          worktreeId="worktree"
          workspace={workspace}
        />
      );
    });

    const card = container.querySelector<HTMLElement>(
      ".worktree-summary-card"
    );

    expect(card?.getAttribute("role")).toBe("button");
    expect(card?.tabIndex).toBe(0);
    expect(
      card?.querySelector(".worktree-foot-action")?.textContent
    ).toContain("打开");
    expect(card?.querySelector("button")).toBeNull();

    act(() => card?.click());
    act(() => {
      card?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "Enter"
        })
      );
    });
    act(() => {
      card?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: " "
        })
      );
    });

    expect(onOpenDirectory).toHaveBeenCalledTimes(3);
    expect(onOpenDirectory).toHaveBeenNthCalledWith(
      1,
      "worktree"
    );
  });

  it("blocks activation while the directory is opening", () => {
    const onOpenDirectory = vi.fn();

    act(() => {
      root.render(
        <RepositoryWorktrees
          commands={commands}
          directoryOpening
          onOpenDirectory={onOpenDirectory}
          repositoryId="repository"
          snapshots={[]}
          worktreeId="worktree"
          workspace={workspace}
        />
      );
    });

    const card = container.querySelector<HTMLElement>(
      ".worktree-summary-card"
    );

    expect(card?.getAttribute("aria-disabled")).toBe("true");
    act(() => card?.click());
    expect(onOpenDirectory).not.toHaveBeenCalled();
  });
});

const commands: WorktreeCommandController = {
  active: null,
  busy: false,
  preflight: null,
  error: null,
  notice: null,
  completionVersion: 0,
  request: vi.fn(async () => false),
  confirm: vi.fn(async () => false),
  dismissPreflight: vi.fn(),
  chooseDirectory: vi.fn(async () => null),
  cancelOperation: vi.fn(async () => false),
  clearFeedback: vi.fn()
};

const workspace: WorkspaceDetailsDto = {
  schemaVersion: 1,
  id: "workspace",
  name: "Workspace",
  entries: [],
  repositories: [
    {
      id: "repository",
      name: "core",
      commonDir: "C:\\repo\\.git",
      canonicalCommonDir: "c:\\repo\\.git",
      primaryWorktreeId: "worktree",
      worktreeIds: ["worktree"]
    }
  ],
  worktrees: [
    {
      id: "worktree",
      repositoryId: "repository",
      name: "core",
      path: "C:\\repo",
      canonicalPath: "c:\\repo",
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
  },
  updatedAt: "2026-09-10T00:00:00.000Z"
};
