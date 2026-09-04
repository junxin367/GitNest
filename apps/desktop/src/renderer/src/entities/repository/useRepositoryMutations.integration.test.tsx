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
  GitNestBridge,
  RepositoryTargetDto
} from "@gitnest/contracts";

import {
  useRepositoryMutations,
  type RepositoryMutationController
} from "./useRepositoryMutations";

const TARGET_A: RepositoryTargetDto = {
  repositoryId: "repository-a",
  worktreeId: "worktree-a"
};
const TARGET_B: RepositoryTargetDto = {
  repositoryId: "repository-b",
  worktreeId: "worktree-b"
};
const CHANGE = {
  path: "file.txt",
  indexStatus: ".",
  worktreeStatus: "M",
  kind: "ordinary"
} as const;

describe("useRepositoryMutations", () => {
  let container: HTMLDivElement;
  let root: Root;
  let controller: RepositoryMutationController | undefined;

  beforeEach(() => {
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
  });

  it("does not apply a late mutation result after the selected target changes", async () => {
    let resolveStage!: (
      result: Awaited<
        ReturnType<GitNestBridge["repository"]["stage"]>
      >
    ) => void;
    const stage = vi.fn(
      () =>
        new Promise<
          Awaited<
            ReturnType<
              GitNestBridge["repository"]["stage"]
            >
          >
        >((resolve) => {
          resolveStage = resolve;
        })
    );
    Object.defineProperty(window, "gitnest", {
      configurable: true,
      value: {
        repository: { stage }
      } as unknown as GitNestBridge
    });
    const beforeMutation = vi.fn();
    const afterMutation = vi.fn(async () => undefined);
    const hooks = { beforeMutation, afterMutation };

    await act(async () => {
      root.render(
        <Harness
          hooks={hooks}
          target={TARGET_A}
          onController={(value) => {
            controller = value;
          }}
        />
      );
    });

    let mutation!: Promise<boolean>;
    act(() => {
      mutation = controller?.stageChange(
        CHANGE
      ) as Promise<boolean>;
    });
    expect(stage).toHaveBeenCalledWith({
      target: TARGET_A,
      paths: ["file.txt"]
    });

    await act(async () => {
      root.render(
        <Harness
          hooks={hooks}
          target={TARGET_B}
          onController={(value) => {
            controller = value;
          }}
        />
      );
    });

    let completed: boolean | undefined;
    await act(async () => {
      resolveStage({
        ok: true,
        value: {
          target: TARGET_A,
          operationId: "operation-stage"
        }
      });
      completed = await mutation;
    });

    expect(completed).toBe(false);
    expect(beforeMutation).toHaveBeenCalledTimes(1);
    expect(afterMutation).not.toHaveBeenCalled();
    expect(controller?.notice).toBeNull();
    expect(controller?.error).toBeNull();
  });
});

function Harness({
  target,
  hooks,
  onController
}: {
  target: RepositoryTargetDto;
  hooks: {
    beforeMutation(): void;
    afterMutation(): Promise<void>;
  };
  onController(value: RepositoryMutationController): void;
}) {
  onController(useRepositoryMutations(target, hooks));
  return null;
}
