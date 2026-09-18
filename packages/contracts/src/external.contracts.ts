import type {
  RepositoryTargetDto
} from "./workspace.contracts";

export type ExternalTerminalKindDto =
  | "windows-terminal"
  | "powershell"
  | "cmd"
  | "git-bash";

export interface ExternalTerminalProfileDto {
  kind: ExternalTerminalKindDto;
  label: string;
}

export type ExternalApplicationKindDto =
  | "vscode"
  | "cursor"
  | "intellij-idea"
  | "sublime-text"
  | "file-explorer"
  | "terminal"
  | "git-bash";

export interface ExternalApplicationProfileDto {
  kind: ExternalApplicationKindDto;
  label: string;
  iconDataUrl?: string;
}

export type OpenExternalApplicationContextDto =
  | {
      scope: "workspace";
    }
  | {
      scope: "repository";
      target: RepositoryTargetDto;
    }
  | {
      scope: "file";
      target: RepositoryTargetDto;
      path: string;
    };

export interface OpenExternalApplicationRequest {
  context: OpenExternalApplicationContextDto;
  kind: ExternalApplicationKindDto;
}

export interface ExternalApplicationOpenedDto {
  kind: ExternalApplicationKindDto;
  label: string;
  scope: OpenExternalApplicationContextDto["scope"];
}

export interface OpenExternalTerminalRequest {
  target: RepositoryTargetDto;
  kind: ExternalTerminalKindDto;
}

export interface ExternalTerminalOpenedDto {
  target: RepositoryTargetDto;
  kind: ExternalTerminalKindDto;
  label: string;
}
