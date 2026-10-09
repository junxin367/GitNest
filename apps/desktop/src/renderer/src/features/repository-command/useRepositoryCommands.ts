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
  operations: WorkspaceOperationDto[],
  workspaceId?: string
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
  const scopeKey = `${workspaceId ?? ""}:${targetKey}`;
  const scope = useMemo(() => ({ key: scopeKey }), [scopeKey]);
  const currentScopeRef = useRef<typeof scope | null>(scope);
  currentScopeRef.current = scope;
  const [active, setActive] =
    useState<RepositoryCommandDto["type"] | null>(null);
  const [preflight, setPreflightState] =
    useState<RepositoryCommandPreflightDto | null>(null);
  const preflightRef =
    useRef<RepositoryCommandPreflightDto | null>(null);
  const setPreflight = useCallback(
    (value: RepositoryCommandPreflightDto | null) => {
      preflightRef.current = value;
      setPreflightState(value);
    },
    []
  );
  const [error, setError] =
    useState<GitReadErrorDto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [trackedOperationIds, setTrackedOperationIds] =
    useState<string[]>([]);
  const [completionVersion, setCompletionVersion] = useState(0);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const acceptedTargets = useRef(new Map<string, string[]>());
  const pendingSubmissionError = useRef<GitReadErrorDto | null>(null);
  const pendingTerminalError = useRef<GitReadErrorDto | null>(null);
  const pendingCancellationNotice = useRef<string | null>(null);
  const operationsRef = useRef(operations);
  operationsRef.current = operations;
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
  const publishFeedback = useCallback((fallbackNotice: string | null) => {
    const submissionError = pendingSubmissionError.current;
    const terminalError = pendingTerminalError.current;
    const combinedError = submissionError && terminalError
      ? { ...submissionError, message: `${submissionError.message} ${terminalError.message}` }
      : submissionError ?? terminalError;
    setError(combinedError);
    setNotice(combinedError
      ? null
      : pendingCancellationNotice.current ?? fallbackNotice);
  }, []);
  const recordSubmissionError = useCallback((error: GitReadErrorDto) => {
    const previous = pendingSubmissionError.current;
    pendingSubmissionError.current = previous
      ? { ...previous, message: `${previous.message} ${error.message}` }
      : error;
    publishFeedback(null);
  }, [publishFeedback]);

  useEffect(() => {
    currentScopeRef.current = scope;
    generation.current += 1;
    inFlight.current = false;
    acceptedTargets.current.clear();
    pendingSubmissionError.current = null;
    pendingTerminalError.current = null;
    pendingCancellationNotice.current = null;
    setActive(null);
    setPreflight(null);
    setError(null);
    setNotice(null);
    setTrackedOperationIds([]);
    return () => {
      generation.current += 1;
      if (currentScopeRef.current === scope) {
        currentScopeRef.current = null;
      }
    };
  }, [scope, setPreflight]);

  useEffect(() => {
    if (trackedOperationIds.length === 0) {
      return;
    }

    const terminal = trackedOperationIds
      .filter((operationId) => acceptedTargets.current.has(operationId))
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
    for (const operationId of terminalIds) {
      acceptedTargets.current.delete(operationId);
    }
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
    if (failed && !pendingTerminalError.current) {
      pendingTerminalError.current = {
        code: "COMMAND_FAILED",
        message: failed.message,
        details: {}
      };
    }
    const cancelled = terminal.find(
      (operation) => operation.state === "cancelled"
    );
    if (cancelled) {
      pendingCancellationNotice.current ??= cancelled.message;
    }
    publishFeedback(
      terminal.length === 1
        ? terminal[0]?.message ?? "仓库操作已完成。"
        : `${terminal.length} 个仓库操作已完成。`
    );
  }, [operations, publishFeedback, trackedOperationIds]);

  const accept = useCallback(
    (
      result: {
        operationIds: string[];
      },
      command: RepositoryCommandDto
    ) => {
      const targetKeys = repositoryCommandTargetKeys(command);
      for (const operationId of result.operationIds) {
        acceptedTargets.current.set(operationId, targetKeys);
      }
      setTrackedOperationIds((current) => [
        ...new Set([...current, ...result.operationIds])
      ]);
      setPreflight(null);
      publishFeedback(
        `${repositoryCommandLabel(command.type)} 已加入操作中心。`
      );
    },
    [publishFeedback, setPreflight]
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
        recordSubmissionError(formatCommandError(result.error));
        return false;
      }

      accept(result.value, candidate.command);
      if (result.value.submissionError) {
        const error = formatCommandError(result.value.submissionError);
        const submissionError = {
          ...error,
          message: `已有 ${result.value.operationIds.length} 个仓库操作入队；其余操作未提交。${error.message}`
        };
        recordSubmissionError(submissionError);
        return false;
      }
      return true;
    },
    [accept, recordSubmissionError, setPreflight]
  );

  const request = useCallback(
    async (command: RepositoryCommandDto): Promise<boolean> => {
      const targetKeys = new Set(
        repositoryCommandTargetKeys(command)
      );
      const conflictingOperation = operationsRef.current.some(
        (operation) =>
          isRepositoryCommandOperation(operation.kind) &&
          isActiveOperation(operation.state) &&
          operation.targetIds.some((id) => targetKeys.has(id))
      );
      const conflictingSubmission = [
        ...acceptedTargets.current.values()
      ].some((ids) => ids.some((id) => targetKeys.has(id)));
      if (
        inFlight.current ||
        currentScopeRef.current !== scope ||
        preflightRef.current ||
        conflictingOperation ||
        conflictingSubmission
      ) {
        return false;
      }

      const requestGeneration = generation.current;
      inFlight.current = true;
      if (acceptedTargets.current.size === 0) {
        pendingSubmissionError.current = null;
        pendingTerminalError.current = null;
        pendingCancellationNotice.current = null;
      }
      setActive(command.type);
      setPreflight(null);
      publishFeedback(null);

      try {
        const result =
          await window.gitnest.repository.preflightCommand({
            command
          });
        if (requestGeneration !== generation.current) {
          return false;
        }
        if (!result.ok) {
          recordSubmissionError(formatCommandError(result.error));
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
          recordSubmissionError(unexpectedCommandError(reason));
        }
        return false;
      } finally {
        if (requestGeneration === generation.current) {
          inFlight.current = false;
          setActive(null);
        }
      }
    },
    [executePreflight, publishFeedback, recordSubmissionError, scope, setPreflight]
  );

  const confirm = useCallback(async (): Promise<boolean> => {
    if (
      !preflight ||
      preflightRef.current !== preflight ||
      currentScopeRef.current !== scope ||
      inFlight.current
    ) {
      return false;
    }

    const requestGeneration = generation.current;
    inFlight.current = true;
    preflightRef.current = null;
    setActive(preflight.command.type);
    publishFeedback(null);

    try {
      return await executePreflight(
        preflight,
        true,
        requestGeneration
      );
    } catch (reason) {
      if (requestGeneration === generation.current) {
        setPreflight(null);
        recordSubmissionError(unexpectedCommandError(reason));
      }
      return false;
    } finally {
      if (requestGeneration === generation.current) {
        inFlight.current = false;
        setActive(null);
      }
    }
  }, [executePreflight, preflight, publishFeedback, recordSubmissionError, scope, setPreflight]);

  const dismissPreflight = useCallback(() => {
    if (!inFlight.current && currentScopeRef.current === scope) {
      setPreflight(null);
    }
  }, [scope, setPreflight]);

  const cancelOperation = useCallback(
    async (operationId: string): Promise<boolean> => {
      if (currentScopeRef.current !== scope) {
        return false;
      }
      const requestGeneration = generation.current;
      try {
        const result =
          await window.gitnest.repository.cancelOperation({
            operationId
          });
        if (requestGeneration !== generation.current) {
          return false;
        }
        if (!result.ok) {
          setNotice(null);
          setError(formatCommandError(result.error));
          return false;
        }
        if (!pendingSubmissionError.current && !pendingTerminalError.current) {
          setError(null);
          setNotice("正在取消仓库操作…");
        }
        return true;
      } catch (reason) {
        if (requestGeneration !== generation.current) {
          return false;
        }
        setNotice(null);
        setError(unexpectedCommandError(reason));
        return false;
      }
    },
    [scope]
  );

  const clearFeedback = useCallback(() => {
    if (currentScopeRef.current !== scope) {
      return;
    }
    setError(null);
    setNotice(null);
    // Dismissing a toast must not erase the outcome of operations still settling.
  }, [scope]);

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

function repositoryCommandTargetKeys(
  command: RepositoryCommandDto
): string[] {
  const targets =
    "targets" in command ? command.targets : [command.target];
  return targets.map(
    (target) => `${target.repositoryId}:${target.worktreeId}`
  );
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
    "workflow",
    "ignore-file",
    "remote-add",
    "remote-set-url",
    "remote-remove",
    "tag-create",
    "tag-delete",
    "tag-push",
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
