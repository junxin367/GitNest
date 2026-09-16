/** @vitest-environment jsdom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it
} from "vitest";

import {
  useRepositoryCommitDraft,
  type RepositoryCommitDraftController
} from "./useRepositoryCommitDraft";

(globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;

describe("useRepositoryCommitDraft", () => {
  let container: HTMLDivElement;
  let root: Root;
  let controller: RepositoryCommitDraftController | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("restores each repository draft after switching scopes", () => {
    renderScope("workspace\u0001repository-a:worktree-a");

    act(() => {
      controller?.setMessage("feat: 仓库 A 的提交信息");
      controller?.setPushAfterCommit(true);
    });

    renderScope("workspace\u0001repository-b:worktree-b");
    expect(controller?.message).toBe("");
    expect(controller?.pushAfterCommit).toBe(false);

    act(() => {
      controller?.setMessage("fix: 仓库 B 的提交信息");
    });

    renderScope("workspace\u0001repository-a:worktree-a");
    expect(controller?.message).toBe(
      "feat: 仓库 A 的提交信息"
    );
    expect(controller?.pushAfterCommit).toBe(true);

    renderScope("workspace\u0001repository-b:worktree-b");
    expect(controller?.message).toBe(
      "fix: 仓库 B 的提交信息"
    );
  });

  it("stores a late generated message in its original scope", () => {
    const repositoryA =
      "workspace\u0001repository-a:worktree-a";
    const repositoryB =
      "workspace\u0001repository-b:worktree-b";
    renderScope(repositoryA);
    renderScope(repositoryB);

    act(() => {
      controller?.setMessageForScope(
        repositoryA,
        "feat: 延迟返回的 AI 提交信息"
      );
    });

    expect(controller?.message).toBe("");

    renderScope(repositoryA);
    expect(controller?.message).toBe(
      "feat: 延迟返回的 AI 提交信息"
    );
  });

  function renderScope(scopeKey: string) {
    act(() => {
      root.render(
        <Harness
          scopeKey={scopeKey}
          onController={(value) => {
            controller = value;
          }}
        />
      );
    });
  }
});

function Harness({
  scopeKey,
  onController
}: {
  scopeKey: string;
  onController(
    value: RepositoryCommitDraftController
  ): void;
}) {
  onController(useRepositoryCommitDraft(scopeKey));
  return null;
}
