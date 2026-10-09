import type { RepositoryTargetDto } from "./workspace.contracts";

export type RepositoryIgnoreScopeDto = "file" | "directory" | "extension";
export interface RepositoryIgnorePreflightRequest {
  target: RepositoryTargetDto;
  path: string;
  scope: RepositoryIgnoreScopeDto;
}
export interface RepositoryIgnorePreflightDto {
  preflightId: string;
  expiresAt: string;
  target: RepositoryTargetDto;
  path: string;
  scope: RepositoryIgnoreScopeDto;
  ignoreFilePath: string;
  rule: string;
  summary: string;
  warnings: string[];
  confirmationRequired: boolean;
}
export interface RepositoryIgnoreExecuteRequest { preflightId: string; confirmed: boolean }
export interface RepositoryIgnoreExecutionDto { operationId: string }
