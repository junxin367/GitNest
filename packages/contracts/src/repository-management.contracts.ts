import type { GitReadResult } from "./git.contracts";
import type { RepositoryTargetDto } from "./workspace.contracts";

export interface RepositoryRemoteDto {
  name: string;
  fetchUrl: string;
  pushUrl: string;
  fetchUrls?: string[];
  pushUrls?: string[];
}
export interface RepositoryTagDto {
  name: string;
  hash: string;
  subject: string;
}
export interface RepositoryManagementStateDto {
  remotes: RepositoryRemoteDto[];
  tags: RepositoryTagDto[];
}
export type RepositoryManagementActionDto =
  | { type: "remote-add" | "remote-set-url"; name: string; url: string }
  | { type: "remote-remove"; name: string }
  | { type: "tag-create"; name: string; revision: string; message?: string }
  | { type: "tag-delete"; name: string }
  | { type: "tag-push"; name: string; remote: string };
export interface RepositoryManagementCommandDto {
  target: RepositoryTargetDto;
  action: RepositoryManagementActionDto;
}
export interface RepositoryManagementPreflightDto {
  preflightId: string;
  expiresAt: string;
  command: RepositoryManagementCommandDto;
  summary: string;
}
export interface RepositoryCreationRequest {
  kind: "clone" | "init";
  destination: string;
  url?: string;
  initialBranch?: string;
}
export interface RepositoryCreationStateDto {
  operationId: string;
  kind: "clone" | "init";
  destination: string;
  state: "running" | "succeeded" | "failed" | "cancelled";
  message: string;
}
export interface RepositoryManagementBridge {
  inspect(request: { target: RepositoryTargetDto }): Promise<GitReadResult<RepositoryManagementStateDto>>;
  preflight(command: RepositoryManagementCommandDto): Promise<GitReadResult<RepositoryManagementPreflightDto>>;
  execute(request: { preflightId: string; confirmed: boolean }): Promise<GitReadResult<{ operationId: string }>>;
  create(request: RepositoryCreationRequest): Promise<GitReadResult<RepositoryCreationStateDto>>;
  creationStatus(request: { operationId: string }): Promise<GitReadResult<RepositoryCreationStateDto>>;
  cancelCreation(request: { operationId: string }): Promise<GitReadResult<void>>;
  openCommit(request: { target: RepositoryTargetDto; hash: string; remote?: string }): Promise<GitReadResult<{ url: string }>>;
}
