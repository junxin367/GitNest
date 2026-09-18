import { useEffect } from "react";

import type {
  RepositoryCommitDto,
  RepositoryTargetDto
} from "@gitnest/contracts";

import {
  useRepositoryCommitDiff,
  type RepositoryCommitDiffController
} from "../../entities/repository/useRepositoryCommitDiff";
import { formatCommitTimestamp } from "../../shared/lib/formatCommitTimestamp";
import { Button } from "../../shared/ui/Button";
import { Icon } from "../../shared/ui/Icon";
import {
  DEFAULT_DIFF_CONTEXT_LINES,
  DiffPanel,
  DiffViewerState,
  type DiffPanelState
} from "../../widgets/diff-workspace/DiffPanel";
import { repositoryDiffWorkspaceConfiguration } from "../../widgets/diff-workspace/diffWorkspaceConfiguration";

export type RepositoryCommitDetailView = "details" | "files";

export function RepositoryCommitDetail({
  commit,
  target,
  view
}: {
  commit: RepositoryCommitDto["commit"];
  target: RepositoryTargetDto;
  view: RepositoryCommitDetailView;
}) {
  const commitDiff = useRepositoryCommitDiff(
    target,
    commit.hash
  );
  const selectedFile = commit.files.find(
    (file) => file.path === commitDiff.selected?.path
  );

  useEffect(() => {
    const firstFile = commit.files[0];
    if (!commitDiff.selected && firstFile) {
      void commitDiff.selectFile(firstFile.path);
    }
  }, [
    commit.files,
    commitDiff.selected,
    commitDiff.selectFile
  ]);

  return (
    <div
      className="commit-detail-body"
      data-history-commit-view={view}
    >
      {view === "details" ? (
        <div className="history-commit-overview">
          <h2>{commit.subject}</h2>
          <div className="commit-detail-meta">
            <span>{commit.authorName}</span>
            <code>{commit.hash}</code>
            <span>
              {formatCommitTimestamp(commit.authoredAt)}
            </span>
          </div>
          {commit.refs.length > 0 && (
            <details
              className="commit-refs commit-refs-collapsible"
              key={commit.hash}
            >
              <summary>分支（{commit.refs.length}）</summary>
              <div className="commit-ref-list">
                {commit.refs.map((ref) => (
                  <span key={ref}>{ref}</span>
                ))}
              </div>
            </details>
          )}
          <p className="selected-commit-body">{commit.body}</p>
        </div>
      ) : (
        <section
          aria-label="提交变更文件"
          className="history-commit-files"
        >
          {commit.files.length > 0 ? (
            <div className="history-commit-file-browser">
              <div
                aria-label="提交文件列表"
                className="commit-file-list"
                role="list"
              >
                {commit.files.map((file) => {
                  const filePath = splitCommitFilePath(
                    file.path
                  );
                  return (
                    <div key={file.path} role="listitem">
                      <button
                        aria-current={
                          file.path === selectedFile?.path
                            ? "true"
                            : undefined
                        }
                        className="history-commit-file"
                        onClick={() =>
                          void commitDiff.selectFile(file.path)
                        }
                        title={file.path}
                        type="button"
                      >
                        <Icon name="fileCode" size={14} />
                        <span className="history-commit-file-path">
                          <strong>{filePath.name}</strong>
                          {filePath.directory ? (
                            <small>{filePath.directory}</small>
                          ) : null}
                        </span>
                        {file.binary ? (
                          <span className="history-commit-file-binary">
                            二进制
                          </span>
                        ) : (
                          <CommitFileStats
                            additions={file.additions}
                            deletions={file.deletions}
                          />
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
              <CommitFileDiffPreview
                commitDiff={commitDiff}
                commitHash={commit.hash}
                file={selectedFile}
              />
            </div>
          ) : (
            <DiffViewerState
              icon="files"
              message="Git 没有为该提交返回变更文件。"
              title="没有变更文件"
            />
          )}
        </section>
      )}
    </div>
  );
}

function CommitFileDiffPreview({
  commitDiff,
  commitHash,
  file
}: {
  commitDiff: RepositoryCommitDiffController;
  commitHash: string;
  file: RepositoryCommitDto["commit"]["files"][number] | undefined;
}) {
  if (!file) {
    return (
      <div className="history-commit-file-preview">
        <DiffViewerState
          icon="fileCode"
          message="从左侧选择一个文件，查看它在本次提交中的变更。"
          title="选择文件查看 Diff"
        />
      </div>
    );
  }

  const diff =
    commitDiff.diff?.commit.hash === commitHash &&
    commitDiff.diff.diff.path === file.path
      ? commitDiff.diff.diff
      : null;
  const state: DiffPanelState | undefined =
    commitDiff.loading && !diff
      ? {
          busy: true,
          icon: "refresh",
          message: "正在读取该提交中的变更文件。",
          title: "读取提交 Diff…"
        }
      : commitDiff.error && !diff
        ? {
            icon: "warning",
            message: commitDiff.error.message,
            title: "提交 Diff 读取失败"
          }
        : undefined;

  return (
    <div className="history-commit-file-preview">
      {commitDiff.error && diff ? (
        <div className="history-commit-file-error" role="alert">
          <Icon name="warning" size={14} />
          <span>{commitDiff.error.message}</span>
          <Button
            onClick={() =>
              void commitDiff.selectFile(file.path, {
                contextLines:
                  commitDiff.selected?.contextLines ??
                  DEFAULT_DIFF_CONTEXT_LINES,
                preserveDiff: true
              })
            }
            size="small"
            variant="default"
          >
            重试
          </Button>
        </div>
      ) : null}
      <DiffPanel
        additions={diff?.additions ?? file.additions}
        binary={diff?.binary ?? file.binary}
        className="history-commit-diff-panel"
        config={repositoryDiffWorkspaceConfiguration.document}
        content={diff?.content}
        contextLines={
          commitDiff.selected?.contextLines ??
          DEFAULT_DIFF_CONTEXT_LINES
        }
        contextLoading={commitDiff.loading}
        deletions={diff?.deletions ?? file.deletions}
        headerActions={
          commitDiff.error && !diff ? (
            <Button
              icon={<Icon name="refresh" size={13} />}
              onClick={() =>
                void commitDiff.selectFile(file.path)
              }
              size="small"
              variant="default"
            >
              重试
            </Button>
          ) : undefined
        }
        maxLines={4_000}
        media={diff?.media}
        onContextRequest={(request) =>
          void commitDiff.selectFile(file.path, {
            contextLines: request.contextLines,
            preserveDiff: true
          })
        }
        path={file.path}
        scopeKey={`commit:${commitHash}:${file.path}`}
        searchScopeKey={`commit:${commitHash}:${file.path}`}
        state={state}
        statsAvailable
        truncated={diff?.truncated}
      />
    </div>
  );
}

function CommitFileStats({
  additions,
  deletions
}: {
  additions: number | undefined;
  deletions: number | undefined;
}) {
  if (
    !Number.isFinite(additions) ||
    !Number.isFinite(deletions)
  ) {
    return null;
  }

  return (
    <span className="history-commit-file-stats">
      <span className="additions">+{additions}</span>
      <span className="deletions">-{deletions}</span>
    </span>
  );
}

function splitCommitFilePath(path: string): {
  directory: string;
  name: string;
} {
  const separator = path.lastIndexOf("/");
  if (separator < 0) {
    return {
      directory: "",
      name: path
    };
  }
  return {
    directory: path.slice(0, separator),
    name: path.slice(separator + 1)
  };
}
