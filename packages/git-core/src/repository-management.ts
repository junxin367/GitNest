export interface ManagedRemote { name: string; fetchUrl: string; pushUrl: string; fetchUrls?: string[]; pushUrls?: string[] }
export interface ManagedTag { name: string; hash: string; subject: string }
export interface RepositoryManagementState { remotes: ManagedRemote[]; tags: ManagedTag[] }
export type RepositoryManagementAction =
  | { type: "remote-add" | "remote-set-url"; name: string; url: string }
  | { type: "remote-remove"; name: string }
  | { type: "tag-create"; name: string; revision: string; message?: string }
  | { type: "tag-delete"; name: string }
  | { type: "tag-push"; name: string; remote: string };
export interface RepositoryCreationInput {
  kind: "clone" | "init"; destination: string; url?: string; initialBranch?: string;
}
export interface RepositoryManagementPort {
  inspect(path: string, signal?: AbortSignal): Promise<RepositoryManagementState>;
  resolveCommit(path: string, revision: string): Promise<string>;
  validateAction(path: string, action: RepositoryManagementAction): Promise<void>;
  execute(path: string, action: RepositoryManagementAction, signal: AbortSignal): Promise<void>;
  create(input: RepositoryCreationInput, signal: AbortSignal, progress: (message: string) => void): Promise<void>;
}
