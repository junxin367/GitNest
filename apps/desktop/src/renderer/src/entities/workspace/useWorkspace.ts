import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import type {
  RepositoryStatusSnapshotDto,
  RepositoryTargetDto,
  WorkspaceDetailsDto,
  WorkspaceErrorDto,
  WorkspaceMonitorStateDto,
  WorkspaceOperationDto,
  WorkspaceRuntimeStateDto,
  WorkspaceSummaryDto
} from "@gitnest/contracts";

type WorkspaceOperation =
  | "loading"
  | "selecting"
  | "scanning"
  | "switching"
  | "saving"
  | null;

export interface WorkspaceController {
  workspace: WorkspaceDetailsDto | null;
  workspaces: WorkspaceSummaryDto[];
  snapshots: RepositoryStatusSnapshotDto[];
  operations: WorkspaceOperationDto[];
  monitor: WorkspaceMonitorStateDto | null;
  error: WorkspaceErrorDto | null;
  notice: string | null;
  cleanupWarning: string | null;
  operation: WorkspaceOperation;
  busy: boolean;
  createWorkspace(): Promise<boolean>;
  switchWorkspace(workspaceId: string): Promise<boolean>;
  renameWorkspace(
    workspaceId: string,
    name: string
  ): Promise<boolean>;
  deleteWorkspace(workspaceId: string): Promise<boolean>;
  refresh(): Promise<void>;
  rescan(): Promise<boolean>;
  removeRepository(target: RepositoryTargetDto): Promise<boolean>;
  selectTarget(target: RepositoryTargetDto): Promise<boolean>;
  setGroupCollapsed(
    groupId: string,
    collapsed: boolean
  ): Promise<void>;
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
  const targetSelectionSequenceRef = useRef(0);
  const pendingTargetSelectionsRef = useRef(new Set<number>());
  const workspaceTransitionSequenceRef = useRef(0);
  const workspaceTransitionPendingRef = useRef(false);
  const workspaceRequestSequenceRef = useRef(0);
  const currentWorkspaceIdRef = useRef<string | undefined>(undefined);
  const workspace = runtimeState?.workspace ?? null;
  const acceptRuntimeState = useCallback((state: WorkspaceRuntimeStateDto) => {
    if (currentWorkspaceIdRef.current !== state.workspace.id) {
      if (!workspaceTransitionPendingRef.current) {
        setOperation(null);
        setError(null);
        setNotice(null);
      }
      currentWorkspaceIdRef.current = state.workspace.id;
      workspaceRequestSequenceRef.current += 1;
      targetSelectionSequenceRef.current += 1;
      pendingTargetSelectionsRef.current.clear();
    }
    setRuntimeState(state);
  }, []);
  const captureRequestScope = useCallback(() => {
    const workspaceId = workspace?.id;
    const sequence = workspaceRequestSequenceRef.current;
    return () =>
      workspaceId === currentWorkspaceIdRef.current &&
      sequence === workspaceRequestSequenceRef.current &&
      !workspaceTransitionPendingRef.current;
  }, [workspace?.id]);
  const setWorkspace = useCallback(
    (nextWorkspace: WorkspaceDetailsDto) => {
      setRuntimeState((current) =>
        current
          ? current.workspace.id !== nextWorkspace.id
            ? current
            : {
                ...current,
                workspace: nextWorkspace
              }
          : {
              workspace: nextWorkspace,
              workspaces: [
                {
                  id: nextWorkspace.id,
                  name: nextWorkspace.name,
                  updatedAt: nextWorkspace.updatedAt
                }
              ],
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

  const beginWorkspaceTransition = useCallback(() => {
    const transitionId = ++workspaceTransitionSequenceRef.current;
    workspaceRequestSequenceRef.current += 1;
    workspaceTransitionPendingRef.current = true;
    targetSelectionSequenceRef.current += 1;
    pendingTargetSelectionsRef.current.clear();
    setOperation("switching");
    setError(null);
    setNotice(null);
    return transitionId;
  }, []);

  const createWorkspace = useCallback(
    async (): Promise<boolean> => {
      const isCurrent = captureRequestScope();
      if (!isCurrent()) {
        return false;
      }
      let transitionId: number | undefined;
      setOperation("selecting");
      setError(null);
      setNotice(null);

      try {
        const selection =
          await window.gitnest.workspace.selectDirectory();
        if (!isCurrent()) {
          return false;
        }
        if (!selection.ok) {
          setError(selection.error);
          return false;
        }
        if (selection.value.cancelled) {
          return false;
        }

        transitionId = beginWorkspaceTransition();
        setOperation("scanning");
        const created = await window.gitnest.workspace.create({
          name: workspaceNameFromPath(selection.value.path),
          path: selection.value.path
        });
        if (transitionId !== workspaceTransitionSequenceRef.current) {
          return false;
        }
        if (!created.ok) {
          setError(created.error);
          return false;
        }

        const createdWorkspace = created.value.workspace;
        acceptRuntimeState(created.value);
        setNotice(
          `Workspace“${createdWorkspace.name}”已创建并完成目录扫描。` +
          (created.value.cleanupWarning
            ? ` ${created.value.cleanupWarning}`
            : "")
        );
        return true;
      } catch (reason) {
        if (
          transitionId === undefined
            ? isCurrent()
            : transitionId === workspaceTransitionSequenceRef.current
        ) {
          setUnexpectedError(reason);
        }
        return false;
      } finally {
        if (
          transitionId === undefined
            ? isCurrent()
            : transitionId === workspaceTransitionSequenceRef.current
        ) {
          workspaceTransitionPendingRef.current = false;
          setOperation(null);
        }
      }
    },
    [
      beginWorkspaceTransition,
      acceptRuntimeState,
      captureRequestScope,
      setUnexpectedError
    ]
  );

  const switchWorkspace = useCallback(
    async (workspaceId: string): Promise<boolean> => {
      if (
        currentWorkspaceIdRef.current === workspaceId &&
        !workspaceTransitionPendingRef.current
      ) {
        return true;
      }
      const transitionId = beginWorkspaceTransition();
      try {
        const result = await window.gitnest.workspace.switch({
          workspaceId
        });
        if (transitionId !== workspaceTransitionSequenceRef.current) {
          return false;
        }
        if (result.ok) {
          acceptRuntimeState(result.value);
          return true;
        }
        setError(result.error);
        return false;
      } catch (reason) {
        if (transitionId === workspaceTransitionSequenceRef.current) {
          setUnexpectedError(reason);
        }
        return false;
      } finally {
        if (transitionId === workspaceTransitionSequenceRef.current) {
          workspaceTransitionPendingRef.current = false;
          setOperation(null);
        }
      }
    },
    [
      beginWorkspaceTransition,
      acceptRuntimeState,
      setUnexpectedError,
      workspace?.id
    ]
  );

  const renameWorkspace = useCallback(
    async (
      workspaceId: string,
      name: string
    ): Promise<boolean> => {
      const isCurrent = captureRequestScope();
      if (!isCurrent()) {
        return false;
      }
      setOperation("saving");
      setError(null);
      setNotice(null);
      try {
        const result = await window.gitnest.workspace.rename({
          workspaceId,
          name
        });
        if (!isCurrent()) {
          return false;
        }
        if (result.ok) {
          setRuntimeState((current) =>
            current && current.workspace.id !== result.value.workspace.id
              ? current
              : result.value
          );
          setNotice("Workspace 名称已更新。");
          return true;
        }
        setError(result.error);
        return false;
      } catch (reason) {
        if (isCurrent()) {
          setUnexpectedError(reason);
        }
        return false;
      } finally {
        if (isCurrent()) {
          setOperation(null);
        }
      }
    },
    [captureRequestScope, setUnexpectedError]
  );

  const deleteWorkspace = useCallback(
    async (workspaceId: string): Promise<boolean> => {
      const transitionId = beginWorkspaceTransition();
      try {
        const result = await window.gitnest.workspace.delete({
          workspaceId
        });
        if (transitionId !== workspaceTransitionSequenceRef.current) {
          return false;
        }
        if (result.ok) {
          acceptRuntimeState(result.value);
          setNotice(
            "Workspace 已从 GitNest 中删除；磁盘上的仓库文件未被删除。" +
            (result.value.cleanupWarning ? ` ${result.value.cleanupWarning}` : "")
          );
          return true;
        }
        setError(result.error);
        return false;
      } catch (reason) {
        if (transitionId === workspaceTransitionSequenceRef.current) {
          setUnexpectedError(reason);
        }
        return false;
      } finally {
        if (transitionId === workspaceTransitionSequenceRef.current) {
          workspaceTransitionPendingRef.current = false;
          setOperation(null);
        }
      }
    },
    [acceptRuntimeState, beginWorkspaceTransition, setUnexpectedError]
  );

  useEffect(() => {
    let active = true;
    let receivedStateEvent = false;
    const requestSequence = workspaceRequestSequenceRef.current;
    const unsubscribe =
      window.gitnest.workspace.onStateChanged((state) => {
        if (active) {
          receivedStateEvent = true;
          acceptRuntimeState(state);
          setOperation((current) => current === "loading" ? null : current);
        }
      });

    void window.gitnest.workspace
      .getState()
      .then((result) => {
        if (
          !active ||
          requestSequence !== workspaceRequestSequenceRef.current
        ) {
          return;
        }

        if (result.ok) {
          if (!receivedStateEvent) {
            acceptRuntimeState(result.value);
          }
          setError(null);
        } else {
          setError(result.error);
        }
      })
      .catch((reason: unknown) => {
        if (active && requestSequence === workspaceRequestSequenceRef.current) {
          setUnexpectedError(reason);
        }
      })
      .finally(() => {
        if (active) {
          setOperation((current) => current === "loading" ? null : current);
        }
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [acceptRuntimeState, setUnexpectedError]);

  const refresh = useCallback(async () => {
    const isCurrent = captureRequestScope();
    if (!isCurrent()) {
      return;
    }
    setError(null);
    setNotice(null);

    try {
      const result = await window.gitnest.workspace.refresh();
      if (!isCurrent()) {
        return;
      }

      if (result.ok) {
        setNotice("Workspace 刷新已加入操作中心。");
      } else {
        setError(result.error);
      }
    } catch (reason) {
      if (isCurrent()) {
        setUnexpectedError(reason);
      }
    }
  }, [captureRequestScope, setUnexpectedError]);

  const rescan = useCallback(async (): Promise<boolean> => {
    const isCurrent = captureRequestScope();
    if (!isCurrent()) {
      return false;
    }
    setOperation("scanning");
    setError(null);
    setNotice(null);

    try {
      const result = await window.gitnest.workspace.rescan();
      if (!isCurrent()) {
        return false;
      }

      if (result.ok) {
        setWorkspace(result.value);
        setNotice("Workspace 重新扫描已完成。");
        return true;
      }

      setError(result.error);
      return false;
    } catch (reason) {
      if (isCurrent()) {
        setUnexpectedError(reason);
      }
      return false;
    } finally {
      if (isCurrent()) {
        setOperation(null);
      }
    }
  }, [captureRequestScope, setUnexpectedError, setWorkspace]);

  const removeRepository = useCallback(
    async (target: RepositoryTargetDto): Promise<boolean> => {
      const isCurrent = captureRequestScope();
      if (!isCurrent()) {
        return false;
      }
      setOperation("saving");
      setError(null);
      setNotice(null);

      try {
        const result =
          await window.gitnest.workspace.removeRepository({
            target
          });
        if (!isCurrent()) {
          return false;
        }

        if (result.ok) {
          setWorkspace(result.value);
          setNotice(
            "已移出 Workspace；磁盘上的仓库文件未被删除。"
          );
          return true;
        }

        setError(result.error);
        return false;
      } catch (reason) {
        if (isCurrent()) {
          setUnexpectedError(reason);
        }
        return false;
      } finally {
        if (isCurrent()) {
          setOperation(null);
        }
      }
    },
    [captureRequestScope, setUnexpectedError, setWorkspace]
  );

  const selectTarget = useCallback(
    async (target: RepositoryTargetDto) => {
      const isCurrent = captureRequestScope();
      if (!isCurrent()) {
        return false;
      }
      const requestId = ++targetSelectionSequenceRef.current;
      const selectionAlreadyPending =
        pendingTargetSelectionsRef.current.size > 0;
      pendingTargetSelectionsRef.current.add(requestId);
      if (
        !selectionAlreadyPending &&
        workspace?.selectedTarget?.repositoryId ===
          target.repositoryId &&
        workspace.selectedTarget.worktreeId === target.worktreeId
      ) {
        pendingTargetSelectionsRef.current.delete(requestId);
        return true;
      }

      try {
        const result = await window.gitnest.workspace.selectTarget({
          target
        });
        if (!isCurrent() || targetSelectionSequenceRef.current !== requestId) {
          return false;
        }
        if (result.ok) {
          setWorkspace(result.value);
          return true;
        } else {
          setError(result.error);
          return false;
        }
      } catch (reason) {
        if (isCurrent() && targetSelectionSequenceRef.current === requestId) {
          setUnexpectedError(reason);
        }
        return false;
      } finally {
        pendingTargetSelectionsRef.current.delete(requestId);
      }
    },
    [captureRequestScope, setUnexpectedError, setWorkspace, workspace?.selectedTarget]
  );

  const setGroupCollapsed = useCallback(
    async (
      groupId: string,
      collapsed: boolean
    ) => {
      const isCurrent = captureRequestScope();
      if (!isCurrent()) {
        return;
      }
      try {
        const result =
          await window.gitnest.workspace.setGroupCollapsed({
            groupId,
            collapsed
          });
        if (!isCurrent()) {
          return;
        }
        if (result.ok) {
          setWorkspace(result.value);
        } else {
          setError(result.error);
        }
      } catch (reason) {
        if (isCurrent()) {
          setUnexpectedError(reason);
        }
      }
    },
    [captureRequestScope, setUnexpectedError, setWorkspace]
  );

  const clearFeedback = useCallback(() => {
    setError(null);
    setNotice(null);
  }, []);

  return useMemo(
    () => ({
      workspace,
      workspaces: runtimeState?.workspaces ?? [],
      snapshots: runtimeState?.snapshots ?? [],
      operations: runtimeState?.operations ?? [],
      monitor: runtimeState?.monitor ?? null,
      error,
      notice,
      cleanupWarning: runtimeState?.cleanupWarning ?? null,
      operation,
      busy: operation !== null,
      createWorkspace,
      switchWorkspace,
      renameWorkspace,
      deleteWorkspace,
      refresh,
      rescan,
      removeRepository,
      selectTarget,
      setGroupCollapsed,
      clearFeedback
    }),
    [
      workspace,
      runtimeState?.workspaces,
      runtimeState?.snapshots,
      runtimeState?.operations,
      runtimeState?.monitor,
      runtimeState?.cleanupWarning,
      error,
      notice,
      operation,
      createWorkspace,
      switchWorkspace,
      renameWorkspace,
      deleteWorkspace,
      refresh,
      rescan,
      removeRepository,
      selectTarget,
      setGroupCollapsed,
      clearFeedback
    ]
  );
}

function workspaceNameFromPath(path: string): string {
  const trimmed = path.trim().replace(/[\\/]+$/u, "");
  const name = trimmed
    .split(/[\\/]/u)
    .filter(Boolean)
    .at(-1);

  return (name || trimmed || "Workspace").slice(0, 120);
}
