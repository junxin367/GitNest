import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import type {
  ChangedPathDto,
  GitReadErrorDto,
  GitReadResult,
  RepositoryTargetDto
} from "@gitnest/contracts";

export type RepositoryMutationKind =
  | "stage"
  | "unstage"
  | "discard"
  | "commit";

export interface RepositoryMutationController {
  active: RepositoryMutationKind | null;
  error: GitReadErrorDto | null;
  notice: string | null;
  stageChange(change: ChangedPathDto): Promise<boolean>;
  unstageChange(change: ChangedPathDto): Promise<boolean>;
  discardChange(change: ChangedPathDto): Promise<boolean>;
  stageChanges(changes: readonly ChangedPathDto[]): Promise<boolean>;
  unstageChanges(
    changes: readonly ChangedPathDto[]
  ): Promise<boolean>;
  discardChanges(
    changes: readonly ChangedPathDto[]
  ): Promise<boolean>;
  createCommit(
    subject: string,
    body?: string
  ): Promise<boolean>;
  clearFeedback(): void;
}

interface MutationHooks {
  beforeMutation(): void;
  afterMutation(): Promise<void>;
}

export function useRepositoryMutations(
  target: RepositoryTargetDto | undefined,
  hooks: MutationHooks
): RepositoryMutationController {
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
  const [active, setActive] =
    useState<RepositoryMutationKind | null>(null);
  const [error, setError] =
    useState<GitReadErrorDto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const targetKey = stableTarget
    ? `${stableTarget.repositoryId}:${stableTarget.worktreeId}`
    : "";
  const scope = useMemo(() => ({ targetKey }), [targetKey]);
  const currentScopeRef = useRef<typeof scope | null>(scope);
  currentScopeRef.current = scope;

  useEffect(() => {
    currentScopeRef.current = scope;
    generation.current += 1;
    inFlight.current = false;
    setActive(null);
    setError(null);
    setNotice(null);

    return () => {
      generation.current += 1;
      if (currentScopeRef.current === scope) {
        currentScopeRef.current = null;
      }
    };
  }, [scope]);

  const runMutation = useCallback(
    async <Result extends { operationId: string }>(
      kind: RepositoryMutationKind,
      invoke: (
        target: RepositoryTargetDto
      ) => Promise<GitReadResult<Result>>,
      successMessage: (result: Result) => string
    ): Promise<boolean> => {
      if (!stableTarget || currentScopeRef.current !== scope || inFlight.current) {
        return false;
      }

      inFlight.current = true;
      const requestGeneration = generation.current;
      hooks.beforeMutation();
      setActive(kind);
      setError(null);
      setNotice(null);

      try {
        const result = await invoke(stableTarget);
        if (requestGeneration !== generation.current) {
          return false;
        }

        if (!result.ok) {
          setError({
            ...result.error,
            message: formatLocalMutationErrorMessage(
              result.error
            )
          });
          return false;
        }

        const completedNotice = successMessage(result.value);
        setNotice(completedNotice);
        try {
          await hooks.afterMutation();
        } catch {
          // A failed read cannot undo a completed write or make it safe to retry.
          if (requestGeneration === generation.current) {
            setNotice(
              `${completedNotice} 状态刷新失败，请重新读取仓库状态。`
            );
          }
        }
        return requestGeneration === generation.current;
      } catch (reason) {
        if (requestGeneration === generation.current) {
          setError(unexpectedMutationError(reason));
        }
        return false;
      } finally {
        if (requestGeneration === generation.current) {
          inFlight.current = false;
          setActive(null);
        }
      }
    },
    [hooks, scope, stableTarget]
  );

  const stageChange = useCallback(
    (change: ChangedPathDto) =>
      runMutation(
        "stage",
        (mutationTarget) =>
          window.gitnest.repository.stage({
            target: mutationTarget,
            paths: mutationPathsForChange(change, "stage")
          }),
        () => "所选文件已暂存。"
      ),
    [runMutation]
  );

  const unstageChange = useCallback(
    (change: ChangedPathDto) =>
      runMutation(
        "unstage",
        (mutationTarget) =>
          window.gitnest.repository.unstage({
            target: mutationTarget,
            paths: mutationPathsForChange(change, "unstage")
          }),
        () => "所选文件已取消暂存。"
      ),
    [runMutation]
  );

  const discardChange = useCallback(
    (change: ChangedPathDto) =>
      runMutation(
        "discard",
        (mutationTarget) =>
          window.gitnest.repository.discard({
            target: mutationTarget,
            paths: mutationPathsForChange(change, "discard"),
            expectedUntrackedPaths: change.kind === "untracked"
              ? mutationPathsForChange(change, "discard")
              : []
          }),
        () => "所选文件的更改已放弃。"
      ),
    [runMutation]
  );

  const stageChanges = useCallback(
    (changes: readonly ChangedPathDto[]) =>
      runMutation(
        "stage",
        (mutationTarget) =>
          window.gitnest.repository.stage({
            target: mutationTarget,
            paths: mutationPathsForChanges(changes, "stage")
          }),
        () => `${changes.length} 个文件已暂存。`
      ),
    [runMutation]
  );

  const unstageChanges = useCallback(
    (changes: readonly ChangedPathDto[]) =>
      runMutation(
        "unstage",
        (mutationTarget) =>
          window.gitnest.repository.unstage({
            target: mutationTarget,
            paths: mutationPathsForChanges(changes, "unstage")
          }),
        () => `${changes.length} 个文件已取消暂存。`
      ),
    [runMutation]
  );

  const discardChanges = useCallback(
    (changes: readonly ChangedPathDto[]) =>
      runMutation(
        "discard",
        (mutationTarget) =>
          window.gitnest.repository.discard({
            target: mutationTarget,
            paths: mutationPathsForChanges(changes, "discard"),
            expectedUntrackedPaths: mutationPathsForChanges(
              changes.filter((change) => change.kind === "untracked"),
              "discard"
            )
          }),
        () => `${changes.length} 个文件的更改已放弃。`
      ),
    [runMutation]
  );

  const createCommit = useCallback(
    (subject: string, body?: string) =>
      runMutation(
        "commit",
        (mutationTarget) =>
          window.gitnest.repository.createCommit({
            target: mutationTarget,
            subject,
            ...(body?.trim() ? { body } : {})
          }),
        (result) =>
          result.commit.shortHash
            ? `提交 ${result.commit.shortHash} 已创建。`
            : "提交已创建，身份将在状态刷新后显示。"
      ),
    [runMutation]
  );

  const clearFeedback = useCallback(() => {
    if (currentScopeRef.current !== scope) {
      return;
    }
    setError(null);
    setNotice(null);
  }, [scope]);

  return {
    active,
    error,
    notice,
    stageChange,
    unstageChange,
    discardChange,
    stageChanges,
    unstageChanges,
    discardChanges,
    createCommit,
    clearFeedback
  };
}

