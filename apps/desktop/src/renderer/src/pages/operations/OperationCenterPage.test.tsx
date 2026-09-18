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
      render([]);
    });

    expect(setIntervalSpy).not.toHaveBeenCalled();
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

  function render(operations: WorkspaceOperationDto[]) {
    root.render(
      <OperationCenterPage
        commands={commands}
        loading={false}
        onOpenTarget={vi.fn()}
        operations={operations}
        snapshots={[]}
        workspace={null}
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
  state: WorkspaceOperationDto["state"]
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
      : {})
  };
}
