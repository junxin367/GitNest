import {
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";

import type {
  GitReadErrorDto,
  WorkspaceOperationDto,
  WorktreeCommandDto,
  WorktreeCommandPreflightDto
} from "@gitnest/contracts";

export interface WorktreeCommandController {
  active: WorktreeCommandDto["type"] | null;
  busy: boolean;
  preflight: WorktreeCommandPreflightDto | null;
  error: GitReadErrorDto | null;
  notice: string | null;
  completionVersion: number;
  request(command: WorktreeCommandDto): Promise<boolean>;
  confirm(): Promise<boolean>;
  dismissPreflight(): void;
  chooseDirectory(): Promise<string | null>;
  cancelOperation(operationId: string): Promise<boolean>;
  clearFeedback(): void;
}

const TERMINAL_STATES = new Set<
  WorkspaceOperationDto["state"]
>(["succeeded", "failed", "cancelled", "interrupted"]);

export function useWorktreeCommands(
  repositoryId: string | undefined,
  operations: WorkspaceOperationDto[]
): WorktreeCommandController {
  const [active, setActive] =
    useState<WorktreeCommandDto["type"] | null>(null);
  const [preflight, setPreflight] =
    useState<WorktreeCommandPreflightDto | null>(null);
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
      isWorktreeOperation(operation.kind) &&
      isActiveOperation(operation.state) &&
      operation.targetIds.some((targetId) =>
        repositoryId
          ? targetId.startsWith(`${repositoryId}:`)
          : false
      )
  );
  const trackedBusy = trackedOperationIds.some(
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
  }, [repositoryId]);

  useEffect(() => {
    if (trackedOperationIds.length === 0) {
      return;
    }
    const terminal = trackedOperationIds
      .map((operationId) =>
        operations.find(
          (operation) => operation.id === operationId
        )
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

    const ids = new Set(
      terminal.map((operation) => operation.id)
    );
    setTrackedOperationIds((current) =>
      current.filter((operationId) => !ids.has(operationId))
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
      cancelled?.message ??
        terminal[0]?.message ??
        "Worktree 操作已完成。"
    );
  }, [operations, trackedOperationIds]);

  const accept = useCallback(
    (
      operationId: string,
      command: WorktreeCommandDto
    ) => {
      setTrackedOperationIds((current) => [
        ...new Set([...current, operationId])
      ]);
      setPreflight(null);
      setError(null);
      setNotice(
        `${worktreeCommandLabel(command.type)} 已加入操作中心。`
      );
    },
    []
  );

  const executePreflight = useCallback(
    async (
      candidate: WorktreeCommandPreflightDto,
      confirmed: boolean,
      requestGeneration: number
    ): Promise<boolean> => {
      const result =
        await window.gitnest.worktree.executeCommand({
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
        setError(formatWorktreeError(result.error));
        return false;
      }
      accept(result.value.operationId, candidate.command);
      return true;
    },
    [accept]
  );

  const request = useCallback(
    async (command: WorktreeCommandDto): Promise<boolean> => {
      if (inFlight.current || !repositoryId) {
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
          await window.gitnest.worktree.preflightCommand({
            command
          });
        if (requestGeneration !== generation.current) {
          return false;
        }
        if (!result.ok) {
          setError(formatWorktreeError(result.error));
          return false;
        }
        if (result.value.confirmationRequired) {
          setPreflight(result.value);
          return true;
        }
        return executePreflight(
          result.value,
          false,
          requestGeneration
        );
      } catch (reason) {
        if (requestGeneration === generation.current) {
          setError(unexpectedWorktreeError(reason));
        }
        return false;
      } finally {
        if (requestGeneration === generation.current) {
          inFlight.current = false;
          setActive(null);
        }
      }
    },
    [executePreflight, repositoryId]
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
        setError(unexpectedWorktreeError(reason));
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

  const chooseDirectory =
    useCallback(async (): Promise<string | null> => {
      try {
        const result =
          await window.gitnest.worktree.selectDirectory();
        if (!result.ok) {
          setNotice(null);
          setError({
            code: "DIRECTORY_UNAVAILABLE",
            message: result.error.message,
            details: result.error.details
          });
          return null;
        }
        if (result.value.cancelled) {
          return null;
        }
        setError(null);
        return result.value.path;
      } catch (reason) {
        setNotice(null);
        setError(unexpectedWorktreeError(reason));
        return null;
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
          setError(formatWorktreeError(result.error));
          return false;
        }
        setError(null);
        setNotice("正在取消 Worktree 操作…");
        return true;
      } catch (reason) {
        setNotice(null);
        setError(unexpectedWorktreeError(reason));
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
      trackedBusy,
    preflight,
    error,
    notice,
    completionVersion,
    request,
    confirm,
    dismissPreflight,
    chooseDirectory,
    cancelOperation,
    clearFeedback
  };
}

function isWorktreeOperation(
  kind: WorkspaceOperationDto["kind"]
): boolean {
  return [
    "worktree-create",
    "worktree-lock",
    "worktree-unlock",
    "worktree-move",
    "worktree-repair",
    "worktree-prune",
    "worktree-remove"
  ].includes(kind);
}

export function worktreeCommandLabel(
  type: WorktreeCommandDto["type"]
): string {
  return {
    create: "创建 Worktree",
    lock: "锁定 Worktree",
    unlock: "解锁 Worktree",
    move: "移动 Worktree",
    repair: "修复 Worktree 登记",
    prune: "清除失效 Worktree 登记",
    remove: "删除 Worktree"
  }[type];
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

function formatWorktreeError(
  error: GitReadErrorDto
): GitReadErrorDto {
  const guidance =
    error.code === "PREFLIGHT_EXPIRED" ||
    error.code === "PREFLIGHT_CHANGED"
      ? "Worktree 状态或路径已变化，请重新预检。"
      : error.code === "CONFIRMATION_REQUIRED"
        ? "此操作需要明确确认。"
        : "";
  return {
    ...error,
    message: guidance
      ? `${guidance} ${error.message}`
      : error.message
  };
}

function unexpectedWorktreeError(
  reason: unknown
): GitReadErrorDto {
  return {
    code: "COMMAND_FAILED",
    message:
      reason instanceof Error
        ? reason.message
        : "Worktree 命令失败。",
    details: {}
  };
}
