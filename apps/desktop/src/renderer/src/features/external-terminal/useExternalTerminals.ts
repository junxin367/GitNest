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
  target: RepositoryTargetDto | undefined,
  workspaceId?: string
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
  const scope = useMemo(
    () => ({ target: stableTarget, workspaceId }),
    [stableTarget, workspaceId]
  );
  const currentScopeRef = useRef<typeof scope | null>(scope);
  currentScopeRef.current = scope;
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
  const inFlight = useRef(false);

  const reload = useCallback(async () => {
    if (currentScopeRef.current !== scope) {
      return;
    }
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
  }, [scope]);

  useEffect(() => {
    currentScopeRef.current = scope;
    generation.current += 1;
    inFlight.current = false;
    setActive(null);
    setError(null);
    setNotice(null);
    void reload();
    return () => {
      generation.current += 1;
      if (currentScopeRef.current === scope) {
        currentScopeRef.current = null;
      }
    };
  }, [reload, scope]);

  const open = useCallback(
    async (kind: ExternalTerminalKindDto) => {
      if (!stableTarget || inFlight.current || currentScopeRef.current !== scope) {
        return false;
      }

      const requestGeneration = generation.current;
      const isCurrent = () =>
        requestGeneration === generation.current &&
        currentScopeRef.current === scope;
      inFlight.current = true;
      setActive(kind);
      setError(null);
      setNotice(null);
      try {
        const result =
          await window.gitnest.system.openExternalTerminal({
            target: stableTarget,
            kind
          });
        if (!isCurrent()) {
          return false;
        }
        if (!result.ok) {
          setError(result.error);
          return false;
        }
        setNotice(`${result.value.label} 已在当前 Worktree 打开。`);
        return true;
      } catch (reason) {
        if (isCurrent()) {
          setError(unexpectedTerminalError(reason));
        }
        return false;
      } finally {
        if (isCurrent()) {
          inFlight.current = false;
          setActive(null);
        }
      }
    },
    [scope, stableTarget]
  );

  const clearFeedback = useCallback(() => {
    if (currentScopeRef.current !== scope) {
      return;
    }
    setError(null);
    setNotice(null);
  }, [scope]);

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
