import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import type {
  GitReadErrorDto,
  RepositoryCommandDto,
  RepositoryCommandPreflightDto,
  RepositoryTargetDto,
  WorkspaceOperationDto
} from "@gitnest/contracts";

import { formatLocalMutationErrorMessage } from "../../entities/repository/useRepositoryMutations";

export interface RepositoryCommandController {
  active: RepositoryCommandDto["type"] | null;
  busy: boolean;
  preflight: RepositoryCommandPreflightDto | null;
  error: GitReadErrorDto | null;
  notice: string | null;
  completionVersion: number;
  request(command: RepositoryCommandDto): Promise<boolean>;
  confirm(): Promise<boolean>;
  dismissPreflight(): void;
  cancelOperation(operationId: string): Promise<boolean>;
  clearFeedback(): void;
}

const TERMINAL_STATES = new Set<
  WorkspaceOperationDto["state"]
>(["succeeded", "failed", "cancelled", "interrupted"]);

export function useRepositoryCommands(
  target: RepositoryTargetDto | undefined,
  operations: WorkspaceOperationDto[]
): RepositoryCommandController {
  const stableTarget = useMemo(
    () =>
      target
        ? {
            repositoryId: target.repositoryId,
            worktreeId: target.worktreeId
          }
        : undefined,
    [target?.repositoryId, target?.worktreeId]
  );
  const targetKey = stableTarget
    ? `${stableTarget.repositoryId}:${stableTarget.worktreeId}`
    : "";
  const [active, setActive] =
    useState<RepositoryCommandDto["type"] | null>(null);
  const [preflight, setPreflight] =
    useState<RepositoryCommandPreflightDto | null>(null);
  const [error, setError] =
    useState<GitReadErrorDto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [trackedOperationIds, setTrackedOperationIds] =
    useState<string[]>([]);
  const [completionVersion, setCompletionVersion] = useState(0);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const operationBusy = operations.some(
    (operation) =>
      isRepositoryCommandOperation(operation.kind) &&
      (operation.state === "queued" ||
        operation.state === "running" ||
        operation.state === "cancelling") &&
      operation.targetIds.includes(targetKey)
  );
  const trackedOperationBusy = trackedOperationIds.some(
    (operationId) => {
      const operation = operations.find(
        (candidate) => candidate.id === operationId
      );
      return !operation || isActiveOperation(operation.state);
    }
  );

  useEffect(() => {
    generation.current += 1;
    inFlight.current = false;
    setActive(null);
    setPreflight(null);
    setError(null);
    setNotice(null);
    setTrackedOperationIds([]);
  }, [targetKey]);

  useEffect(() => {
    if (trackedOperationIds.length === 0) {
      return;
    }

    const terminal = trackedOperationIds
      .map((operationId) =>
        operations.find((item) => item.id === operationId)
      )
      .filter(
        (
          operation
        ): operation is WorkspaceOperationDto =>
          Boolean(
            operation &&
              TERMINAL_STATES.has(operation.state)
          )
      );
    if (terminal.length === 0) {
      return;
    }

    const terminalIds = new Set(
      terminal.map((operation) => operation.id)
    );
    setTrackedOperationIds((current) =>
      current.filter(
        (operationId) => !terminalIds.has(operationId)
      )
    );
    setCompletionVersion((current) => current + 1);

    const failed = terminal.find(
      (operation) =>
        operation.state === "failed" ||
        operation.state === "interrupted"
    );
    if (failed) {
      setNotice(null);
      setError({
        code: "COMMAND_FAILED",
        message: failed.message,
        details: {}
      });
      return;
    }

    const cancelled = terminal.find(
      (operation) => operation.state === "cancelled"
    );
    setError(null);
    setNotice(
      cancelled
        ? cancelled.message
        : terminal.length === 1
          ? terminal[0]?.message ?? "仓库操作已完成。"
          : `${terminal.length} 个仓库操作已完成。`
    );
  }, [operations, trackedOperationIds]);

  const accept = useCallback(
    (
      result: {
        operationIds: string[];
      },
      command: RepositoryCommandDto
    ) => {
      setTrackedOperationIds((current) => [
        ...new Set([...current, ...result.operationIds])
      ]);
      setPreflight(null);
      setError(null);
      setNotice(
        `${repositoryCommandLabel(command.type)} 已加入操作中心。`
      );
    },
    []
  );

  const executePreflight = useCallback(
    async (
      candidate: RepositoryCommandPreflightDto,
      confirmed: boolean,
      requestGeneration: number
    ): Promise<boolean> => {
      const result =
        await window.gitnest.repository.executeCommand({
          command: candidate.command,
          preflightId: candidate.preflightId,
          confirmed
        });
      if (requestGeneration !== generation.current) {
        return false;
      }
      if (!result.ok) {
        setPreflight(null);
        setNotice(null);
        setError(formatCommandError(result.error));
        return false;
      }

      accept(result.value, candidate.command);
      return true;
    },
    [accept]
  );

  const request = useCallback(
    async (command: RepositoryCommandDto): Promise<boolean> => {
      if (inFlight.current) {
        return false;
      }

      const requestGeneration = generation.current;
      inFlight.current = true;
      setActive(command.type);
      setPreflight(null);
      setError(null);
      setNotice(null);

      try {
        const result =
          await window.gitnest.repository.preflightCommand({
            command
          });
        if (requestGeneration !== generation.current) {
          return false;
        }
        if (!result.ok) {
          setError(formatCommandError(result.error));
          return false;
        }

        if (result.value.confirmationRequired) {
          setPreflight(result.value);
          return true;
        }
        return await executePreflight(
          result.value,
          false,
          requestGeneration
        );
      } catch (reason) {
        if (requestGeneration === generation.current) {
          setError(unexpectedCommandError(reason));
        }
        return false;
      } finally {
        if (requestGeneration === generation.current) {
          inFlight.current = false;
          setActive(null);
        }
      }
    },
    [executePreflight]
  );

  const confirm = useCallback(async (): Promise<boolean> => {
    if (!preflight || inFlight.current) {
      return false;
    }

    const requestGeneration = generation.current;
    inFlight.current = true;
    setActive(preflight.command.type);
    setError(null);
    setNotice(null);

    try {
      return await executePreflight(
        preflight,
        true,
        requestGeneration
      );
    } catch (reason) {
      if (requestGeneration === generation.current) {
        setPreflight(null);
        setError(unexpectedCommandError(reason));
      }
      return false;
    } finally {
      if (requestGeneration === generation.current) {
        inFlight.current = false;
        setActive(null);
      }
    }
  }, [executePreflight, preflight]);

  const dismissPreflight = useCallback(() => {
    if (!inFlight.current) {
      setPreflight(null);
    }
  }, []);

  const cancelOperation = useCallback(
    async (operationId: string): Promise<boolean> => {
      try {
        const result =
          await window.gitnest.repository.cancelOperation({
            operationId
          });
        if (!result.ok) {
          setNotice(null);
          setError(formatCommandError(result.error));
          return false;
        }
        setError(null);
        setNotice("正在取消仓库操作…");
        return true;
      } catch (reason) {
        setNotice(null);
        setError(unexpectedCommandError(reason));
        return false;
      }
    },
    []
  );

  const clearFeedback = useCallback(() => {
    setError(null);
    setNotice(null);
  }, []);

  return {
    active,
    busy:
      active !== null ||
      preflight !== null ||
      operationBusy ||
      trackedOperationBusy,
    preflight,
    error,
    notice,
    completionVersion,
    request,
    confirm,
    dismissPreflight,
    cancelOperation,
    clearFeedback
  };
}