export function mutationPathsForChange(
  change: ChangedPathDto,
  operation: Exclude<RepositoryMutationKind, "commit">
): string[] {
  // Once a rename is staged, the index contains only the new path.
  // Only unstaging must also restore the original path from HEAD.
  const includeOriginal =
    operation === "unstage" || change.indexStatus !== "R";
  return [
    change.path,
    ...(includeOriginal && change.originalPath
      ? [change.originalPath]
      : [])
  ];
}

export function mutationPathsForChanges(
  changes: readonly ChangedPathDto[],
  operation: Exclude<RepositoryMutationKind, "commit">
): string[] {
  return [
    ...new Set(
      changes.flatMap((change) =>
        mutationPathsForChange(change, operation)
      )
    )
  ];
}

export function canStageChange(
  change: ChangedPathDto
): boolean {
  return (
    change.kind === "untracked" ||
    change.kind === "unmerged" ||
    change.worktreeStatus !== "."
  );
}

export function canUnstageChange(
  change: ChangedPathDto
): boolean {
  return (
    change.kind !== "untracked" &&
    (change.kind === "unmerged" ||
      change.indexStatus !== ".")
  );
}

export function canDiscardChange(
  change: ChangedPathDto
): boolean {
  return (
    change.kind === "untracked" ||
    change.kind === "unmerged" ||
    change.worktreeStatus !== "."
  );
}

export function formatLocalMutationErrorMessage(
  error: GitReadErrorDto
): string {
  const stderr = error.details.stderr;
  if (typeof stderr !== "string") {
    return error.message;
  }

  const diagnostic = stderr
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,
      ""
    )
    .trim()
    .slice(0, 600);

  return diagnostic
    ? `${error.message} ${diagnostic}`
    : error.message;
}

function unexpectedMutationError(
  reason: unknown
): GitReadErrorDto {
  return {
    code: "COMMAND_FAILED",
    message:
      reason instanceof Error
        ? reason.message
        : "仓库写操作失败。",
    details: {}
  };
}
