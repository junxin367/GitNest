import {
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";

import type {
  CodeAnalysisScopeDto,
  CodeAnalysisSnapshotDto,
  CodeAnalysisStateDto,
  GitReadErrorDto,
  InstallableLanguageServerDto,
  LanguageServerInstallResultDto
} from "@gitnest/contracts";

export interface CodeAnalysisController {
  state: CodeAnalysisStateDto;
  snapshot: CodeAnalysisSnapshotDto | null;
  loading: boolean;
  action:
    | "starting"
    | "restoring"
    | "cancelling"
    | null;
  installingLanguage: InstallableLanguageServerDto | null;
  error: GitReadErrorDto | null;
  start(scope: CodeAnalysisScopeDto): Promise<boolean>;
  restoreSnapshot(
    scope: CodeAnalysisScopeDto
  ): Promise<boolean>;
  cancel(): Promise<boolean>;
  installLanguageServer(
    language: InstallableLanguageServerDto
  ): Promise<LanguageServerInstallResultDto | null>;
  reload(): Promise<void>;
  clearError(): void;
}

const INITIAL_STATE: CodeAnalysisStateDto = {
  state: "idle",
  snapshotAvailable: false
};

export function useCodeAnalysis(
  enabled = true
): CodeAnalysisController {
  const [state, setState] =
    useState<CodeAnalysisStateDto>(INITIAL_STATE);
  const [snapshot, setSnapshot] =
    useState<CodeAnalysisSnapshotDto | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [action, setAction] = useState<
    "starting" | "restoring" | "cancelling" | null
  >(null);
  const [installingLanguage, setInstallingLanguage] =
    useState<InstallableLanguageServerDto | null>(null);
  const [error, setError] =
    useState<GitReadErrorDto | null>(null);
  const generationRef = useRef(0);
  const stateRef = useRef<CodeAnalysisStateDto>(INITIAL_STATE);
  const snapshotRequestRef = useRef(0);
  const snapshotExpectationRef = useRef(
    snapshotExpectationKey(INITIAL_STATE)
  );
  const requestedSnapshotKeyRef = useRef("");
  const snapshotKeyRef = useRef("");

  const loadSnapshot = useCallback(
    async (
      expectedState: CodeAnalysisStateDto,
      generation = generationRef.current
    ) => {
      const expectationKey =
        snapshotExpectationKey(expectedState);
      const requestId = ++snapshotRequestRef.current;
      requestedSnapshotKeyRef.current = expectationKey;
      try {
        const result =
          await window.gitnest.codeAnalysis.getSnapshot();
        if (
          generation !== generationRef.current ||
          requestId !== snapshotRequestRef.current ||
          expectationKey !==
            snapshotExpectationRef.current ||
          expectationKey !==
            snapshotExpectationKey(stateRef.current)
        ) {
          return;
        }
        if (!result.ok) {
          requestedSnapshotKeyRef.current = "";
          setError(result.error);
          return;
        }
        if (
          !snapshotMatchesState(
            result.value,
            stateRef.current
          )
        ) {
          setSnapshot(null);
          snapshotKeyRef.current = "";
          requestedSnapshotKeyRef.current = "";
          setError({
            code: "COMMAND_FAILED",
            message:
              "代码分析快照与当前 Workspace 状态不匹配。",
            details: {}
          });
          return;
        }
        setSnapshot(result.value);
        snapshotKeyRef.current = result.value
          ? `${result.value.analysisId}:${result.value.generatedAt}`
          : "";
      } catch (reason) {
        if (
          generation === generationRef.current &&
          requestId === snapshotRequestRef.current &&
          expectationKey === snapshotExpectationRef.current &&
          expectationKey ===
            snapshotExpectationKey(stateRef.current)
        ) {
          requestedSnapshotKeyRef.current = "";
          setError(unexpectedError(reason));
        }
      }
    },
    []
  );

  const applyState = useCallback(
    (
      nextState: CodeAnalysisStateDto,
      loadAvailableSnapshot = true
    ) => {
      const expectationKey =
        snapshotExpectationKey(nextState);
      stateRef.current = nextState;
      if (
        snapshotExpectationRef.current !== expectationKey
      ) {
        snapshotExpectationRef.current = expectationKey;
        snapshotRequestRef.current += 1;
        requestedSnapshotKeyRef.current = "";
      }
      setState(nextState);
      setAction(null);
      if (nextState.error) {
        setError(nextState.error);
      } else if (nextState.state === "running") {
        setError(null);
      }
      if (!nextState.snapshotAvailable) {
        setSnapshot(null);
        snapshotKeyRef.current = "";
        requestedSnapshotKeyRef.current = "";
      }
      if (
        loadAvailableSnapshot &&
        nextState.state === "ready" &&
        nextState.analysisId &&
        nextState.generatedAt
      ) {
        const key = `${nextState.analysisId}:${nextState.generatedAt}`;
        if (
          snapshotKeyRef.current !== key &&
          requestedSnapshotKeyRef.current !== expectationKey
        ) {
          void loadSnapshot(nextState);
        }
      } else if (
        loadAvailableSnapshot &&
        nextState.snapshotAvailable &&
        !snapshotKeyRef.current &&
        requestedSnapshotKeyRef.current !== expectationKey
      ) {
        void loadSnapshot(nextState);
      }
    },
    [loadSnapshot]
  );

  const reload = useCallback(async () => {
    const generation = ++generationRef.current;
    setLoading(true);
    setError(null);
    try {
      const result =
        await window.gitnest.codeAnalysis.getState();
      if (generation !== generationRef.current) {
        return;
      }
      if (!result.ok) {
        setError(result.error);
        return;
      }
      applyState(result.value, false);
      if (result.value.snapshotAvailable) {
        await loadSnapshot(result.value, generation);
      } else {
        setSnapshot(null);
        snapshotKeyRef.current = "";
      }
    } catch (reason) {
      if (generation === generationRef.current) {
        setError(unexpectedError(reason));
      }
    } finally {
      if (generation === generationRef.current) {
        setLoading(false);
      }
    }
  }, [applyState, loadSnapshot]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    void reload();
    const unsubscribe =
      window.gitnest.codeAnalysis.onStateChanged(
        applyState
      );
    return () => {
      generationRef.current += 1;
      snapshotRequestRef.current += 1;
      unsubscribe();
    };
  }, [applyState, enabled, reload]);

  const start = useCallback(
    async (scope: CodeAnalysisScopeDto) => {
      setAction("starting");
      setError(null);
      try {
        const result =
          await window.gitnest.codeAnalysis.start({
            scope
          });
        if (!result.ok) {
          setError(result.error);
          setAction(null);
          return false;
        }
        return true;
      } catch (reason) {
        setError(unexpectedError(reason));
        setAction(null);
        return false;
      }
    },
    []
  );

  const cancel = useCallback(async () => {
    if (!state.analysisId || state.state !== "running") {
      return false;
    }
    setAction("cancelling");
    setError(null);
    try {
      const result =
        await window.gitnest.codeAnalysis.cancel({
          analysisId: state.analysisId
        });
      if (!result.ok) {
        setError(result.error);
        setAction(null);
        return false;
      }
      return true;
    } catch (reason) {
      setError(unexpectedError(reason));
      setAction(null);
      return false;
    }
  }, [state.analysisId, state.state]);

  const restoreSnapshot = useCallback(
    async (scope: CodeAnalysisScopeDto) => {
      setAction("restoring");
      setError(null);
      try {
        const result =
          await window.gitnest.codeAnalysis.restoreSnapshot({
            scope
          });
        if (!result.ok) {
          setError(result.error);
          setAction(null);
          return false;
        }
        if (!result.value) {
          setAction(null);
        }
        return result.value;
      } catch (reason) {
        setError(unexpectedError(reason));
        setAction(null);
        return false;
      }
    },
    []
  );

  const installLanguageServer = useCallback(
    async (language: InstallableLanguageServerDto) => {
      setInstallingLanguage(language);
      setError(null);
      try {
        const result =
          await window.gitnest.codeAnalysis.installLanguageServer({
            language
          });
        if (!result.ok) {
          setError(result.error);
          return null;
        }
        return result.value;
      } catch (reason) {
        setError(unexpectedError(reason));
        return null;
      } finally {
        setInstallingLanguage(null);
      }
    },
    []
  );

  const clearError = useCallback(() => setError(null), []);

  return {
    state,
    snapshot,
    loading,
    action,
    installingLanguage,
    error,
    start,
    restoreSnapshot,
    cancel,
    installLanguageServer,
    reload,
    clearError
  };
}

