import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore
} from "react";

import type {
  ExternalApplicationKindDto,
  ExternalApplicationProfileDto,
  GitReadErrorDto,
  OpenExternalApplicationContextDto
} from "@gitnest/contracts";

import {
  getRendererPreferenceStorage,
  readRendererPreference,
  rendererPreferenceKeys,
  writeRendererPreference
} from "../../shared/lib/renderer-preferences";
import { getExternalApplicationCatalog } from "./externalApplicationCatalog";

const EMPTY_PROFILES: ExternalApplicationProfileDto[] = [];

const APPLICATION_PRIORITY: ExternalApplicationKindDto[] = [
  "vscode",
  "cursor",
  "intellij-idea",
  "sublime-text",
  "file-explorer",
  "terminal",
  "git-bash"
];
const PREFERRED_APPLICATION_CHANGED =
  "gitnest:preferred-external-application-changed";

type ExternalApplicationDirectoryContext = Exclude<
  OpenExternalApplicationContextDto,
  { scope: "file" }
>;

export interface ExternalApplicationController {
  profiles: ExternalApplicationProfileDto[];
  preferredProfile: ExternalApplicationProfileDto | undefined;
  loading: boolean;
  active: ExternalApplicationKindDto | null;
  error: GitReadErrorDto | null;
  reload(): Promise<void>;
  open(kind: ExternalApplicationKindDto): Promise<boolean>;
  openFile(
    kind: ExternalApplicationKindDto,
    path: string,
    line?: number,
    column?: number
  ): Promise<boolean>;
  clearError(): void;
}

