export interface NormalizedWorkspacePath {
  path: string;
  canonicalPath: string;
}

export type WorkspaceDirectoryEntryKind =
  | "directory"
  | "file"
  | "symbolic-link"
  | "other";

export interface WorkspaceDirectoryEntry {
  name: string;
  path: string;
  kind: WorkspaceDirectoryEntryKind;
}

export interface WorkspaceFileSystem {
  normalizePath(path: string): NormalizedWorkspacePath;
  basename(path: string): string;
  joinPath(parent: string, child: string): string;
  relativeSegments(parent: string, child: string): string[];
  isWithin(parent: string, child: string): boolean;
  pathDepth(path: string): number;
  resolveRealPath(path: string): Promise<string>;
  readDirectory(path: string): Promise<WorkspaceDirectoryEntry[]>;
}
