import type { RepositoryTargetDto } from "./workspace.contracts";
import type { ExternalTerminalKindDto } from "./system.contracts";

export const DEFAULT_AI_COMMIT_PROMPT =
  "根据下一次提交将包含的文件和代码变更，生成一条简洁准确的 Git 提交信息。使用 Conventional Commits 格式，使用中文，只返回提交信息，不要 Markdown。";
export const DEFAULT_DIFF_COMMIT_PANEL_HEIGHT = 180;
export const MIN_DIFF_COMMIT_PANEL_HEIGHT = 180;
export const MAX_DIFF_COMMIT_PANEL_HEIGHT = 420;

export type AppThemeDto = "dark" | "light";
export type DiffFileViewDto = "list" | "tree";
export type DiffLayoutDto = "split" | "unified";
export type GitFetchModeDto = "manual" | "startup";
export type GitPushStrategyDto = "rebase" | "merge";
export type LastContentViewDto = "workspace" | "repository";
export type WorkspaceTabDto =
  | "overview"
  | "repositories"
  | "activity"
  | "worktrees";
export type RepositoryTabDto =
  | "overview"
  | "changes"
  | "history"
  | "branches"
  | "worktrees";

export interface AppSettingsDto {
  general: {
    restoreLastView: boolean;
    defaultTerminalKind: ExternalTerminalKindDto | null;
  };
  appearance: {
    theme: AppThemeDto;
  };
  diff: {
    fileView: DiffFileViewDto;
    layout: DiffLayoutDto;
    wrap: boolean;
    treeDirectoriesCollapsed: boolean;
    commitPanelHeight: number;
  };
  git: {
    fetchMode: GitFetchModeDto;
    pushStrategy: GitPushStrategyDto;
  };
  ai: {
    enabled: boolean;
    apiUrl: string;
    model: string;
    prompt: string;
    apiKeyConfigured: boolean;
  };
  navigation: {
    lastContentView: LastContentViewDto;
    workspaceTab: WorkspaceTabDto;
    repositoryTab: RepositoryTabDto;
  };
}

export interface AppSettingsLoadDto {
  settings: AppSettingsDto;
  storageState: "missing" | "persisted";
}

export interface UpdateAppSettingsRequest {
  general?: {
    restoreLastView?: boolean;
    defaultTerminalKind?: ExternalTerminalKindDto | null;
  };
  appearance?: {
    theme?: AppThemeDto;
  };
  diff?: {
    fileView?: DiffFileViewDto;
    layout?: DiffLayoutDto;
    wrap?: boolean;
    treeDirectoriesCollapsed?: boolean;
    commitPanelHeight?: number;
  };
  git?: {
    fetchMode?: GitFetchModeDto;
    pushStrategy?: GitPushStrategyDto;
  };
  ai?: {
    enabled?: boolean;
    apiUrl?: string;
    model?: string;
    apiKey?: string;
    prompt?: string;
  };
  navigation?: {
    lastContentView?: LastContentViewDto;
    workspaceTab?: WorkspaceTabDto;
    repositoryTab?: RepositoryTabDto;
  };
}

export interface ClearAiApiKeyRequest {
  confirmed: boolean;
}

export interface TestAiConnectionRequest {
  apiUrl: string;
  model: string;
  apiKey?: string;
}

export interface AiConnectionTestResultDto {
  endpoint: string;
  model: string;
}

export interface GenerateAiCommitMessageRequest {
  target: RepositoryTargetDto;
}

export interface AiCommitMessageDto {
  message: string;
  stagedFiles: number;
  truncated: boolean;
}

export function createDefaultAppSettings(): AppSettingsDto {
  return {
    general: {
      restoreLastView: true,
      defaultTerminalKind: null
    },
    appearance: {
      theme: "dark"
    },
    diff: {
      fileView: "list",
      layout: "unified",
      wrap: false,
      treeDirectoriesCollapsed: false,
      commitPanelHeight: DEFAULT_DIFF_COMMIT_PANEL_HEIGHT
    },
    git: {
      fetchMode: "manual",
      pushStrategy: "rebase"
    },
    ai: {
      enabled: false,
      apiUrl: "",
      model: "",
      prompt: DEFAULT_AI_COMMIT_PROMPT,
      apiKeyConfigured: false
    },
    navigation: {
      lastContentView: "workspace",
      workspaceTab: "overview",
      repositoryTab: "overview"
    }
  };
}
