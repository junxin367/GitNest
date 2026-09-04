import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import type {
  ExternalTerminalKindDto,
  ExternalTerminalProfileDto,
  GitReadErrorDto,
  RepositoryTargetDto
} from "@gitnest/contracts";

export interface ExternalTerminalController {
  profiles: ExternalTerminalProfileDto[];
  loading: boolean;
  active: ExternalTerminalKindDto | null;
  error: GitReadErrorDto | null;
  notice: string | null;
  reload(): Promise<void>;
  open(kind: ExternalTerminalKindDto): Promise<boolean>;
  clearFeedback(): void;
}

export function useExternalTerminals(
  target: RepositoryTargetDto | undefined
): ExternalTerminalController {
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
  const [profiles, setProfiles] = useState<
    ExternalTerminalProfileDto[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] =
    useState<ExternalTerminalKindDto | null>(null);
  const [error, setError] =
    useState<GitReadErrorDto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const generation = useRef(0);

  const reload = useCallback(async () => {
    const requestGeneration = generation.current;
    setLoading(true);
    try {
      const result =
        await window.gitnest.system.listExternalTerminals();
      if (requestGeneration !== generation.current) {
        return;
      }
      if (result.ok) {
        setProfiles(result.value);
        setError(null);
      } else {
        setProfiles([]);
        setError(result.error);
      }
    } catch (reason) {
      if (requestGeneration === generation.current) {
        setProfiles([]);
        setError(unexpectedTerminalError(reason));
      }
    } finally {
      if (requestGeneration === generation.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    generation.current += 1;
    setActive(null);
    setError(null);
    setNotice(null);
    void reload();
    return () => {
      generation.current += 1;
    };
  }, [reload, targetKey]);

  const open = useCallback(
    async (kind: ExternalTerminalKindDto) => {
      if (!stableTarget || active) {
        return false;
      }

      const requestGeneration = generation.current;
      setActive(kind);
      setError(null);
      setNotice(null);
      try {
        const result =
          await window.gitnest.system.openExternalTerminal({
            target: stableTarget,
            kind
          });
        if (requestGeneration !== generation.current) {
          return false;
        }
        if (!result.ok) {
          setError(result.error);
          return false;
        }
        setNotice(`${result.value.label} 已在当前 Worktree 打开。`);
        return true;
      } catch (reason) {
        if (requestGeneration === generation.current) {
          setError(unexpectedTerminalError(reason));
        }
        return false;
      } finally {
        if (requestGeneration === generation.current) {
          setActive(null);
        }
      }
    },
    [active, stableTarget]
  );

  const clearFeedback = useCallback(() => {
    setError(null);
    setNotice(null);
  }, []);

  return {
    profiles,
    loading,
    active,
    error,
    notice,
    reload,
    open,
    clearFeedback
  };
}

function unexpectedTerminalError(
  reason: unknown
): GitReadErrorDto {
  return {
    code: "COMMAND_FAILED",
    message:
      reason instanceof Error
        ? reason.message
        : "外部终端启动失败。",
    details: {}
  };
}
