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

export type WorkspaceWorktreeBatchCommand = Extract<
  WorktreeCommandDto,
  { type: "prune" | "remove" }
>;

export interface WorkspaceWorktreeCommandController {
  active: WorkspaceWorktreeBatchCommand["type"] | null;
  busy: boolean;
  preflights: WorktreeCommandPreflightDto[];
  error: GitReadErrorDto | null;
  notice: string | null;
  request(
    commands: readonly WorkspaceWorktreeBatchCommand[]
  ): Promise<boolean>;
  confirm(): Promise<boolean>;
  dismissPreflight(): void;
  clearFeedback(): void;
}

export const MAX_WORKTREE_BATCH_COMMANDS = 20;
const TERMINAL_STATES = new Set<
  WorkspaceOperationDto["state"]
>(["succeeded", "failed", "cancelled", "interrupted"]);

export function useWorkspaceWorktreeCommands(
  scopeKey: string | undefined,
  operations: WorkspaceOperationDto[],
  onSettled?: () => void | Promise<unknown>,
  repositoryId?: string
): WorkspaceWorktreeCommandController {
  const [active, setActive] = useState<
    WorkspaceWorktreeBatchCommand["type"] | null
  >(null);
  const [preflights, setPreflights] = useState<
    WorktreeCommandPreflightDto[]
  >([]);
  const [error, setError] = useState<GitReadErrorDto | null>(
    null
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [trackedOperationIds, setTrackedOperationIds] =
    useState<string[]>([]);
  const [settling, setSettling] = useState(false);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const completedOperations = useRef(
    new Map<string, WorkspaceOperationDto>()
  );
  const pendingSubmissionError =
    useRef<GitReadErrorDto | null>(null);
  const completionPending =
    completedOperations.current.size > 0;
  const operationBusy = operations.some(
    (operation) =>
      (operation.kind === "worktree-prune" ||
        operation.kind === "worktree-remove") &&
      isActiveOperation(operation.state) &&
      operationMatchesRepository(operation, repositoryId)
  );
  const trackedBusy = trackedOperationIds.length > 0;

  useEffect(() => {
    generation.current += 1;
    inFlight.current = false;
    completedOperations.current.clear();
    setActive(null);
    setPreflights([]);
    setError(null);
    setNotice(null);
    setTrackedOperationIds([]);
    setSettling(false);
    pendingSubmissionError.current = null;
  }, [scopeKey]);

  useEffect(() => {
    if (trackedOperationIds.length === 0) {
      return;
    }
    const terminalById = new Map(
      operations
        .filter((operation) =>
          TERMINAL_STATES.has(operation.state)
        )
        .map((operation) => [operation.id, operation])
    );
    const completedIds = trackedOperationIds.filter(
      (operationId) => terminalById.has(operationId)
    );
    if (completedIds.length === 0) {
      return;
    }

    for (const operationId of completedIds) {
      const operation = terminalById.get(operationId);
      if (operation) {
        completedOperations.current.set(
          operationId,
          operation
        );
      }
    }
    const completedIdSet = new Set(completedIds);
    setTrackedOperationIds((current) =>
      current.filter(
        (operationId) => !completedIdSet.has(operationId)
      )
    );
  }, [operations, trackedOperationIds]);

  useEffect(() => {
    if (
      active !== null ||
      settling ||
      trackedOperationIds.length > 0 ||
      completedOperations.current.size === 0
    ) {
      return;
    }

    const terminal = [
      ...completedOperations.current.values()
    ];
    completedOperations.current.clear();
    setSettling(true);
    const settleGeneration = generation.current;
    void settleWorkspaceTopology(onSettled).finally(() => {
      if (settleGeneration !== generation.current) {
        return;
      }
      applyTerminalFeedback(
        terminal,
        pendingSubmissionError.current,
        setError,
        setNotice
      );
      pendingSubmissionError.current = null;
      setSettling(false);
    });
  }, [
    active,
    onSettled,
    settling,
    trackedOperationIds
  ]);

  const request = useCallback(
    async (
      commands: readonly WorkspaceWorktreeBatchCommand[]
    ): Promise<boolean> => {
      const uniqueCommands = deduplicateCommands(commands);
      if (
        inFlight.current ||
        !scopeKey ||
        uniqueCommands.length === 0 ||
        preflights.length > 0 ||
        trackedOperationIds.length > 0 ||
        completionPending ||
        operationBusy ||
        settling
      ) {
        return false;
      }
      const commandType = uniqueCommands[0]?.type;
      if (
        !commandType ||
        uniqueCommands.some(
          (command) => command.type !== commandType
        )
      ) {
        setNotice(null);
        setError({
          code: "INVALID_REQUEST",
          message: "一次只能批量处理同一种 Worktree 操作。",
          details: {}
        });
        return false;
      }
      if (
        uniqueCommands.length >
        MAX_WORKTREE_BATCH_COMMANDS
      ) {
        setNotice(null);
        setError({
          code: "INVALID_REQUEST",
          message: `一次最多处理 ${MAX_WORKTREE_BATCH_COMMANDS} 个 Worktree 命令，请缩小筛选范围后重试。`,
          details: {}
        });
        return false;
      }

      const requestGeneration = generation.current;
      inFlight.current = true;
      setActive(commandType);
      setPreflights([]);
      setError(null);
      setNotice(null);
      pendingSubmissionError.current = null;

      try {
        const results = await Promise.all(
          uniqueCommands.map((command) =>
            window.gitnest.worktree.preflightCommand({
              command
            })
          )
        );
        if (requestGeneration !== generation.current) {
          return false;
        }

        const candidates: WorktreeCommandPreflightDto[] = [];
        for (const result of results) {
          if (!result.ok) {
            setError(formatWorktreeError(result.error));
            return false;
          }
          candidates.push(result.value);
        }
        setPreflights(candidates);
        return true;
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
    [
      operationBusy,
      completionPending,
      preflights.length,
      scopeKey,
      settling,
      trackedOperationIds.length
    ]
  );

  const confirm = useCallback(async (): Promise<boolean> => {
    if (preflights.length === 0 || inFlight.current) {
      return false;
    }

    const requestGeneration = generation.current;
    const candidates = preflights;
    const commandType = batchCommandType(candidates);
    let acceptedCount = 0;
    inFlight.current = true;
    setActive(commandType);
    setError(null);
    setNotice(null);
    pendingSubmissionError.current = null;

    try {
      for (const candidate of candidates) {
        const result =
          await window.gitnest.worktree.executeCommand({
            command: candidate.command,
            preflightId: candidate.preflightId,
            confirmed: true
          });
        if (requestGeneration !== generation.current) {
          return false;
        }
        if (!result.ok) {
          const formatted = formatWorktreeError(result.error);
          const submissionError = {
            ...formatted,
            message:
              acceptedCount > 0
                ? `已有 ${acceptedCount} 个 Worktree 操作入队；其余操作未提交。${formatted.message}`
                : formatted.message
          };
          setPreflights([]);
          if (acceptedCount > 0) {
            pendingSubmissionError.current = submissionError;
          }
          setError(submissionError);
          return false;
        }
        acceptedCount += 1;
        setTrackedOperationIds((current) => [
          ...new Set([...current, result.value.operationId])
        ]);
      }

      setPreflights([]);
      setNotice(batchQueuedNotice(candidates));
      return true;
    } catch (reason) {
      if (requestGeneration === generation.current) {
        setPreflights([]);
        const formatted = unexpectedWorktreeError(reason);
        const submissionError = {
          ...formatted,
          message:
            acceptedCount > 0
              ? `已有 ${acceptedCount} 个 Worktree 操作入队；其余操作未提交。${formatted.message}`
              : formatted.message
        };
        if (acceptedCount > 0) {
          pendingSubmissionError.current = submissionError;
        }
        setError(submissionError);
      }
      return false;
    } finally {
      if (requestGeneration === generation.current) {
        inFlight.current = false;
        setActive(null);
      }
    }
  }, [preflights]);

  const dismissPreflight = useCallback(() => {
    if (!inFlight.current) {
      setPreflights([]);
    }
  }, []);

  const clearFeedback = useCallback(() => {
    setError(null);
    setNotice(null);
  }, []);

  return {
    active,
    busy:
      active !== null ||
      preflights.length > 0 ||
      operationBusy ||
      trackedBusy ||
      completionPending ||
      settling,
    preflights,
    error,
    notice,
    request,
    confirm,
    dismissPreflight,
    clearFeedback
  };
}

async function settleWorkspaceTopology(
  onSettled: (() => void | Promise<unknown>) | undefined
): Promise<void> {
  try {
    await onSettled?.();
  } catch {
    // Runtime state events remain the primary update path.
  }
}

function applyTerminalFeedback(
  terminal: WorkspaceOperationDto[],
  pendingSubmissionError: GitReadErrorDto | null,
  setError: (error: GitReadErrorDto | null) => void,
  setNotice: (notice: string | null) => void
): void {
  const failed = terminal.find(
    (operation) =>
      operation.state === "failed" ||
      operation.state === "interrupted"
  );
  if (failed) {
    setNotice(null);
    setError({
      code: "COMMAND_FAILED",
      message: pendingSubmissionError
        ? `${pendingSubmissionError.message} 已入队操作中另有失败：${failed.message}`
        : failed.message,
      details: {}
    });
    return;
  }
  if (pendingSubmissionError) {
    setNotice(null);
    setError(pendingSubmissionError);
    return;
  }
  const cancelled = terminal.find(
    (operation) => operation.state === "cancelled"
  );
  setError(null);
  setNotice(
    cancelled?.message ??
      terminal.at(-1)?.message ??
      "Worktree 批量操作已完成。"
  );
}

function deduplicateCommands(
  commands: readonly WorkspaceWorktreeBatchCommand[]
): WorkspaceWorktreeBatchCommand[] {
  return [
    ...new Map(
      commands.map((command) => [
        command.type === "prune"
          ? `prune:${command.repositoryId.trim()}`
          : `remove:${command.worktreeId.trim()}`,
        command
      ])
    ).values()
  ].filter((command) =>
    command.type === "prune"
      ? Boolean(command.repositoryId.trim())
      : Boolean(command.worktreeId.trim())
  );
}

function batchCommandType(
  preflights: readonly WorktreeCommandPreflightDto[]
): WorkspaceWorktreeBatchCommand["type"] {
  return preflights[0]?.command.type === "remove"
    ? "remove"
    : "prune";
}

function batchQueuedNotice(
  preflights: readonly WorktreeCommandPreflightDto[]
): string {
  return batchCommandType(preflights) === "remove"
    ? `${preflights.length} 个 Worktree 删除操作已加入操作中心。`
    : `${preflights.length} 个仓库的 Worktree 清除操作已加入操作中心。`;
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

function operationMatchesRepository(
  operation: WorkspaceOperationDto,
  repositoryId: string | undefined
): boolean {
  if (!repositoryId) {
    return true;
  }
  return operation.targetIds.some((targetId) =>
    targetId.startsWith(`${repositoryId}:`)
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
        : "Worktree 批量命令失败。",
    details: {}
  };
}