function unexpectedError(reason: unknown): GitReadErrorDto {
  return {
    code: "COMMAND_FAILED",
    message:
      reason instanceof Error
        ? reason.message
        : "代码分析操作失败。",
    details: {}
  };
}

function snapshotExpectationKey(
  state: CodeAnalysisStateDto
): string {
  const context = `${state.workspaceId ?? ""}\0${
    state.scope ?? ""
  }`;
  if (!state.snapshotAvailable) {
    return `unavailable\0${context}`;
  }
  if (
    state.state === "ready" &&
    state.analysisId &&
    state.generatedAt
  ) {
    return `ready\0${context}\0${state.analysisId}\0${state.generatedAt}`;
  }
  return `available\0${context}`;
}

function snapshotMatchesState(
  snapshot: CodeAnalysisSnapshotDto | null,
  state: CodeAnalysisStateDto
): boolean {
  if (!state.snapshotAvailable) {
    return snapshot === null;
  }
  if (
    !snapshot ||
    !state.workspaceId ||
    snapshot.workspaceId !== state.workspaceId ||
    (state.scope !== undefined &&
      snapshot.scope !== state.scope)
  ) {
    return false;
  }
  if (state.state !== "ready") {
    return true;
  }
  return (
    Boolean(state.analysisId) &&
    Boolean(state.generatedAt) &&
    snapshot.analysisId === state.analysisId &&
    snapshot.generatedAt === state.generatedAt
  );
}
