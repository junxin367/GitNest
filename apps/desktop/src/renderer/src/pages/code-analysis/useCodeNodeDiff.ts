import {
  useEffect,
  useRef,
  useState
} from "react";

import type {
  CodeGraphNodeDto,
  GitReadErrorDto,
  RepositoryDiffDto
} from "@gitnest/contracts";

import { buildDiffViewerFiles } from "../../shared/model/diffViewModel";

export interface CodeNodeDiffDocument {
  mode: RepositoryDiffDto["diff"]["mode"];
  diff: RepositoryDiffDto["diff"];
}

export interface CodeNodeDiffState {
  documents: CodeNodeDiffDocument[];
  loading: boolean;
  error: GitReadErrorDto | null;
}

const EMPTY_STATE: CodeNodeDiffState = {
  documents: [],
  loading: false,
  error: null
};
const DEFAULT_CONTEXT_LINES = 3;
let querySequence = 0;

export function useCodeNodeDiff(
  node: CodeGraphNodeDto | null
): CodeNodeDiffState {
  const [state, setState] =
    useState<CodeNodeDiffState>(EMPTY_STATE);
  const activeQueriesRef = useRef(new Set<string>());
  const generationRef = useRef(0);
  const repositoryId = node?.location.repositoryId ?? "";
  const worktreeId = node?.location.worktreeId ?? "";
  const path = node?.location.path ?? "";
  const fileKey =
    repositoryId && worktreeId && path
      ? `${repositoryId}\0${worktreeId}\0${path}`
      : "";

  useEffect(() => {
    const generation = ++generationRef.current;
    cancelQueries(activeQueriesRef.current);

    if (!fileKey) {
      setState(EMPTY_STATE);
      return;
    }

    let disposed = false;
    const target = {
      repositoryId,
      worktreeId
    };
    const isCurrent = () =>
      !disposed && generationRef.current === generation;
    const createQuery = (kind: "changes" | "diff") => {
      const queryId = `code_node_${kind}_${Date.now()}_${++querySequence}`;
      activeQueriesRef.current.add(queryId);
      return queryId;
    };
    const finishQuery = (queryId: string) => {
      activeQueriesRef.current.delete(queryId);
    };

    setState({
      documents: [],
      loading: true,
      error: null
    });

    const load = async () => {
      const changesQueryId = createQuery("changes");
      let changesResult: Awaited<
        ReturnType<
          typeof window.gitnest.repository.getChanges
        >
      >;

      try {
        changesResult =
          await window.gitnest.repository.getChanges({
            queryId: changesQueryId,
            target
          });
      } catch (reason) {
        finishQuery(changesQueryId);
        if (isCurrent()) {
          setState({
            documents: [],
            loading: false,
            error: unexpectedError(reason)
          });
        }
        return;
      }
      finishQuery(changesQueryId);

      if (!isCurrent()) {
        return;
      }
      if (!changesResult.ok) {
        setState({
          documents: [],
          loading: false,
          error:
            changesResult.error.code === "COMMAND_CANCELLED"
              ? null
              : changesResult.error
        });
        return;
      }

      const matchingFiles = uniqueDiffFiles(
        buildDiffViewerFiles(
          changesResult.value.snapshot.changes
        ).filter(
          (file) =>
            sameRelativePath(file.path, path) ||
            sameRelativePath(
              file.change.originalPath,
              path
            )
        )
      );

      if (matchingFiles.length === 0) {
        setState(EMPTY_STATE);
        return;
      }

      const results = await Promise.all(
        matchingFiles.map(async (file) => {
          const queryId = createQuery("diff");
          try {
            return await window.gitnest.repository.getDiff({
              queryId,
              target,
              path: file.path,
              mode: file.mode,
              contextLines: DEFAULT_CONTEXT_LINES
            });
          } catch (reason) {
            return {
              ok: false as const,
              error: unexpectedError(reason)
            };
          } finally {
            finishQuery(queryId);
          }
        })
      );

      if (!isCurrent()) {
        return;
      }

      const documents: CodeNodeDiffDocument[] = [];
      let error: GitReadErrorDto | null = null;
      for (let index = 0; index < results.length; index += 1) {
        const result = results[index];
        const file = matchingFiles[index];
        if (!result || !file) {
          continue;
        }
        if (result.ok) {
          documents.push({
            mode: file.mode,
            diff: result.value.diff
          });
        } else if (
          !error &&
          result.error.code !== "COMMAND_CANCELLED"
        ) {
          error = result.error;
        }
      }

      setState({
        documents,
        loading: false,
        error
      });
    };

    void load();

    return () => {
      disposed = true;
      if (generationRef.current === generation) {
        generationRef.current += 1;
      }
      cancelQueries(activeQueriesRef.current);
    };
  }, [fileKey]);

  return state;
}

function uniqueDiffFiles(
  files: ReturnType<typeof buildDiffViewerFiles>
): ReturnType<typeof buildDiffViewerFiles> {
  return [
    ...new Map(
      files.map((file) => [
        `${file.mode}\0${file.path}`,
        file
      ])
    ).values()
  ];
}

function sameRelativePath(
  left: string | undefined,
  right: string
): boolean {
  return (
    left !== undefined &&
    left.replaceAll("\\", "/") === right.replaceAll("\\", "/")
  );
}

function cancelQueries(queryIds: Set<string>): void {
  for (const queryId of queryIds) {
    void window.gitnest.repository.cancelQuery({ queryId });
  }
  queryIds.clear();
}

function unexpectedError(reason: unknown): GitReadErrorDto {
  return {
    code: "COMMAND_FAILED",
    message:
      reason instanceof Error
        ? reason.message
        : "无法读取节点对应的 Diff。",
    details: {}
  };
}
