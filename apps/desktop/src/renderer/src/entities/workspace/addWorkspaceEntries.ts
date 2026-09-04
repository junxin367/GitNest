import type {
  AddWorkspaceEntryRequest,
  WorkspaceDetailsDto,
  WorkspaceErrorDto,
  WorkspaceMutationResultDto,
  WorkspaceResult
} from "@gitnest/contracts";

export interface WorkspaceAddFailure {
  path: string;
  error: WorkspaceErrorDto;
}

export interface WorkspaceAddBatchResult {
  workspace: WorkspaceDetailsDto | null;
  added: number;
  duplicates: number;
  failures: WorkspaceAddFailure[];
}

export async function addWorkspaceEntries(
  paths: string[],
  source: AddWorkspaceEntryRequest["source"],
  initialWorkspace: WorkspaceDetailsDto | null,
  addEntry: (
    request: AddWorkspaceEntryRequest
  ) => Promise<WorkspaceResult<WorkspaceMutationResultDto>>
): Promise<WorkspaceAddBatchResult> {
  let workspace = initialWorkspace;
  let added = 0;
  let duplicates = 0;
  const failures: WorkspaceAddFailure[] = [];

  for (const path of paths) {
    const result = await addEntry({ path, source });

    if (!result.ok) {
      failures.push({
        path,
        error: result.error
      });
      continue;
    }

    workspace = result.value.workspace;

    if (result.value.duplicate) {
      duplicates += 1;
    } else {
      added += 1;
    }
  }

  return {
    workspace,
    added,
    duplicates,
    failures
  };
}
