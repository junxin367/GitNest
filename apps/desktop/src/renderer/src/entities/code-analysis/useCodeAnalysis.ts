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
  action: "starting" | "cancelling" | null;
  installingLanguage: InstallableLanguageServerDto | null;
  error: GitReadErrorDto | null;
  start(scope: CodeAnalysisScopeDto): Promise<boolean>;
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
    "starting" | "cancelling" | null
  >(null);
  const [installingLanguage, setInstallingLanguage] =
    useState<InstallableLanguageServerDto | null>(null);
  const [error, setError] =
    useState<GitReadErrorDto | null>(null);
  const generationRef = useRef(0);
  const snapshotKeyRef = useRef("");

  const loadSnapshot = useCallback(
    async (generation = generationRef.current) => {
      try {
        const result =
          await window.gitnest.codeAnalysis.getSnapshot();
        if (generation !== generationRef.current) {
          return;
        }
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setSnapshot(result.value);
        snapshotKeyRef.current = result.value
          ? `${result.value.analysisId}:${result.value.generatedAt}`
          : "";
      } catch (reason) {
        if (generation === generationRef.current) {
          setError(unexpectedError(reason));
        }
      }
    },
    []
  );

  const applyState = useCallback(
    (nextState: CodeAnalysisStateDto) => {
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
      }
      if (
        nextState.state === "ready" &&
        nextState.analysisId &&
        nextState.generatedAt
      ) {
        const key = `${nextState.analysisId}:${nextState.generatedAt}`;
        if (snapshotKeyRef.current !== key) {
          void loadSnapshot();
        }
      } else if (
        nextState.snapshotAvailable &&
        !snapshotKeyRef.current
      ) {
        void loadSnapshot();
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
      applyState(result.value);
      if (result.value.snapshotAvailable) {
        await loadSnapshot(generation);
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
