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

import type { RepositoryCommitDto, WorkspaceDetailsDto } from "@gitnest/contracts";

import { DetailInspector } from "./DetailInspector";

describe("DetailInspector Workspace details", () => {
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
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("shows root-level Workspace data and renames the Workspace", async () => {
    const onRenameWorkspace = vi.fn(async () => true);

    act(() => {
      root.render(
        <DetailInspector
          busy={false}
          commit={null}
          gitEnvironment={null}
          gitError={null}
          monitor={null}
          onClose={() => undefined}
          onOpenSettings={() => undefined}
          onRenameWorkspace={onRenameWorkspace}
          operations={[]}
          runtimeInfo={null}
          snapshots={[]}
          workspace={createWorkspace()}
        />
      );
    });

    expect(container.textContent).toContain("Workspace 详情");
    expect(container.textContent).toContain("系统 Git");
    expect(container.textContent).toContain(
      "远程操作直接继承系统 Credential Helper"
    );
    expect(container.textContent).toContain("认证设置");
    expect(container.textContent).not.toContain("仓库覆盖");
    expect(container.textContent).not.toContain("管理账号");
    expect(container.textContent).toContain("C:\\workspace");
    expect(container.textContent).toContain("2 个");
    expect(container.textContent).toContain("Workspace 名称");

    const input = container.querySelector<HTMLInputElement>(
      "#workspace-display-name"
    );
    expect(input?.value).toBe("Test Workspace");

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set;
      setter?.call(input, "Renamed Workspace");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const saveButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "保存"
    );
    await act(async () => {
      saveButton?.click();
    });

    expect(onRenameWorkspace).toHaveBeenCalledWith(
      "workspace",
      "Renamed Workspace"
    );
  });

  it("dispatches each commit shortcut with the currently displayed commit and respects busy state", async () => {
    const onCommitAction = vi.fn();
    const firstCommit = {
      hash: "a".repeat(40), shortHash: "aaaaaaa", subject: "First",
      authorName: "Author", authorEmail: "author@example.com", authoredAt: "2026-10-06T00:00:00Z",
      parentHashes: [], refs: [], committerName: "Author", committerEmail: "author@example.com",
      committedAt: "2026-10-06T00:00:00Z", body: "", files: [], additions: 0, deletions: 0
    } satisfies RepositoryCommitDto["commit"];
    const render = (commit: RepositoryCommitDto["commit"], busy = false) => act(() => root.render(
      <DetailInspector busy={false} actionBusy={busy} onCommitAction={onCommitAction}
        commit={commit} gitEnvironment={null} gitError={null} monitor={null}
        onClose={() => undefined} onOpenSettings={() => undefined}
        onRenameWorkspace={async () => true} operations={[]} runtimeInfo={null}
        snapshots={[]} workspace={createWorkspace()} />
    ));
    render(firstCommit);
    expect(container.querySelectorAll(".quick-grid")).toHaveLength(1);
    expect([...container.querySelectorAll(".quick-grid > button")].map(button =>
      button.textContent?.trim()
    )).toEqual(["复制 ID", "远程查看", "Cherry-pick", "创建分支"]);
    expect(container.querySelectorAll(".quick-grid > .quick-button > svg")).toHaveLength(4);
    expect(container.textContent).not.toContain("还原此提交");
    const actions = [
      ["远程查看", "remote"], ["Cherry-pick", "cherry-pick"],
      ["创建分支", "create-branch"]
    ] as const;
    for (const [label, action] of actions) {
      await act(async () => [...container.querySelectorAll("button")]
        .find(button => button.textContent?.trim() === label)!.click());
      expect(onCommitAction).toHaveBeenLastCalledWith(action, firstCommit);
    }
    const secondCommit = { ...firstCommit, hash: "b".repeat(40), subject: "Second" };
    render(secondCommit);
    await act(async () => [...container.querySelectorAll("button")]
      .find(button => button.textContent?.trim() === "Cherry-pick")!.click());
    expect(onCommitAction).toHaveBeenLastCalledWith("cherry-pick", secondCommit);
    render(secondCommit, true);
    expect([...container.querySelectorAll(".quick-grid > button")].slice(1)
      .every(button => (button as HTMLButtonElement).disabled)).toBe(true);
    expect(container.querySelector<HTMLButtonElement>(".quick-grid > button")?.disabled).toBe(false);
    expect(container.textContent).not.toContain("暂未接入");
  });

  it.each(["Newer draft", "Test Workspace"])(
    "preserves the newer name %s when an earlier save finishes",
    async (newerName) => {
      let finishFirstSave!: (saved: boolean) => void;
      const firstSave = new Promise<boolean>((resolve) => {
        finishFirstSave = resolve;
      });
      const onRenameWorkspace = vi.fn()
        .mockReturnValueOnce(firstSave)
        .mockResolvedValueOnce(false)
        .mockResolvedValue(true);
      const original = createWorkspace();
      const render = (workspace: WorkspaceDetailsDto, busy = false) =>
        act(() => root.render(
          <DetailInspector
            busy={busy}
            commit={null}
            gitEnvironment={null}
            gitError={null}
            monitor={null}
            onClose={() => undefined}
            onOpenSettings={() => undefined}
            onRenameWorkspace={onRenameWorkspace}
            operations={[]}
            runtimeInfo={null}
            snapshots={[]}
            workspace={workspace}
          />
        ));
      const input = () => container.querySelector<HTMLInputElement>(
        "#workspace-display-name"
      )!;
      const save = () => container.querySelector<HTMLButtonElement>(
        ".workspace-settings-form button"
      )!;
      const edit = (value: string) => act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
          ?.set?.call(input(), value);
        input().dispatchEvent(new Event("input", { bubbles: true }));
      });

      render(original);
      edit("Earlier save");
      act(() => save().click());
      render(original, true);
      expect(save().disabled).toBe(true);
      edit(newerName);
      render({ ...original, name: "Earlier save" });
      await act(async () => finishFirstSave(true));

      expect(input().value).toBe(newerName);
      expect(save().disabled).toBe(false);
      await act(async () => save().click());
      expect(onRenameWorkspace).toHaveBeenLastCalledWith("workspace", newerName);
      expect(input().value).toBe(newerName);
      expect(save().disabled).toBe(false);
      await act(async () => save().click());
      render({ ...original, name: newerName });
      expect(save().disabled).toBe(true);

      edit("Unsubmitted name");
      let finishOldWorkspaceSave!: (saved: boolean) => void;
      onRenameWorkspace.mockReturnValueOnce(new Promise<boolean>((resolve) => {
        finishOldWorkspaceSave = resolve;
      }));
      act(() => save().click());
      render({ ...original, id: "another-workspace", name: "Other Workspace" });
      expect(input().value).toBe("Other Workspace");
      expect(save().disabled).toBe(true);
      edit("Other workspace draft");
      await act(async () => finishOldWorkspaceSave(true));
      expect(input().value).toBe("Other workspace draft");
      await act(async () => save().click());
      expect(onRenameWorkspace).toHaveBeenLastCalledWith(
        "another-workspace", "Other workspace draft"
      );
    }
  );
});

function createWorkspace(): WorkspaceDetailsDto {
  return {
    schemaVersion: 2,
    id: "workspace",
    name: "Test Workspace",
    path: "C:\\workspace",
    canonicalPath: "c:\\workspace",
    excludes: [],
    groups: [
      {
        id: "group",
        name: "All",
        collapsed: false,
        targets: []
      }
    ],
    scanIssues: [
      {
        path: "C:\\workspace\\unavailable",
        code: "DIRECTORY_UNAVAILABLE",
        message: "Unavailable"
      }
    ],
    lastScannedAt: "2026-09-22T00:00:00.000Z",
    repositories: [
      {
        id: "repository-a",
        name: "Repository A",
        commonDir: "C:\\workspace\\repository-a\\.git",
        canonicalCommonDir: "c:\\workspace\\repository-a\\.git",
        worktreeIds: []
      },
      {
        id: "repository-b",
        name: "Repository B",
        commonDir: "C:\\workspace\\repository-b\\.git",
        canonicalCommonDir: "c:\\workspace\\repository-b\\.git",
        worktreeIds: []
      }
    ],
    worktrees: [],
    updatedAt: "2026-09-22T00:00:00.000Z"
  };
}
