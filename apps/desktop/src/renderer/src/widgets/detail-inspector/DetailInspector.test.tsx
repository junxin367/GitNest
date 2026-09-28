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

import type { WorkspaceDetailsDto } from "@gitnest/contracts";

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

  it("shows root-level Workspace data and renames the Workspace", () => {
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
    act(() => {
      saveButton?.click();
    });

    expect(onRenameWorkspace).toHaveBeenCalledWith(
      "workspace",
      "Renamed Workspace"
    );
  });
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
