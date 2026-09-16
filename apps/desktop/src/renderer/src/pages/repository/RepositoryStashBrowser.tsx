import React, {
  useCallback,
  useEffect,
  useMemo,
  useState
} from "react";

import type {
  GitReadErrorDto,
  RepositoryStashFilesDto,
  RepositoryStashesDto,
  StashFileStatDto,
  StashSummaryDto
} from "@gitnest/contracts";

import type { RepositoryStashMutationAction } from "../../entities/repository/useRepositoryStashes";
import { formatCommitTimestamp } from "../../shared/lib/formatCommitTimestamp";
import { Button } from "../../shared/ui/Button";
import { Icon } from "../../shared/ui/Icon";
import { Input } from "../../shared/ui/Input";
import { Skeleton } from "../../shared/ui/Skeleton";
import { DiffViewerState } from "../../widgets/diff-workspace/DiffPanel";
import {
  createRepositoryStashContextMenuState,
  RepositoryStashActionDialog,
  RepositoryStashContextMenu,
  type RepositoryStashContextMenuState
} from "./RepositoryStashActions";

interface RepositoryStashBrowserProps {
  stashes: RepositoryStashesDto | null;
  stashFiles: RepositoryStashFilesDto | null;
  selectedStashRef: string | null;
  loading: {
    stashes: boolean;
    files: boolean;
  };
  error: GitReadErrorDto | null;
  mutationBusy?: boolean;
  onReload(): void;
  onSelectStash(stashRef: string): void;
  onMutateStash?(
    action: RepositoryStashMutationAction,
    stash: StashSummaryDto
  ): void | boolean | Promise<void | boolean>;
}

const STASH_SKELETON_ROWS = [1, 2, 3] as const;
const FILE_SKELETON_ROWS = [1, 2, 3, 4, 5] as const;

