import {
  useCallback,
  useEffect,
  useMemo,
  useState
} from "react";

import type {
  AddWorkspaceEntryRequest,
  RepositoryStatusSnapshotDto,
  RepositoryTargetDto,
  UpdateWorkspaceEntryRequest,
  WorkspaceDetailsDto,
  WorkspaceErrorDto,
  WorkspaceMonitorStateDto,
  WorkspaceOperationDto,
  WorkspaceRuntimeStateDto
} from "@gitnest/contracts";

import { addWorkspaceEntries } from "./addWorkspaceEntries";

type WorkspaceOperation =
  | "loading"
  | "selecting"
  | "scanning"
  | "saving"
  | null;

export interface WorkspaceController {
  workspace: WorkspaceDetailsDto | null;
  snapshots: RepositoryStatusSnapshotDto[];
  operations: WorkspaceOperationDto[];
  monitor: WorkspaceMonitorStateDto | null;
  error: WorkspaceErrorDto | null;
  notice: string | null;
  operation: WorkspaceOperation;
  busy: boolean;
  chooseDirectory(): Promise<void>;
  addManualPath(path: string): Promise<void>;
  addDroppedFiles(files: File[]): Promise<void>;
  refresh(): Promise<void>;
  selectEntry(entryId: string): Promise<void>;
  selectTarget(target: RepositoryTargetDto): Promise<void>;
  setGroupCollapsed(
    entryId: string,
    groupId: string,
    collapsed: boolean
  ): Promise<void>;
  updateEntry(request: UpdateWorkspaceEntryRequest): Promise<void>;
  clearFeedback(): void;
}

