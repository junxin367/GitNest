import type { RepositoryTargetDto } from "./workspace.contracts";

export type WorktreeCommandDto =
  | {
      type: "create";
      repositoryId: string;
      path: string;
      branch?: string;
      startPoint?: string;
    }
  | {
      type: "lock";
      worktreeId: string;
      reason?: string;
    }
  | {
      type: "unlock";
      worktreeId: string;
    }
  | {
      type: "move";
      worktreeId: string;
      destination: string;
    }
  | {
      type: "repair";
      worktreeId: string;
    }
  | {
      type: "prune";
      repositoryId: string;
    }
  | {
      type: "remove";
      worktreeId: string;
    };

export interface WorktreeCommandImpactDto {
  kind:
    | "worktree-directory"
    | "local-branch"
    | "worktree-lock"
    | "worktree-registration";
  target: RepositoryTargetDto;
  summary: string;
  detail: string;
}

export interface WorktreeCommandWarningDto {
  code:
    | "OUTSIDE_WORKSPACE"
    | "CREATE_BRANCH"
    | "DETACHED_HEAD"
    | "PRUNE_REGISTRATION"
    | "REMOVE_DIRECTORY";
  severity: "info" | "warning" | "danger";
  message: string;
}

export interface WorktreeCommandPreflightRequest {
  command: WorktreeCommandDto;
}

export interface WorktreeCommandPreflightDto {
  preflightId: string;
  expiresAt: string;
  command: WorktreeCommandDto;
  targetSummary: string;
  impacts: WorktreeCommandImpactDto[];
  warnings: WorktreeCommandWarningDto[];
  confirmationRequired: boolean;
}

export interface WorktreeCommandExecuteRequest {
  command: WorktreeCommandDto;
  preflightId: string;
  confirmed: boolean;
}

export interface WorktreeCommandExecutionDto {
  operationId: string;
}