export function RepositoryStashBrowser({
  stashes,
  stashFiles,
  selectedStashRef,
  loading,
  error,
  mutationBusy = false,
  onReload,
  onSelectStash,
  onMutateStash
}: RepositoryStashBrowserProps) {
  const [filter, setFilter] = useState("");
  const [contextMenu, setContextMenu] =
    useState<RepositoryStashContextMenuState | null>(null);
  const [pendingAction, setPendingAction] = useState<{
    action: RepositoryStashMutationAction;
    stash: StashSummaryDto;
  } | null>(null);
  const selectedStash = stashes?.stashes.find(
    (stash) => stash.ref === selectedStashRef
  );
  const selectedStashFiles =
    stashFiles?.stash.ref === selectedStashRef &&
    stashFiles.stash.hash === selectedStash?.hash
      ? stashFiles.stash
      : undefined;
  const selectedFiles = selectedStashFiles?.files;
  const filteredFiles = useMemo(() => {
    if (!selectedFiles) {
      return [];
    }
    const normalizedFilter = filter.trim().toLocaleLowerCase();
    if (!normalizedFilter) {
      return selectedFiles;
    }
    return selectedFiles.filter((file) =>
      file.path.toLocaleLowerCase().includes(normalizedFilter)
    );
  }, [filter, selectedFiles]);

  useEffect(() => {
    setFilter("");
  }, [selectedStashRef]);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const openContextMenu = useCallback(
    (
      event: React.MouseEvent<HTMLButtonElement>,
      stash: StashSummaryDto
    ) => {
      event.preventDefault();
      if (mutationBusy || !onMutateStash) {
        return;
      }
      onSelectStash(stash.ref);
      setContextMenu(
        createRepositoryStashContextMenuState(
          stash,
          event.clientX,
          event.clientY
        )
      );
    },
    [mutationBusy, onMutateStash, onSelectStash]
  );

  useEffect(() => {
    closeContextMenu();
    setPendingAction(null);
  }, [
    closeContextMenu,
    stashes?.target.repositoryId,
    stashes?.target.worktreeId
  ]);

  return (
    <>
      <div className="repository-stash-browser">
        <div
          aria-label="储藏列表"
          className="repository-stash-list"
          role="region"
        >
          <header className="repository-stash-pane-header">
            <div>
              <strong>储藏列表</strong>
              {stashes ? (
                <span>{stashes.stashes.length}</span>
              ) : null}
            </div>
            <Button
              aria-label="重新读取储藏列表"
              disabled={loading.stashes || mutationBusy}
              icon={<Icon name="refresh" size={14} />}
              loading={loading.stashes}
              onClick={onReload}
              size="small"
              title="重新读取储藏列表"
              variant="icon"
            />
          </header>
          <div className="repository-stash-list-body">
            {loading.stashes && !stashes ? (
              <RepositoryStashListSkeleton />
            ) : error && !stashes ? (
              <RepositoryStashError
                error={error}
                onRetry={onReload}
              />
            ) : stashes?.stashes.length ? (
              <div
                aria-label="储藏记录"
                className="repository-stash-items"
                role="list"
              >
                {stashes.stashes.map((stash) => (
                  <Button
                    aria-label={`${stash.ref} ${stash.subject}`}
                    aria-current={
                      stash.ref === selectedStashRef
                        ? "true"
                        : undefined
                    }
                    className="repository-stash-item"
                    key={stash.ref}
                    onClick={() => onSelectStash(stash.ref)}
                    onContextMenu={(event) =>
                      openContextMenu(event, stash)
                    }
                    type="button"
                    variant="unstyled"
                  >
                    <span className="repository-stash-item-heading">
                      <strong>{stash.ref}</strong>
                      {stash.files !== undefined ? (
                        <small>{stash.files} 个文件</small>
                      ) : null}
                    </span>
                    <span className="repository-stash-item-subject">
                      {stash.subject}
                    </span>
                    <span className="repository-stash-item-meta">
                      <time dateTime={stash.authoredAt}>
                        {formatCommitTimestamp(stash.authoredAt)}
                      </time>
                      <StashStats
                        additions={stash.additions}
                        deletions={stash.deletions}
                      />
                    </span>
                  </Button>
                ))}
              </div>
            ) : (
              <DiffViewerState
                icon="files"
                message="创建储藏后，它会显示在这里。"
                title="没有储藏的变更"
              />
            )}
          </div>
        </div>
        <div
          aria-label="储藏内容"
          className="repository-stash-detail"
          role="region"
        >
          {selectedStash ? (
            <>
              <header className="repository-stash-detail-header">
                <div className="repository-stash-detail-title">
                  <span>
                    <strong>{selectedStash.ref}</strong>
                    <code>
                      {selectedStash.hash.slice(0, 8)}
                    </code>
                  </span>
                  <h2>{selectedStash.subject}</h2>
                  <p>
                    {selectedStash.authorName}
                    <span aria-hidden="true"> · </span>
                    <time dateTime={selectedStash.authoredAt}>
                      {formatCommitTimestamp(
                        selectedStash.authoredAt
                      )}
                    </time>
                    {selectedStash.baseHash ? (
                      <>
                        <span aria-hidden="true"> · </span>
                        基于{" "}
                        <code>
                          {selectedStash.baseHash.slice(0, 8)}
                        </code>
                      </>
                    ) : null}
                  </p>
                </div>
                <div className="repository-stash-detail-summary">
                  {selectedFiles ||
                  selectedStash.files !== undefined ? (
                    <span>
                      {selectedFiles?.length ??
                        selectedStash.files}{" "}
                      个文件
                    </span>
                  ) : null}
                  <StashStats
                    additions={
                      selectedStashFiles?.additions ??
                      selectedStash.additions
                    }
                    deletions={
                      selectedStashFiles?.deletions ??
                      selectedStash.deletions
                    }
                  />
                </div>
              </header>
              <div className="repository-stash-file-toolbar">
                <strong>文件</strong>
                <Input
                  aria-label="筛选储藏文件"
                  clearLabel="清除储藏文件筛选"
                  fieldClassName="repository-stash-file-filter-field"
                  fullWidth
                  leading={<Icon name="search" size={13} />}
                  onChange={(event) =>
                    setFilter(event.currentTarget.value)
                  }
                  placeholder="筛选文件"
                  size="small"
                  value={filter}
                  {...(filter
                    ? { onClear: () => setFilter("") }
                    : {})}
                />
              </div>
              <div className="repository-stash-file-list">
                {loading.files && !selectedFiles ? (
                  <RepositoryStashFileSkeleton />
                ) : error && !selectedFiles ? (
                  <RepositoryStashError
                    error={error}
                    onRetry={onReload}
                  />
                ) : selectedFiles?.length === 0 ? (
                  <DiffViewerState
                    icon="files"
                    message="Git 没有为这条储藏记录返回文件。"
                    title="储藏内容为空"
                  />
                ) : filter && filteredFiles.length === 0 ? (
                  <DiffViewerState
                    icon="search"
                    message="尝试输入文件名或目录。"
                    title="没有匹配的文件"
                  />
                ) : (
                  filteredFiles.map((file) => (
                    <RepositoryStashFile
                      file={file}
                      key={file.path}
                    />
                  ))
                )}
              </div>
            </>
          ) : loading.stashes ? (
            <RepositoryStashDetailSkeleton />
          ) : (
            <DiffViewerState
              icon="files"
              message="从左侧选择一条储藏记录以查看其中的文件。"
              title="选择一条储藏记录"
            />
          )}
        </div>
      </div>
      <RepositoryStashContextMenu
        contextMenu={contextMenu}
        mutationBusy={mutationBusy}
        onChoose={(action, stash) =>
          setPendingAction({ action, stash })
        }
        onClose={closeContextMenu}
      />
      {pendingAction && onMutateStash ? (
        <RepositoryStashActionDialog
          action={pendingAction.action}
          mutationBusy={mutationBusy}
          stash={pendingAction.stash}
          onCancel={() => setPendingAction(null)}
          onConfirm={onMutateStash}
        />
      ) : null}
    </>
  );
}