export function useExternalApplications(
  context: ExternalApplicationDirectoryContext | undefined,
  workspaceId?: string
): ExternalApplicationController {
  const repositoryId =
    context?.scope === "repository"
      ? context.target.repositoryId
      : "";
  const worktreeId =
    context?.scope === "repository"
      ? context.target.worktreeId
      : "";
  const stableContext = useMemo<
    ExternalApplicationDirectoryContext | undefined
  >(() => {
    if (context?.scope === "workspace") {
      return { scope: "workspace" };
    }
    if (context?.scope === "repository") {
      return {
        scope: "repository",
        target: {
          repositoryId: context.target.repositoryId,
          worktreeId: context.target.worktreeId
        }
      };
    }
    return undefined;
  }, [context?.scope, repositoryId, worktreeId]);
  const scope = useMemo(
    () => ({ context: stableContext, workspaceId }),
    [stableContext, workspaceId]
  );
  const currentScopeRef = useRef<typeof scope | null>(scope);
  currentScopeRef.current = scope;
  const catalog = getExternalApplicationCatalog(window.gitnest.system);
  const applicationState = useSyncExternalStore(catalog.subscribe, catalog.getSnapshot);
  const profiles = applicationState.profiles ?? EMPTY_PROFILES;
  const [preferredKind, setPreferredKind] = useState<
    ExternalApplicationKindDto | undefined
  >(readPreferredApplication);
  const [active, setActive] =
    useState<ExternalApplicationKindDto | null>(null);
  const [error, setError] =
    useState<GitReadErrorDto | null>(null);
  const generation = useRef(0);
  const inFlight = useRef(false);

  useEffect(() => {
    const onPreferenceChanged = (event: Event) => {
      const kind = (event as CustomEvent<ExternalApplicationKindDto>).detail;
      if (APPLICATION_PRIORITY.includes(kind)) {
        setPreferredKind(kind);
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (
        (event.key === rendererPreferenceKeys.preferredExternalApplication ||
          event.key === null) &&
        (!event.storageArea ||
          event.storageArea === getRendererPreferenceStorage())
      ) {
        setPreferredKind(readPreferredApplication());
      }
    };
    window.addEventListener(PREFERRED_APPLICATION_CHANGED, onPreferenceChanged);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(PREFERRED_APPLICATION_CHANGED, onPreferenceChanged);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const reload = useCallback(async () => {
    if (!stableContext || currentScopeRef.current !== scope) {
      return;
    }
    setError(null);
    await catalog.reload();
  }, [catalog, scope, stableContext]);

  useEffect(() => {
    currentScopeRef.current = scope;
    generation.current += 1;
    inFlight.current = false;
    setActive(null);
    setError(null);
    if (stableContext || workspaceId) {
      void catalog.ensureLoaded();
    }
    return () => {
      generation.current += 1;
      if (currentScopeRef.current === scope) {
        currentScopeRef.current = null;
      }
    };
  }, [catalog, scope, stableContext, workspaceId]);

  const openWithContext = useCallback(
    async (
      kind: ExternalApplicationKindDto,
      requestContext: OpenExternalApplicationContextDto
    ) => {
      if (inFlight.current || currentScopeRef.current !== scope) {
        return false;
      }
      const requestGeneration = generation.current;
      const isCurrent = () =>
        requestGeneration === generation.current &&
        currentScopeRef.current === scope;
      inFlight.current = true;
      setActive(kind);
      setError(null);
      try {
        const result =
          await window.gitnest.system.openExternalApplication({
            context: requestContext,
            kind
          });
        if (!isCurrent()) {
          return false;
        }
        if (!result.ok) {
          setError(result.error);
          return false;
        }
        setPreferredKind(result.value.kind);
        persistPreferredApplication(result.value.kind);
        return true;
      } catch (reason) {
        if (isCurrent()) {
          setError(
            unexpectedExternalApplicationError(reason)
          );
        }
        return false;
      } finally {
        if (isCurrent()) {
          inFlight.current = false;
          setActive(null);
        }
      }
    },
    [scope]
  );

  const open = useCallback(
    async (kind: ExternalApplicationKindDto) => {
      if (!stableContext) {
        return false;
      }
      return openWithContext(kind, stableContext);
    },
    [openWithContext, stableContext]
  );

  const openFile = useCallback(
    async (
      kind: ExternalApplicationKindDto,
      path: string,
      line?: number,
      column?: number
    ) => {
      if (
        !stableContext ||
        stableContext.scope !== "repository"
      ) {
        return false;
      }
      return openWithContext(kind, {
        scope: "file",
        target: stableContext.target,
        path,
        ...(line !== undefined ? { line } : {}),
        ...(column !== undefined ? { column } : {})
      });
    },
    [openWithContext, stableContext]
  );

  const clearError = useCallback(() => {
    setError(null);
    catalog.clearError();
  }, [catalog]);

  return {
    profiles,
    preferredProfile: selectPreferredExternalApplication(
      profiles,
      preferredKind
    ),
    loading: applicationState.loading ||
      (applicationState.profiles === null && applicationState.error === null),
    active,
    error: error ?? (stableContext ? applicationState.error : null),
    reload,
    open,
    openFile,
    clearError
  };
}

export function selectPreferredExternalApplication(
  profiles: ExternalApplicationProfileDto[],
  preferredKind: ExternalApplicationKindDto | undefined
): ExternalApplicationProfileDto | undefined {
  const preferred = profiles.find(
    (profile) => profile.kind === preferredKind
  );
  if (preferred) {
    return preferred;
  }

  for (const kind of APPLICATION_PRIORITY) {
    const profile = profiles.find(
      (candidate) => candidate.kind === kind
    );
    if (profile) {
      return profile;
    }
  }
  return undefined;
}

function readPreferredApplication():
  | ExternalApplicationKindDto
  | undefined {
  const value = readRendererPreference(
    getRendererPreferenceStorage(),
    rendererPreferenceKeys.preferredExternalApplication
  );
  return APPLICATION_PRIORITY.includes(
    value as ExternalApplicationKindDto
  )
    ? (value as ExternalApplicationKindDto)
    : undefined;
}

function persistPreferredApplication(
  kind: ExternalApplicationKindDto
): void {
  writeRendererPreference(
    getRendererPreferenceStorage(),
    rendererPreferenceKeys.preferredExternalApplication,
    kind
  );
  window.dispatchEvent(new CustomEvent(PREFERRED_APPLICATION_CHANGED, {
    detail: kind
  }));
}

function unexpectedExternalApplicationError(
  reason: unknown
): GitReadErrorDto {
  return {
    code: "COMMAND_FAILED",
    message:
      reason instanceof Error
        ? reason.message
        : "外部应用启动失败。",
    details: {}
  };
}