export function useWorkspace(): WorkspaceController {
  const [runtimeState, setRuntimeState] =
    useState<WorkspaceRuntimeStateDto | null>(null);
  const [error, setError] =
    useState<WorkspaceErrorDto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [operation, setOperation] =
    useState<WorkspaceOperation>("loading");
  const workspace = runtimeState?.workspace ?? null;
  const setWorkspace = useCallback(
    (nextWorkspace: WorkspaceDetailsDto) => {
      setRuntimeState((current) =>
        current
          ? {
              ...current,
              workspace: nextWorkspace
            }
          : {
              workspace: nextWorkspace,
              snapshots: [],
              operations: [],
              monitor: {
                mode: "inactive",
                watchedTargets: 0,
                message: "Workspace 监听正在初始化。"
              }
            }
      );
    },
    []
  );

  const setUnexpectedError = useCallback((reason: unknown) => {
    setError({
      code: "SCAN_FAILED",
      message:
        reason instanceof Error
          ? reason.message
          : "Workspace 操作失败。",
      details: {}
    });
  }, []);

  useEffect(() => {
    let active = true;
    let receivedStateEvent = false;
    const unsubscribe =
      window.gitnest.workspace.onStateChanged((state) => {
        if (active) {
          receivedStateEvent = true;
          setRuntimeState(state);
        }
      });

    void window.gitnest.workspace
      .getState()
      .then((result) => {
        if (!active) {
          return;
        }

        if (result.ok) {
          if (!receivedStateEvent) {
            setRuntimeState(result.value);
          }
          setError(null);
        } else {
          setError(result.error);
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setUnexpectedError(reason);
        }
      })
      .finally(() => {
        if (active) {
          setOperation(null);
        }
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [setUnexpectedError]);

  const addPaths = useCallback(
    async (
      paths: string[],
      source: AddWorkspaceEntryRequest["source"]
    ) => {
      const uniquePaths = [...new Set(paths.filter(Boolean))];

      if (uniquePaths.length === 0) {
        setError({
          code: "INVALID_REQUEST",
          message: "没有可添加的目录路径。",
          details: {}
        });
        return;
      }

      setOperation("scanning");
      setError(null);
      setNotice(null);

      try {
        const result = await addWorkspaceEntries(
          uniquePaths,
          source,
          workspace,
          (request) =>
            window.gitnest.workspace.addEntry(request)
        );

        if (result.workspace) {
          setWorkspace(result.workspace);
        }

        if (result.failures.length > 0) {
          const firstFailure = result.failures[0];
          setError({
            ...(firstFailure?.error ?? {
              code: "SCAN_FAILED",
              message: "部分目录未能添加。",
              details: {}
            }),
            message:
              result.added + result.duplicates > 0
                ? `已处理 ${result.added + result.duplicates} 个目录，另有 ${result.failures.length} 个失败：${firstFailure?.error.message ?? "未知错误"}`
                : firstFailure?.error.message ??
                  "目录添加失败。",
            details: {
              ...(firstFailure?.error.details ?? {}),
              failedCount: result.failures.length,
              successfulCount: result.added,
              duplicateCount: result.duplicates
            }
          });
          return;
        }

        setNotice(
          result.duplicates === uniquePaths.length
            ? "目录已存在，已定位到对应顶层条目。"
            : result.duplicates > 0
              ? `已添加 ${result.added} 个目录，另有 ${result.duplicates} 个重复目录已定位。`
              : `已完成 ${uniquePaths.length} 个目录的只读扫描。`
        );
      } catch (reason) {
        setUnexpectedError(reason);
      } finally {
        setOperation(null);
      }
    },
    [setUnexpectedError, setWorkspace, workspace]
  );

  const chooseDirectory = useCallback(async () => {
    setOperation("selecting");
    setError(null);
    setNotice(null);

    try {
      const result =
        await window.gitnest.workspace.selectDirectory();

      if (!result.ok) {
        setError(result.error);
        return;
      }

      if (!result.value.cancelled) {
        await addPaths([result.value.path], "picker");
      }
    } catch (reason) {
      setUnexpectedError(reason);
    } finally {
      setOperation((current) =>
        current === "selecting" ? null : current
      );
    }
  }, [addPaths, setUnexpectedError]);

  const addManualPath = useCallback(
    (path: string) => addPaths([path], "manual"),
    [addPaths]
  );

  const addDroppedFiles = useCallback(
    async (files: File[]) => {
      try {
        const paths = files.map((file) =>
          window.gitnest.workspace.resolveDroppedPath(file)
        );
        await addPaths(paths, "drop");
      } catch (reason) {
        setUnexpectedError(reason);
      }
    },
    [addPaths, setUnexpectedError]
  );

  const refresh = useCallback(async () => {
    setError(null);
    setNotice(null);

    try {
      const result = await window.gitnest.workspace.refresh();

      if (result.ok) {
        setNotice("Workspace 刷新已加入操作中心。");
      } else {
        setError(result.error);
      }
    } catch (reason) {
      setUnexpectedError(reason);
    }
  }, [setUnexpectedError]);

  const selectEntry = useCallback(
    async (entryId: string) => {
      if (workspace?.selectedEntryId === entryId) {
        return;
      }

      try {
        const result = await window.gitnest.workspace.selectEntry({
          entryId
        });
        if (result.ok) {
          setWorkspace(result.value);
        } else {
          setError(result.error);
        }
      } catch (reason) {
        setUnexpectedError(reason);
      }
    },
    [setUnexpectedError, setWorkspace, workspace?.selectedEntryId]
  );

  const selectTarget = useCallback(
    async (target: RepositoryTargetDto) => {
      if (
        workspace?.selectedTarget?.repositoryId ===
          target.repositoryId &&
        workspace.selectedTarget.worktreeId === target.worktreeId
      ) {
        return;
      }

      try {
        const result = await window.gitnest.workspace.selectTarget({
          target
        });
        if (result.ok) {
          setWorkspace(result.value);
        } else {
          setError(result.error);
        }
      } catch (reason) {
        setUnexpectedError(reason);
      }
    },
    [setUnexpectedError, setWorkspace, workspace?.selectedTarget]
  );

  const setGroupCollapsed = useCallback(
    async (
      entryId: string,
      groupId: string,
      collapsed: boolean
    ) => {
      try {
        const result =
          await window.gitnest.workspace.setGroupCollapsed({
            entryId,
            groupId,
            collapsed
          });
        if (result.ok) {
          setWorkspace(result.value);
        } else {
          setError(result.error);
        }
      } catch (reason) {
        setUnexpectedError(reason);
      }
    },
    [setUnexpectedError, setWorkspace]
  );

  const updateEntry = useCallback(
    async (request: UpdateWorkspaceEntryRequest) => {
      setOperation("saving");
      setError(null);

      try {
        const result =
          await window.gitnest.workspace.updateEntry(request);
        if (result.ok) {
          setWorkspace(result.value);
          setNotice("顶层条目设置已保存。");
        } else {
          setError(result.error);
        }
      } catch (reason) {
        setUnexpectedError(reason);
      } finally {
        setOperation(null);
      }
    },
    [setUnexpectedError, setWorkspace]
  );

  const clearFeedback = useCallback(() => {
    setError(null);
    setNotice(null);
  }, []);

  return useMemo(
    () => ({
      workspace,
      snapshots: runtimeState?.snapshots ?? [],
      operations: runtimeState?.operations ?? [],
      monitor: runtimeState?.monitor ?? null,
      error,
      notice,
      operation,
      busy: operation !== null,
      chooseDirectory,
      addManualPath,
      addDroppedFiles,
      refresh,
      selectEntry,
      selectTarget,
      setGroupCollapsed,
      updateEntry,
      clearFeedback
    }),
    [
      workspace,
      runtimeState?.snapshots,
      runtimeState?.operations,
      runtimeState?.monitor,
      error,
      notice,
      operation,
      chooseDirectory,
      addManualPath,
      addDroppedFiles,
      refresh,
      selectEntry,
      selectTarget,
      setGroupCollapsed,
      updateEntry,
      clearFeedback
    ]
  );
}