function RepositoryStashFile({
  file
}: {
  file: StashFileStatDto;
}) {
  const { directory, name } = splitFilePath(file.path);

  return (
    <div
      aria-label={file.path}
      className="repository-stash-file"
      title={file.path}
    >
      <Icon name="fileCode" size={15} />
      <span className="repository-stash-file-path">
        <strong>{name}</strong>
        {directory ? <small>{directory}</small> : null}
      </span>
      {file.binary ? (
        <span className="repository-stash-binary">二进制</span>
      ) : (
        <StashStats
          additions={file.additions}
          deletions={file.deletions}
        />
      )}
    </div>
  );
}

function StashStats({
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
    <span className="repository-stash-stats">
      <span className="additions">+{additions}</span>
      <span className="deletions">-{deletions}</span>
    </span>
  );
}

function RepositoryStashError({
  error,
  onRetry
}: {
  error: GitReadErrorDto;
  onRetry(): void;
}) {
  return (
    <div className="repository-stash-state">
      <Icon name="warning" size={20} />
      <strong>储藏内容暂时不可用</strong>
      <p>{error.message}</p>
      <Button
        icon={<Icon name="refresh" size={13} />}
        onClick={onRetry}
        size="small"
        variant="default"
      >
        重试
      </Button>
    </div>
  );
}

function RepositoryStashListSkeleton() {
  return (
    <div
      aria-label="正在读取储藏列表"
      className="repository-stash-skeleton-list"
      role="status"
    >
      {STASH_SKELETON_ROWS.map((row) => (
        <div className="repository-stash-skeleton-item" key={row}>
          <Skeleton height={11} width="30%" />
          <Skeleton height={10} width="82%" />
          <Skeleton height={9} width="58%" />
        </div>
      ))}
    </div>
  );
}

function RepositoryStashDetailSkeleton() {
  return (
    <div
      aria-label="正在读取储藏内容"
      className="repository-stash-detail-skeleton"
      role="status"
    >
      <Skeleton height={14} width={86} />
      <Skeleton height={20} width="54%" />
      <Skeleton height={11} width="38%" />
    </div>
  );
}

function RepositoryStashFileSkeleton() {
  return (
    <div
      aria-label="正在读取储藏文件"
      className="repository-stash-file-skeleton"
      role="status"
    >
      {FILE_SKELETON_ROWS.map((row) => (
        <div className="repository-stash-skeleton-file" key={row}>
          <Skeleton height={14} width={14} />
          <Skeleton height={10} width={`${48 + row * 7}%`} />
          <Skeleton height={10} width={42} />
        </div>
      ))}
    </div>
  );
}

function splitFilePath(path: string): {
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
