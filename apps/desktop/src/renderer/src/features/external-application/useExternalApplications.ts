import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import type {
  ExternalApplicationKindDto,
  ExternalApplicationProfileDto,
  GitReadErrorDto,
  OpenExternalApplicationContextDto
} from "@gitnest/contracts";

const PREFERRED_APPLICATION_KEY =
  "gitnest.open-in.preferred-application";
const APPLICATION_PRIORITY: ExternalApplicationKindDto[] = [
  "vscode",
  "cursor",
  "intellij-idea",
  "sublime-text",
  "file-explorer",
  "terminal",
  "git-bash"
];

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
    path: string
  ): Promise<boolean>;
  clearError(): void;
}

export function useExternalApplications(
  context: ExternalApplicationDirectoryContext | undefined
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
  const contextKey =
    stableContext?.scope === "repository"
      ? `repository:${repositoryId}:${worktreeId}`
      : stableContext?.scope ?? "";
  const [profiles, setProfiles] = useState<
    ExternalApplicationProfileDto[]
  >([]);
  const [preferredKind, setPreferredKind] = useState<
    ExternalApplicationKindDto | undefined
  >(readPreferredApplication);
  const [loading, setLoading] = useState(true);
  const [active, setActive] =
    useState<ExternalApplicationKindDto | null>(null);
  const [error, setError] =
    useState<GitReadErrorDto | null>(null);
  const generation = useRef(0);

  const reload = useCallback(async () => {
    const requestGeneration = generation.current;
    setLoading(true);
    try {
      const result =
        await window.gitnest.system.listExternalApplications();
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
        setError(unexpectedExternalApplicationError(reason));
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
    void reload();
    return () => {
      generation.current += 1;
    };
  }, [contextKey, reload]);

  const openWithContext = useCallback(
    async (
      kind: ExternalApplicationKindDto,
      requestContext: OpenExternalApplicationContextDto
    ) => {
      if (active) {
        return false;
      }
      const requestGeneration = generation.current;
      setActive(kind);
      setError(null);
      try {
        const result =
          await window.gitnest.system.openExternalApplication({
            context: requestContext,
            kind
          });
        if (requestGeneration !== generation.current) {
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
        if (requestGeneration === generation.current) {
          setError(
            unexpectedExternalApplicationError(reason)
          );
        }
        return false;
      } finally {
        if (requestGeneration === generation.current) {
          setActive(null);
        }
      }
    },
    [active]
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
      path: string
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
        path
      });
    },
    [openWithContext, stableContext]
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    profiles,
    preferredProfile: selectPreferredExternalApplication(
      profiles,
      preferredKind
    ),
    loading,
    active,
    error,
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
  try {
    const value = localStorage.getItem(
      PREFERRED_APPLICATION_KEY
    );
    return APPLICATION_PRIORITY.includes(
      value as ExternalApplicationKindDto
    )
      ? (value as ExternalApplicationKindDto)
      : undefined;
  } catch {
    return undefined;
  }
}

function persistPreferredApplication(
  kind: ExternalApplicationKindDto
): void {
  try {
    localStorage.setItem(PREFERRED_APPLICATION_KEY, kind);
  } catch {
    // Preference persistence is best-effort.
  }
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