export function isRepositoryCommandOperation(
  kind: WorkspaceOperationDto["kind"]
): boolean {
  return [
    "fetch",
    "pull",
    "push",
    "switch-branch",
    "create-branch",
    "rename-branch",
    "delete-branch",
    "worktree-create",
    "worktree-lock",
    "worktree-unlock",
    "worktree-move",
    "worktree-repair",
    "worktree-prune",
    "worktree-remove"
  ].includes(kind);
}

function isActiveOperation(
  state: WorkspaceOperationDto["state"]
): boolean {
  return (
    state === "queued" ||
    state === "running" ||
    state === "cancelling"
  );
}

export function repositoryCommandLabel(
  type: RepositoryCommandDto["type"]
): string {
  return {
    fetch: "Fetch",
    pull: "Pull",
    push: "Push",
    "switch-branch": "切换分支",
    "create-branch": "创建分支",
    "rename-branch": "重命名分支",
    "delete-branch": "删除分支"
  }[type];
}

function formatCommandError(
  error: GitReadErrorDto
): GitReadErrorDto {
  const formatted = formatLocalMutationErrorMessage(error);
  const guidance =
    error.code === "PREFLIGHT_EXPIRED" ||
    error.code === "PREFLIGHT_CHANGED"
      ? "仓库状态已变化，请重新预检。"
      : error.code === "NON_FAST_FORWARD"
        ? "操作无法安全快进；请先 Fetch 并检查分支关系。"
        : error.code === "AUTHENTICATION_FAILED"
          ? "远程认证失败，请检查系统 Git 凭据或 SSH 配置。"
          : "";

  return {
    ...error,
    message: guidance
      ? `${guidance} ${formatted}`
      : formatted
  };
}

function unexpectedCommandError(
  reason: unknown
): GitReadErrorDto {
  return {
    code: "COMMAND_FAILED",
    message:
      reason instanceof Error
        ? reason.message
        : "仓库命令失败。",
    details: {}
  };
}
