import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent
} from "react";

import type {
  GitReadErrorDto,
  RepositoryCommitDto,
  RepositoryStatusSnapshotDto,
  RepositoryTargetDto,
  WorkspaceDetailsDto,
  WorkspaceOperationDto
} from "@gitnest/contracts";

import type { RepositoryTab } from "../../app/navigation";
import { useRepositoryDetails } from "../../entities/repository/useRepositoryDetails";
import type { ExternalApplicationController } from "../../features/external-application/useExternalApplications";
import type { RepositoryCommandController } from "../../features/repository-command/useRepositoryCommands";
import type { ExternalTerminalController } from "../../features/external-terminal/useExternalTerminals";
import { WorktreeCommandDialog } from "../../features/worktree-command/WorktreeCommandDialog";
import { useWorktreeCommands } from "../../features/worktree-command/useWorktreeCommands";
import {
  canStageChange,
  canUnstageChange,
  useRepositoryMutations
} from "../../entities/repository/useRepositoryMutations";
import {
  findTargetSnapshot,
  getSnapshotChangeCount,
  resolveWorkspaceTarget
} from "../../entities/workspace/model";
import { Icon } from "../../shared/ui/Icon";
import { LayerPortal } from "../../shared/ui/LayerPortal";
import {
  buildDiffViewerFiles,
  type DiffViewerFile
} from "../../shared/model/diffViewModel";
import { copyTextToClipboard } from "../../shared/lib/copyTextToClipboard";
import { formatCommitTimestamp } from "../../shared/lib/formatCommitTimestamp";
import {
  Menu,
  MenuHeading,
  MenuItem,
  MenuPopover
} from "../../shared/ui/Menu";
import { Toast, ToastViewport } from "../../shared/ui/Toast";
import {
  getRendererPreferenceStorage,
  readTreeDirectoriesCollapsedPreference,
  writeTreeDirectoriesCollapsedPreference
} from "./changeTreePreferences";
import { RepositoryWorktrees } from "./RepositoryWorktrees";
import { ApplicationIcon } from "../../widgets/repository-header/OpenInControl";
import {
  type DiffPanelState
} from "../../widgets/diff-workspace/DiffPanel";
import {
  DiffWorkspace,
  parseCommitMessage
} from "../../widgets/diff-workspace/DiffWorkspace";
import { repositoryDiffWorkspaceConfiguration } from "../../widgets/diff-workspace/diffWorkspaceConfiguration";

interface RepositoryPageProps {
  workspace: WorkspaceDetailsDto | null;
  snapshots: RepositoryStatusSnapshotDto[];
  operations: WorkspaceOperationDto[];
  target: RepositoryTargetDto | undefined;
  tab: RepositoryTab;
  commands: RepositoryCommandController;
  terminals: ExternalTerminalController;
  externalApplications: ExternalApplicationController;
  onOpenTab(tab: RepositoryTab): void;
  onCommitSelectionChange?(
    commit: RepositoryCommitDto["commit"] | null
  ): void;
}

interface ChangeFileContextMenuState {
  path: string;
  x: number;
  y: number;
}

interface BranchMenuState {
  anchor: HTMLButtonElement;
  branchName: string;
}

export function RepositoryPage({
  workspace,
  snapshots,
  operations,
  target,
  tab,
  commands,
  terminals,
  externalApplications,
  onOpenTab,
  onCommitSelectionChange
}: RepositoryPageProps) {
  const snapshot = findTargetSnapshot(snapshots, target);
  const statusRevision = snapshot
    ? [
        snapshot.refreshedAt,
        snapshot.head,
        snapshot.branch ?? "",
        snapshot.staged,
        snapshot.unstaged,
        snapshot.untracked,
        snapshot.conflicted,
        snapshot.error?.code ?? "",
        snapshot.error?.message ?? ""
      ].join("|")
    : "";
  const details = useRepositoryDetails(
    target,
    tab,
    statusRevision
  );

  useEffect(() => {
    onCommitSelectionChange?.(
      tab === "history"
        ? details.commit?.commit ?? null
        : null
    );
  }, [
    details.commit,
    onCommitSelectionChange,
    tab
  ]);
  const worktreeCommands = useWorktreeCommands(
    target?.repositoryId,
    operations
  );
  const mutationHooks = useMemo(
    () => ({
      beforeMutation: details.invalidate,
      afterMutation: () => details.reload("changes")
    }),
    [details.invalidate, details.reload]
  );
  const mutations = useRepositoryMutations(
    target,
    mutationHooks
  );
  const [commitMessage, setCommitMessage] = useState("");
  const [pushAfterCommit, setPushAfterCommit] =
    useState(false);
  const [directoryOpening, setDirectoryOpening] =
    useState(false);
  const [directoryError, setDirectoryError] = useState<
    string | null
  >(null);
  const [copyFeedback, setCopyFeedback] = useState<{
    title: string;
    message: string;
    tone: "success" | "error";
  } | null>(null);
  const targetKey = target
    ? `${target.repositoryId}:${target.worktreeId}`
    : "";
  const handledCommandCompletion = useRef(
    commands.completionVersion
  );

  useEffect(() => {
    setCommitMessage("");
    setPushAfterCommit(false);
    mutations.clearFeedback();
    commands.clearFeedback();
    terminals.clearFeedback();
    setDirectoryError(null);
    setCopyFeedback(null);
    handledCommandCompletion.current =
      commands.completionVersion;
  }, [mutations.clearFeedback, targetKey]);

  const copyCommitId = useCallback(async (hash: string) => {
    try {
      await copyTextToClipboard(hash);
      setCopyFeedback({
        title: "Commit ID 已复制",
        message: hash,
        tone: "success"
      });
    } catch {
      setCopyFeedback({
        title: "Commit ID 复制失败",
        message: "当前环境未允许访问剪贴板，请手动复制。",
        tone: "error"
      });
    }
  }, []);

  useEffect(() => {
    if (!directoryError) {
      return;
    }

    const timeoutId = window.setTimeout(
      () => setDirectoryError(null),
      4_800
    );
    return () => window.clearTimeout(timeoutId);
  }, [directoryError]);

  const openDirectory = useCallback(
    async (
      directoryTarget: RepositoryTargetDto | undefined = target
    ) => {
      if (!directoryTarget) {
        return;
      }

      setDirectoryOpening(true);
      setDirectoryError(null);

      const openDirectoryCapability =
        window.gitnest?.system?.openDirectory;
      if (typeof openDirectoryCapability !== "function") {
        setDirectoryError(
          "当前应用未加载目录打开能力，请重启 GitNest 后重试。"
        );
        setDirectoryOpening(false);
        return;
      }

      try {
        const result = await openDirectoryCapability({
          target: directoryTarget
        });
        if (!result.ok) {
          setDirectoryError(
            formatDirectoryOpenError(result.error)
          );
        }
      } catch (reason) {
        setDirectoryError(
          formatDirectoryOpenFailure(reason)
        );
      } finally {
        setDirectoryOpening(false);
      }
    },
    [target]
  );

  useEffect(() => {
    if (
      handledCommandCompletion.current ===
      commands.completionVersion
    ) {
      return;
    }
    handledCommandCompletion.current =
      commands.completionVersion;
    details.invalidate();
    void details.reload(tab);
  }, [
    commands.completionVersion,
    details.invalidate,
    details.reload,
    tab
  ]);

  if (!workspace || !target) {
    return (
      <div className="page-scroll">
        <div className="empty-state">
          <span className="empty-state-icon">
            <Icon name="repository" size={20} />
          </span>
          <div>
            <strong>尚未选择仓库</strong>
            <p>请从左侧 Workspace 树选择一个精确工作目录。</p>
          </div>
        </div>
      </div>
    );
  }

  const resolved = resolveWorkspaceTarget(workspace, target);
  const repositoryName =
    resolved.worktree?.name ??
    resolved.repository?.name ??
    "未知仓库";
  const detailErrorBlocksCurrentTab =
    Boolean(details.error) &&
    ((tab === "changes" && !details.changes) ||
      (tab === "history" && !details.history) ||
      (tab === "branches" && !details.branches));

  return (
    <div
      className={`page-scroll repository-page repository-page-${tab}`}
    >
      {tab !== "changes" && tab !== "overview" && (
        <section className="page-heading repository-page-heading">
          <div>
            <span className="eyebrow">当前工作目录</span>
            <h1>{repositoryName}</h1>
            <p title={resolved.worktree?.path}>
              {resolved.worktree?.path ?? "工作目录不可用"}
            </p>
          </div>
          <div className="page-actions">
            <span
              className={`status-pill ${snapshotTone(snapshot)}`}
            >
              {snapshotStatus(snapshot)}
            </span>
            {(tab === "history" || tab === "branches") && (
              <button
                aria-busy={details.loading[tab]}
                className="button"
                onClick={() => void details.reload(tab)}
                type="button"
              >
                <Icon name="refresh" />
                重新读取
              </button>
            )}
          </div>
        </section>
      )}

      <ToastViewport>
        {details.error && !detailErrorBlocksCurrentTab && (
          <Toast
            closeLabel="关闭仓库数据提示"
            icon="warning"
            key="repository-details-error"
            message={details.error.message}
            onClose={details.clearError}
            title="仓库数据读取失败"
            tone="error"
          />
        )}
        {(mutations.error || mutations.notice) && (
          <Toast
            closeLabel="关闭写操作提示"
            icon={mutations.error ? "warning" : "check"}
            key="repository-mutation-feedback"
            message={
              mutations.error?.message ??
              mutations.notice ??
              ""
            }
            onClose={mutations.clearFeedback}
            title={
              mutations.error
                ? "仓库写操作未完成"
                : "仓库写操作完成"
            }
            tone={mutations.error ? "error" : "success"}
          />
        )}
        {(commands.error || commands.notice) && (
          <Toast
            closeLabel="关闭仓库命令提示"
            icon={commands.error ? "warning" : "check"}
            key="repository-command-feedback"
            message={
              commands.error?.message ??
              commands.notice ??
              ""
            }
            onClose={commands.clearFeedback}
            title={
              commands.error
                ? "仓库命令未完成"
                : "仓库命令已接受"
            }
            tone={commands.error ? "error" : "success"}
          />
        )}
        {(terminals.error || terminals.notice) && (
          <Toast
            closeLabel="关闭终端提示"
            icon={terminals.error ? "warning" : "terminal"}
            key="external-terminal-feedback"
            message={
              terminals.error?.message ??
              terminals.notice ??
              ""
            }
            onClose={terminals.clearFeedback}
            title={
              terminals.error
                ? "外部终端未打开"
                : "外部终端已打开"
            }
            tone={terminals.error ? "error" : "success"}
          />
        )}
        {(worktreeCommands.error ||
          worktreeCommands.notice) && (
          <Toast
            closeLabel="关闭 Worktree 操作提示"
            icon={
              worktreeCommands.error
                ? "warning"
                : "check"
            }
            key="worktree-command-feedback"
            message={
              worktreeCommands.error?.message ??
              worktreeCommands.notice ??
              ""
            }
            onClose={worktreeCommands.clearFeedback}
            title={
              worktreeCommands.error
                ? "Worktree 操作未完成"
                : "Worktree 操作状态"
            }
            tone={
              worktreeCommands.error
                ? "error"
                : "success"
            }
          />
        )}
        {directoryError && (
          <Toast
            closeLabel="关闭目录提示"
            icon="warning"
            key="directory-error"
            message={directoryError}
            onClose={() => setDirectoryError(null)}
            title="目录未打开"
            tone="error"
          />
        )}
        {copyFeedback && (
          <Toast
            closeLabel="关闭复制提示"
            icon={copyFeedback.tone === "error" ? "warning" : "check"}
            key="repository-copy-feedback"
            message={copyFeedback.message}
            onClose={() => setCopyFeedback(null)}
            title={copyFeedback.title}
            tone={copyFeedback.tone}
          />
        )}
      </ToastViewport>

      {tab === "overview" && (
        <RepositoryOverview
          controller={details}
          directoryOpening={directoryOpening}
          onCopyCommitId={copyCommitId}
          onOpenDirectory={openDirectory}
          onOpenTab={onOpenTab}
          repositoryName={repositoryName}
          repositoryPath={resolved.worktree?.path}
          snapshot={snapshot}
          worktreeCount={
            resolved.repository?.worktreeIds.length ?? 0
          }
        />
      )}
      {tab === "changes" && (
        <RepositoryChanges
          commands={commands}
          commitMessage={commitMessage}
          controller={details}
          externalApplications={externalApplications}
          mutations={mutations}
          onCommitMessageChange={setCommitMessage}
          onCommitted={() => {
            setCommitMessage("");
          }}
          onPushAfterCommitChange={setPushAfterCommit}
          pushAfterCommit={pushAfterCommit}
          target={target}
          workspaceId={workspace?.id}
        />
      )}
      {tab === "history" && (
        <RepositoryHistory
          branch={snapshot?.branch}
          controller={details}
          onCopyCommitId={copyCommitId}
        />
      )}
      {tab === "branches" && (
        <RepositoryBranches
          commands={commands}
          controller={details}
          snapshot={snapshot}
          target={target}
          worktreePath={resolved.worktree?.path}
        />
      )}
      {tab === "worktrees" && (
        <RepositoryWorktrees
          commands={worktreeCommands}
          directoryOpening={directoryOpening}
          onOpenDirectory={(worktreeId) =>
            void openDirectory({
              repositoryId: target.repositoryId,
              worktreeId
            })
          }
          repositoryId={target.repositoryId}
          snapshots={snapshots}
          worktreeId={target.worktreeId}
          workspace={workspace}
        />
      )}
      {worktreeCommands.preflight && (
        <WorktreeCommandDialog
          active={worktreeCommands.active}
          onCancel={worktreeCommands.dismissPreflight}
          onConfirm={() =>
            void worktreeCommands.confirm()
          }
          preflight={worktreeCommands.preflight}
          workspace={workspace}
        />
      )}
    </div>
  );
}

function RepositoryOverview({
  controller,
  directoryOpening,
  onCopyCommitId,
  onOpenDirectory,
  onOpenTab,
  repositoryName,
  repositoryPath,
  snapshot,
  worktreeCount
}: {
  controller: ReturnType<typeof useRepositoryDetails>;
  directoryOpening: boolean;
  onCopyCommitId(hash: string): Promise<void>;
  onOpenDirectory(): void;
  onOpenTab(tab: RepositoryTab): void;
  snapshot: RepositoryStatusSnapshotDto | undefined;
  worktreeCount: number;
  repositoryName: string;
  repositoryPath: string | undefined;
}) {
  const changes = getSnapshotChangeCount(snapshot);
  const commits =
    controller.history?.page.commits.slice(0, 3) ?? [];
  const latestCommit = commits[0];
  const historyLoading = controller.loading.history;
  const changeFoot =
    !snapshot
      ? "等待状态刷新"
      : changes > 0
        ? `${snapshot.untracked} 未跟踪 · ${snapshot.staged} 已暂存 · ${snapshot.unstaged} 未暂存${
            snapshot.conflicted
              ? ` · ${snapshot.conflicted} 冲突`
              : ""
          }`
        : "工作区干净";
  const branchFoot = snapshot
    ? snapshot.ahead
      ? `${snapshot.branch ?? "detached"} · 准备 Push`
      : `当前分支：${snapshot.branch ?? "detached"}`
    : "等待状态刷新";
  const upstreamFoot = snapshot
    ? snapshot.upstream
      ? `上游：${snapshot.upstream} · ${
          snapshot.behind ? "可执行快进更新" : "无需 Pull"
        }`
      : snapshot.behind
        ? "可执行快进更新 · 未配置上游"
        : "未配置上游"
    : "等待状态刷新";

  return (
    <>
      <section className="repository-hero">
        <span className="repository-hero-icon">
          <Icon name="repository" size={25} />
        </span>
        <div className="repository-hero-copy">
          <div className="repository-hero-title">
            {repositoryName}
          </div>
          <div
            className="repository-hero-path"
            title={repositoryPath}
          >
            {repositoryPath ?? "工作目录不可用"}
          </div>
          <div className="repository-hero-status">
            <span
              className={`status-pill ${snapshotTone(snapshot)}`}
            >
              {repositoryOverviewStatus(snapshot)}
            </span>
            <span className="status-pill neutral">
              <Icon name="branch" size={12} />
              {snapshot?.branch ?? "detached"}
            </span>
            {snapshot?.behind ? (
              <span className="status-pill blue">
                <Icon name="arrowDown" size={12} />
                本地引用显示落后 {snapshot.behind}
              </span>
            ) : null}
            <span className="status-pill neutral">
              Workspace
            </span>
          </div>
        </div>
        <div className="repository-hero-actions">
          <button
            aria-busy={directoryOpening}
            className="button repository-hero-action"
            disabled={!repositoryPath || directoryOpening}
            onClick={onOpenDirectory}
            type="button"
          >
            <Icon name="folder" />
            {directoryOpening ? "打开中…" : "打开目录"}
          </button>
          <button
            className="button primary repository-hero-action"
            onClick={() => onOpenTab("changes")}
            type="button"
          >
            <Icon name="fileCode" />
            {changes > 0 ? "查看变更" : "查看状态"}
          </button>
        </div>
      </section>

      <section className="metric-grid repository-metric-grid">
        <article className="metric-card tone-yellow">
          <div className="metric-label">
            <span>工作区变更</span>
            <span className="metric-icon">
              <Icon name="fileCode" />
            </span>
          </div>
          <strong className="metric-value">{changes}</strong>
          <span className="metric-foot">
            {changeFoot}
          </span>
        </article>
        <article className="metric-card tone-green">
          <div className="metric-label">
            <span>领先远程</span>
            <span className="metric-icon">
              <Icon name="arrowUp" />
            </span>
          </div>
          <strong className="metric-value">
            {snapshot?.ahead ?? 0}
          </strong>
          <span className="metric-foot">{branchFoot}</span>
        </article>
        <article className="metric-card tone-blue">
          <div className="metric-label">
            <span>落后远程</span>
            <span className="metric-icon">
              <Icon name="arrowDown" />
            </span>
          </div>
          <strong className="metric-value">
            {snapshot?.behind ?? 0}
          </strong>
          <span className="metric-foot">{upstreamFoot}</span>
        </article>
        <article className="metric-card tone-purple">
          <div className="metric-label">
            <span>Worktrees</span>
            <span className="metric-icon">
              <Icon name="worktree" />
            </span>
          </div>
          <strong className="metric-value">
            {worktreeCount}
          </strong>
          <span className="metric-foot">
            共享同一个 commonDir
          </span>
        </article>
      </section>

      <section className="dashboard-grid repository-dashboard">
        <article className="panel">
          <header className="panel-header">
            <div className="panel-title">
              <Icon name="history" />
              最近提交
            </div>
            <span className="panel-caption">
              {historyLoading && !latestCommit
                ? "读取中…"
                : commits.length
                  ? `快照采集 ${commits.length} 条`
                  : "暂无提交"}
            </span>
            <button
              className="panel-action"
              onClick={() => onOpenTab("history")}
              type="button"
            >
              打开历史视图
            </button>
          </header>
          {historyLoading && !latestCommit ? (
            <div
              className="repository-overview-loading"
              role="status"
            >
              <Icon name="refresh" size={18} />
              正在读取最近提交…
            </div>
          ) : latestCommit ? (
            <div className="repository-overview-commit-list">
              {commits.map((commit) => (
                <button
                  aria-current={
                    controller.selectedCommitHash ===
                    commit.hash
                      ? "true"
                      : undefined
                  }
                  className="repository-overview-commit-row"
                  key={commit.hash}
                  onClick={() => {
                    void controller.selectCommit(commit.hash);
                    onOpenTab("history");
                  }}
                  type="button"
                >
                  <span className="repository-overview-commit-graph">
                    <span className="repository-overview-commit-node" />
                  </span>
                  <span className="repository-overview-commit-message">
                    <strong>{commit.subject}</strong>
                    <span className="repository-overview-commit-refs">
                      {(commit.refs ?? []).length > 0
                        ? (commit.refs ?? []).map((ref) => (
                            <span
                              className={`repository-overview-ref-label${
                                ref.startsWith("origin")
                                  ? " remote"
                                  : ""
                              }`}
                              key={ref}
                            >
                              {ref}
                            </span>
                          ))
                        : (
                            <span className="repository-overview-ref-label">
                              {snapshot?.branch ?? "detached"}
                            </span>
                          )}
                    </span>
                  </span>
                  <time
                    className="repository-overview-commit-time"
                    dateTime={commit.authoredAt}
                  >
                    {formatCommitTimestamp(commit.authoredAt)}
                  </time>
                  <span className="repository-overview-commit-author">
                    {commit.authorName}
                  </span>
                  <code
                    className="repository-overview-commit-id"
                    aria-label={`复制 Commit ID ${commit.hash}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      void onCopyCommitId(commit.hash);
                    }}
                    onKeyDown={(event) => {
                      if (
                        event.key !== "Enter" &&
                        event.key !== " "
                      ) {
                        return;
                      }
                      event.preventDefault();
                      event.stopPropagation();
                      void onCopyCommitId(commit.hash);
                    }}
                    role="button"
                    tabIndex={0}
                    title={`Commit ID ${commit.hash}`}
                  >
                    {commit.shortHash}
                  </code>
                </button>
              ))}
            </div>
          ) : (
            <div className="repository-overview-loading">
              <Icon name="history" size={18} />
              暂无提交历史
            </div>
          )}
        </article>
      </section>
    </>
  );
}

function RepositoryChanges({
  commands,
  controller,
  mutations,
  externalApplications,
  commitMessage,
  pushAfterCommit,
  onCommitMessageChange,
  onPushAfterCommitChange,
  onCommitted,
  workspaceId,
  target
}: {
  commands: RepositoryCommandController;
  controller: ReturnType<typeof useRepositoryDetails>;
  mutations: ReturnType<typeof useRepositoryMutations>;
  externalApplications: ExternalApplicationController;
  commitMessage: string;
  pushAfterCommit: boolean;
  onCommitMessageChange(value: string): void;
  onPushAfterCommitChange(value: boolean): void;
  onCommitted(): void;
  workspaceId: string | undefined;
  target: RepositoryTargetDto;
}) {
  const changes = controller.changes?.snapshot.changes ?? [];
  const files = useMemo(
    () => buildDiffViewerFiles(changes),
    [changes]
  );
  const selectedFileKey = controller.selectedChange
    ? `${controller.selectedChange.mode}\u0001${controller.selectedChange.path}`
    : undefined;
  const selectedFile =
    files.find((file) => file.key === selectedFileKey) ??
    files[0];
  const selected = selectedFile?.change;
  const diff = controller.diff?.diff;
  const selectedDiff =
    selectedFile &&
    controller.selectedChange?.path === selectedFile.path &&
    controller.selectedChange.mode === selectedFile.mode
      ? diff
      : undefined;
  const workspaceFiles = useMemo(
    () =>
      files.map((file) =>
        selectedDiff &&
        file.path === selectedDiff.path &&
        file.mode === selectedDiff.mode
          ? {
              ...file,
              additions: selectedDiff.additions,
              deletions: selectedDiff.deletions
            }
          : file
      ),
    [
      files,
      selectedDiff?.additions,
      selectedDiff?.deletions,
      selectedDiff?.mode,
      selectedDiff?.path
    ]
  );
  const [diffViewerOpening, setDiffViewerOpening] =
    useState(false);
  const [diffViewerError, setDiffViewerError] = useState<
    string | null
  >(null);
  const [changeFileContextMenu, setChangeFileContextMenu] =
    useState<ChangeFileContextMenuState | null>(null);
  const [changeFileOpenInMenuOpen, setChangeFileOpenInMenuOpen] =
    useState(false);
  const changeFileContextMenuRef = useRef<HTMLDivElement>(null);
  const changeFileOpenInMenuRef =
    useRef<HTMLDivElement>(null);
  const changeFileOpenInCloseTimerRef =
    useRef<number | null>(null);
  const [
    treeDirectoriesCollapsedPreference,
    setTreeDirectoriesCollapsedPreference
  ] = useState(() =>
    readTreeDirectoriesCollapsedPreference(
      getRendererPreferenceStorage(),
      workspaceId
    )
  );
  const treeScopeKey = controller.changes
    ? `${workspaceId ?? ""}\u0001${controller.changes.target.repositoryId}:${controller.changes.target.worktreeId}`
    : "";

  const openSelectedDiffViewer = async () => {
    if (!selectedDiff || diffViewerOpening) {
      return;
    }

    setDiffViewerOpening(true);
    setDiffViewerError(null);
    try {
      await window.gitnest.window.openDiffViewer({
        target,
        path: selectedDiff.path,
        mode: selectedDiff.mode
      });
    } catch (reason) {
      setDiffViewerError(
        reason instanceof Error
          ? reason.message
          : "独立 Diff 窗口未能打开。"
      );
    } finally {
      setDiffViewerOpening(false);
    }
  };

  const openChangeFileContextMenu = (
    event: MouseEvent<HTMLDivElement>,
    file: DiffViewerFile
  ) => {
    event.preventDefault();
    event.stopPropagation();

    const viewportPadding = 8;
    const menuWidth = 222;
    const menuHeight = 52;
    const maxX = Math.max(
      viewportPadding,
      window.innerWidth - menuWidth - viewportPadding
    );
    const maxY = Math.max(
      viewportPadding,
      window.innerHeight - menuHeight - viewportPadding
    );

    setChangeFileOpenInMenuOpen(false);
    setChangeFileContextMenu({
      path: file.path,
      x: Math.max(
        viewportPadding,
        Math.min(event.clientX, maxX)
      ),
      y: Math.max(
        viewportPadding,
        Math.min(event.clientY, maxY)
      )
    });
    void controller.selectChange(file.change, file.mode);
  };

  const openChangeFileOpenInMenu = () => {
    if (changeFileOpenInCloseTimerRef.current !== null) {
      window.clearTimeout(
        changeFileOpenInCloseTimerRef.current
      );
      changeFileOpenInCloseTimerRef.current = null;
    }
    setChangeFileOpenInMenuOpen(true);
  };

  const scheduleChangeFileOpenInMenuClose = () => {
    if (changeFileOpenInCloseTimerRef.current !== null) {
      window.clearTimeout(
        changeFileOpenInCloseTimerRef.current
      );
    }
    changeFileOpenInCloseTimerRef.current = window.setTimeout(
      () => {
        changeFileOpenInCloseTimerRef.current = null;
        setChangeFileOpenInMenuOpen(false);
      },
      120
    );
  };

  useEffect(() => {
    setChangeFileContextMenu(null);
    setChangeFileOpenInMenuOpen(false);
  }, [treeScopeKey]);

  useEffect(
    () => () => {
      if (changeFileOpenInCloseTimerRef.current !== null) {
        window.clearTimeout(
          changeFileOpenInCloseTimerRef.current
        );
      }
    },
    []
  );

  useEffect(() => {
    setTreeDirectoriesCollapsedPreference(
      readTreeDirectoriesCollapsedPreference(
        getRendererPreferenceStorage(),
        workspaceId
      )
    );
  }, [workspaceId]);

  useEffect(() => {
    if (!changeFileContextMenu) {
      return;
    }

    const closeFromOutside = (
      event: globalThis.PointerEvent
    ) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (changeFileContextMenuRef.current?.contains(target) ||
          changeFileOpenInMenuRef.current?.contains(target))
      ) {
        return;
      }
      setChangeFileContextMenu(null);
      setChangeFileOpenInMenuOpen(false);
    };
    const closeFromKeyboard = (
      event: globalThis.KeyboardEvent
    ) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setChangeFileContextMenu(null);
        setChangeFileOpenInMenuOpen(false);
      }
    };
    const closeFromViewport = () => {
      setChangeFileContextMenu(null);
      setChangeFileOpenInMenuOpen(false);
    };
    const focusFrame = window.requestAnimationFrame(() => {
      changeFileContextMenuRef.current
        ?.querySelector<HTMLButtonElement>("[role='menuitem']")
        ?.focus();
    });

    document.addEventListener(
      "pointerdown",
      closeFromOutside
    );
    document.addEventListener(
      "keydown",
      closeFromKeyboard
    );
    document.addEventListener(
      "scroll",
      closeFromViewport,
      true
    );
    window.addEventListener("blur", closeFromViewport);
    window.addEventListener("resize", closeFromViewport);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener(
        "pointerdown",
        closeFromOutside
      );
      document.removeEventListener(
        "keydown",
        closeFromKeyboard
      );
      document.removeEventListener(
        "scroll",
        closeFromViewport,
        true
      );
      window.removeEventListener("blur", closeFromViewport);
      window.removeEventListener(
        "resize",
        closeFromViewport
      );
    };
  }, [changeFileContextMenu]);

  if (controller.loading.changes && !controller.changes) {
    return <RepositoryLoading label="正在读取工作区变更…" />;
  }

  if (!controller.changes && controller.error) {
    return (
      <RepositoryReadFailure label="工作区变更暂时不可用" />
    );
  }

  if (changes.length === 0) {
    return (
      <div className="empty-state repository-empty-state">
        <span className="empty-state-icon">
          <Icon name="check" size={20} />
        </span>
        <div>
          <strong>工作区干净</strong>
          <p>没有 staged、unstaged、untracked 或冲突文件。</p>
        </div>
      </div>
    );
  }

  const diffPanelState: DiffPanelState | undefined =
    controller.loading.diff && !selectedDiff
      ? {
          busy: true,
          icon: "refresh",
          message: "正在生成所选文件的文本差异。",
          title: "读取 Diff…"
        }
      : controller.diffNotice === "change-removed"
        ? {
            icon: "eye",
            message: "该变更在重新读取仓库状态后已不存在。",
            title: "状态已更新"
          }
        : selectedDiff?.mode === "unstaged" &&
            selectedDiff.content.length === 0
          ? {
              icon: "fileCode",
              message: controller.loading.changes
                ? "正在重新读取仓库状态…"
                : "状态已重新读取；该文件可能只存在行尾或索引元数据变化。",
              title: "没有文本内容差异"
            }
          : !selectedDiff
            ? {
                icon: "eye",
                message:
                  "当前仅显示 Git 状态；文件内容按需读取，并受输出大小上限保护。",
                title: "只展示 Git 状态"
              }
            : undefined;

  return (
    <div className="changes-page">
      <DiffWorkspace
        className="changes-layout"
        canStageFile={(file) => canStageChange(file.change)}
        canUnstageFile={(file) =>
          canUnstageChange(file.change)
        }
        changesLoading={controller.loading.changes}
        commit={{
          busy: mutations.active !== null || commands.busy,
          conflicted:
            controller.changes?.snapshot.conflicted ?? 0,
          message: commitMessage,
          push: pushAfterCommit,
          staged: controller.changes?.snapshot.staged ?? 0,
          submitting:
            mutations.active === "commit" ||
            (pushAfterCommit && commands.active === "push"),
          onMessageChange: onCommitMessageChange,
          onPushChange: onPushAfterCommitChange,
          onSubmit: async (message, push) => {
            const { subject, body } =
              parseCommitMessage(message);
            const committed = await mutations.createCommit(
              subject,
              body
            );
            if (committed) {
              onCommitted();
              if (push) {
                await commands.request({
                  type: "push",
                  targets: [target]
                });
              }
            }
          }
        }}
        configuration={repositoryDiffWorkspaceConfiguration}
        files={workspaceFiles}
        mutationBusy={mutations.active !== null}
        onFileContextMenu={openChangeFileContextMenu}
        onSelectedFileChange={(file) =>
          void controller.selectChange(file.change, file.mode)
        }
        onStageFile={(file) =>
          mutations.stageChange(file.change)
        }
        onUnstageFile={(file) =>
          mutations.unstageChange(file.change)
        }
        openStandalone={{
          busy: diffViewerOpening,
          disabled: !selectedDiff,
          title:
            diffViewerError ??
            "在独立窗口中打开完整 Diff 查看器",
          onOpen: openSelectedDiffViewer
        }}
        panelProps={{
          additions: selectedDiff?.additions,
          binary: selectedDiff?.binary,
          className: "repository-diff-panel",
          content: selectedDiff?.content,
          deletions: selectedDiff?.deletions,
          emptyPathLabel: "选择一个文件",
          emptyStatsLabel: "按需读取文本 Diff",
          maxLines: 4_000,
          state: diffPanelState,
          statsAvailable: Boolean(selectedDiff),
          truncated: selectedDiff?.truncated
        }}
        selectedFileKey={selectedFileKey}
        treePreference={{
          initiallyCollapsed:
            treeDirectoriesCollapsedPreference,
          scopeKey: treeScopeKey,
          onCollapsedPreferenceChange: (collapsed) => {
            setTreeDirectoriesCollapsedPreference(collapsed);
            writeTreeDirectoriesCollapsedPreference(
              getRendererPreferenceStorage(),
              workspaceId,
              collapsed
            );
          }
        }}
      />
      {changeFileContextMenu && (
        <LayerPortal>
          <Menu
            aria-label={`${changeFileContextMenu.path} 文件操作`}
            className="workspace-context-menu change-file-context-menu"
            ref={changeFileContextMenuRef}
            style={{
              left: changeFileContextMenu.x,
              top: changeFileContextMenu.y
            }}
          >
            <div
              className="workspace-context-open-in"
              onBlurCapture={scheduleChangeFileOpenInMenuClose}
              onFocusCapture={openChangeFileOpenInMenu}
              onPointerEnter={openChangeFileOpenInMenu}
              onPointerLeave={scheduleChangeFileOpenInMenuClose}
            >
              <MenuItem
                aria-expanded={changeFileOpenInMenuOpen}
                aria-haspopup="menu"
                className="workspace-context-open-in-trigger"
                leading={<Icon name="external" size={14} />}
                onClick={() =>
                  setChangeFileOpenInMenuOpen((open) => !open)
                }
                title="选择用于打开此文件的应用"
                trailing={<Icon name="collapse" size={14} />}
              >
                打开方式
              </MenuItem>
              {changeFileOpenInMenuOpen && (
                <MenuPopover
                  align="start"
                  anchor={changeFileContextMenuRef.current}
                  aria-label="选择用于打开此文件的应用"
                  className="workspace-context-open-in-submenu"
                  onBlurCapture={
                    scheduleChangeFileOpenInMenuClose
                  }
                  onFocusCapture={openChangeFileOpenInMenu}
                  onPointerEnter={openChangeFileOpenInMenu}
                  onPointerLeave={
                    scheduleChangeFileOpenInMenuClose
                  }
                  ref={changeFileOpenInMenuRef}
                  side="right"
                >
                  <MenuHeading>Open in</MenuHeading>
                  {externalApplications.profiles.length > 0 ? (
                    externalApplications.profiles.map((profile) => (
                      <MenuItem
                        disabled={
                          externalApplications.active !== null
                        }
                        key={profile.kind}
                        leading={
                          <ApplicationIcon profile={profile} />
                        }
                        onClick={() => {
                          const path =
                            changeFileContextMenu.path;
                          setChangeFileOpenInMenuOpen(false);
                          setChangeFileContextMenu(null);
                          void externalApplications.openFile(
                            profile.kind,
                            path
                          );
                        }}
                      >
                        {profile.label}
                      </MenuItem>
                    ))
                  ) : (
                    <span className="workspace-context-open-in-empty">
                      {externalApplications.loading
                        ? "正在检测可用应用…"
                        : "未检测到可用应用"}
                    </span>
                  )}
                </MenuPopover>
              )}
            </div>
          </Menu>
        </LayerPortal>
      )}
    </div>
  );
}

function RepositoryHistory({
  branch,
  controller,
  onCopyCommitId
}: {
  branch: string | undefined;
  controller: ReturnType<typeof useRepositoryDetails>;
  onCopyCommitId(hash: string): Promise<void>;
}) {
  const commits = controller.history?.page.commits ?? [];
  const selected = controller.commit?.commit;
  const showCommitDetail = Boolean(
    controller.historyDetailOpen &&
      (controller.selectedCommitHash ||
        selected ||
        controller.loading.commit)
  );
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const normalizedFilter = filterQuery.trim().toLocaleLowerCase();
  const visibleCommits = normalizedFilter
    ? commits.filter((item) =>
        [
          item.subject,
          item.authorName,
          item.shortHash,
          item.hash,
          item.authoredAt,
          ...(item.refs ?? [])
        ].some((value) =>
          value.toLocaleLowerCase().includes(normalizedFilter)
        )
      )
    : commits;

  if (controller.loading.history && commits.length === 0) {
    return <RepositoryLoading label="正在读取提交历史…" />;
  }

  if (!controller.history && controller.error) {
    return <RepositoryReadFailure label="提交历史暂时不可用" />;
  }

  if (commits.length === 0) {
    return (
      <div className="empty-state repository-empty-state">
        <span className="empty-state-icon">
          <Icon name="activity" size={20} />
        </span>
        <div>
          <strong>暂无提交历史</strong>
          <p>空仓库在首次提交后会显示历史。</p>
        </div>
      </div>
    );
  }

  return (
    <section
      className={`history-layout${
        showCommitDetail ? " has-detail" : ""
      }`}
    >
      <div className="history-list">
        <header className="panel-header">
          <div className="panel-title">
            <Icon name="history" />
            提交历史
          </div>
          <span className="panel-caption">
            只读快照 · 最近 {commits.length} 条 HEAD 提交
          </span>
          {filterOpen && (
            <input
              aria-label="筛选提交历史"
              autoFocus
              className="history-filter-input"
              onKeyDown={(event) => {
                if (event.key !== "Escape") {
                  return;
                }
                event.preventDefault();
                setFilterOpen(false);
                setFilterQuery("");
              }}
              onChange={(event) =>
                setFilterQuery(event.target.value)
              }
              placeholder="筛选提交、作者或 Hash"
              value={filterQuery}
            />
          )}
          <button
            aria-expanded={filterOpen}
            className="button small panel-header-action"
            onClick={() => setFilterOpen((open) => !open)}
            type="button"
          >
            <Icon name="filter" size={13} />
            筛选
          </button>
        </header>
        <div className="commit-list">
          {visibleCommits.map((item, index) => (
            <div
              aria-current={
                controller.historyDetailOpen &&
                item.hash === controller.selectedCommitHash
                  ? "true"
                  : undefined
              }
              className={`commit-row${
                controller.historyDetailOpen &&
                item.hash === controller.selectedCommitHash
                  ? " selected"
                  : ""
              }`}
              key={item.hash}
              onClick={() =>
                void controller.selectCommit(item.hash)
              }
              onKeyDown={(event) => {
                if (
                  event.key !== "Enter" &&
                  event.key !== " "
                ) {
                  return;
                }
                event.preventDefault();
                void controller.selectCommit(item.hash);
              }}
              role="button"
              tabIndex={0}
            >
              <span
                className={`commit-graph ${
                  index === 2 ? "branch " : ""
                }lane-${index % 3}`}
              >
                <span className="commit-node" />
              </span>
              <span className="commit-message">
                <strong className="commit-subject">
                  {item.subject}
                </strong>
                <span className="commit-meta">
                  {(item.refs ?? []).length > 0
                    ? (item.refs ?? []).map((ref) => (
                        <span
                          className={`ref-label${
                            ref.startsWith("origin")
                              ? " remote"
                              : ""
                          }`}
                          key={ref}
                        >
                          {ref}
                        </span>
                      ))
                    : (
                        <span className="ref-label">
                          {branch ?? "detached"}
                        </span>
                      )}
                </span>
              </span>
              <time
                className="commit-time"
                dateTime={item.authoredAt}
              >
                {formatCommitTimestamp(item.authoredAt)}
              </time>
              <span className="commit-author">
                {item.authorName}
              </span>
                <code
                  className="commit-id"
                  aria-label={`复制 Commit ID ${item.hash}`}
                onClick={(event) => {
                  event.stopPropagation();
                  void onCopyCommitId(item.hash);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") {
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                  void onCopyCommitId(item.hash);
                }}
                role="button"
                tabIndex={0}
                title={`点击复制 Commit ID ${item.hash}`}
              >
                {item.shortHash}
              </code>
            </div>
          ))}
          {visibleCommits.length === 0 && (
            <div className="history-filter-empty">
              <Icon name="search" size={18} />
              <strong>没有匹配的提交</strong>
              <span>可修改筛选关键词后重试。</span>
            </div>
          )}
          {controller.history?.page.nextOffset !== undefined && (
            <button
              aria-busy={controller.loading.history}
              className="load-more-button"
              disabled={controller.loading.history}
              onClick={() => void controller.loadMoreHistory()}
              type="button"
            >
              {controller.loading.history
                ? "加载中…"
                : "加载更多"}
            </button>
          )}
        </div>
      </div>

      {showCommitDetail && (
        <article
          aria-labelledby="historyCommitDetailTitle"
          className="commit-detail history-commit-detail panel"
        >
          <header className="panel-header">
            <div
              className="panel-title"
              id="historyCommitDetailTitle"
            >
              <Icon name="commit" />
              提交详情
            </div>
          </header>
          {controller.loading.commit ? (
            <RepositoryLoading label="正在读取提交详情…" compact />
          ) : selected ? (
            <div className="commit-detail-body">
              <h2>{selected.subject}</h2>
              <div className="commit-detail-meta">
                <span>{selected.authorName}</span>
                <code>{selected.hash}</code>
                <span>
                  {formatCommitTimestamp(selected.authoredAt)}
                </span>
              </div>
              {selected.refs.length > 0 && (
                <div className="commit-refs">
                  {selected.refs.map((ref) => (
                    <span key={ref}>{ref}</span>
                  ))}
                </div>
              )}
              <p className="selected-commit-body">
                {selected.body}
              </p>
            </div>
          ) : (
            <div className="diff-empty">
              <Icon name="activity" size={20} />
              <strong>选择提交查看详情</strong>
            </div>
          )}
        </article>
      )}
    </section>
  );
}

function RepositoryBranches({
  controller,
  commands,
  snapshot,
  target,
  worktreePath
}: {
  controller: ReturnType<typeof useRepositoryDetails>;
  commands: RepositoryCommandController;
  snapshot: RepositoryStatusSnapshotDto | undefined;
  target: RepositoryTargetDto;
  worktreePath: string | undefined;
}) {
  const branches = controller.branches?.branches ?? [];
  const [createFormOpen, setCreateFormOpen] = useState(false);
  const [newBranch, setNewBranch] = useState("");
  const [renamingBranch, setRenamingBranch] =
    useState<string | null>(null);
  const [renamedBranch, setRenamedBranch] = useState("");
  const [branchMenu, setBranchMenu] =
    useState<BranchMenuState | null>(null);
  const branchMenuRef = useRef<HTMLDivElement>(null);
  const localCount = branches.filter(
    (branch) => !branch.remote
  ).length;

  useEffect(() => {
    if (!branchMenu) {
      return;
    }

    const close = () => setBranchMenu(null);
    const handlePointerDown = (event: PointerEvent) => {
      const eventTarget = event.target;
      if (
        eventTarget instanceof Element &&
        eventTarget.closest("[data-branch-menu-trigger]")
      ) {
        return;
      }
      if (
        eventTarget instanceof Node &&
        branchMenuRef.current?.contains(eventTarget)
      ) {
        return;
      }
      close();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    const focusFrame = window.requestAnimationFrame(() => {
      branchMenuRef.current
        ?.querySelector<HTMLButtonElement>('[role="menuitem"]')
        ?.focus({ preventScroll: true });
    });

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener(
        "pointerdown",
        handlePointerDown
      );
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [branchMenu]);

  const createBranch = (event: FormEvent) => {
    event.preventDefault();
    const branch = newBranch.trim();
    if (!branch || commands.busy) {
      return;
    }
    void commands
      .request({
        type: "create-branch",
        target,
        branch
      })
      .then((accepted) => {
        if (accepted) {
          setNewBranch("");
          setCreateFormOpen(false);
        }
      });
  };

  const renameBranch = (
    event: FormEvent,
    branch: string
  ) => {
    event.preventDefault();
    const newName = renamedBranch.trim();
    if (
      !newName ||
      newName === branch ||
      commands.busy
    ) {
      return;
    }
    void commands
      .request({
        type: "rename-branch",
        target,
        branch,
        newName
      })
      .then((accepted) => {
        if (accepted) {
          setRenamingBranch(null);
          setRenamedBranch("");
        }
      });
  };

  if (controller.loading.branches && branches.length === 0) {
    return <RepositoryLoading label="正在读取分支…" />;
  }

  if (!controller.branches && controller.error) {
    return <RepositoryReadFailure label="分支列表暂时不可用" />;
  }

  const branchMenuBranch = branchMenu
    ? branches.find(
        (branch) =>
          !branch.remote &&
          branch.name === branchMenu.branchName
      )
    : undefined;
  const branchMenuOccupiedElsewhere = branchMenuBranch
    ? branchOccupiedElsewhere(
        branchMenuBranch.worktreePath,
        worktreePath
      )
    : false;

  return (
    <div className="repository-branches-page">
      <header className="panel-header sticky-panel-header">
        <div className="panel-title">
          <Icon name="branch" />
          分支管理
        </div>
        <span className="panel-caption">
          快照采集当前本地分支 {localCount} 条
        </span>
        <button
          aria-controls="new-branch-form"
          aria-expanded={createFormOpen}
          className="button branch-header-action"
          onClick={() => setCreateFormOpen((open) => !open)}
          type="button"
        >
          <Icon
            name={createFormOpen ? "close" : "plus"}
            size={13}
          />
          {createFormOpen ? "收起" : "新建分支"}
        </button>
      </header>
      {createFormOpen && (
        <div className="branch-management-toolbar">
          <form id="new-branch-form" onSubmit={createBranch}>
            <label htmlFor="new-branch-name">
              从当前 HEAD 创建分支
            </label>
            <div>
              <input
                id="new-branch-name"
                maxLength={255}
                onChange={(event) =>
                  setNewBranch(event.target.value)
                }
                placeholder="例如 feature/safe-sync"
                spellCheck={false}
                value={newBranch}
              />
              <button
                aria-busy={commands.active === "create-branch"}
                className="button primary"
                disabled={
                  commands.busy || !newBranch.trim()
                }
                type="submit"
              >
                <Icon
                  name={
                    commands.active === "create-branch"
                      ? "refresh"
                      : "plus"
                  }
                />
                {commands.active === "create-branch"
                  ? "预检中…"
                  : "创建"}
              </button>
            </div>
          </form>
          <p>
            分支写操作都会先展示目标、路径与引用影响；GitNest
            不会自动 Stash。
          </p>
        </div>
      )}
      <div className="branches-table" role="table">
        <div className="branches-row branches-head" role="row">
          <span role="columnheader">分支</span>
          <span role="columnheader">类型</span>
          <span role="columnheader">上游</span>
          <span role="columnheader">同步</span>
          <span role="columnheader">更新</span>
          <span role="columnheader">
            <span className="visually-hidden">操作</span>
          </span>
        </div>
        {branches.map((branch) => {
          const occupiedElsewhere =
            branchOccupiedElsewhere(
              branch.worktreePath,
              worktreePath
            );
          const editing =
            renamingBranch === branch.name &&
            !branch.remote;

          return (
            <div
              className={`branches-row${
                branch.current ? " current" : ""
              }`}
              key={branch.fullName}
              role="row"
              >
              <span className="branch-name-column" role="cell">
                <span
                  className={`branch-name-cell${
                    branch.current ? " current" : ""
                  }`}
                >
                  {branch.current ? (
                    <span
                      aria-hidden="true"
                      className="branch-current-dot"
                    />
                  ) : (
                    <Icon name="branch" size={14} />
                  )}
                  <span title={branch.name}>{branch.name}</span>
                </span>
              </span>
              <span role="cell">
                <span
                  className={`status-pill ${
                    branch.remote ? "blue" : "neutral"
                  }`}
                >
                  {branch.remote ? "远程" : "本地"}
                </span>
              </span>
              <span
                role="cell"
                title={branch.upstream ?? undefined}
              >
                {branch.upstream ?? "—"}
              </span>
              <span
                className="branch-sync"
                role="cell"
                title={
                  branch.current && snapshot?.upstream
                    ? `领先 ${snapshot.ahead}，落后 ${snapshot.behind}`
                    : undefined
                }
              >
                {branchSyncLabel(branch.current, snapshot)}
              </span>
              <span
                className="branch-updated"
                role="cell"
                title={branch.updatedAt}
              >
                {formatBranchUpdatedAt(branch.updatedAt)}
              </span>
              <span className="branch-row-actions" role="cell">
                {branch.remote ? (
                  "—"
                ) : editing ? (
                  <form
                    className="branch-rename-form"
                    onSubmit={(event) =>
                      renameBranch(event, branch.name)
                    }
                  >
                    <input
                      aria-label={`重命名 ${branch.name}`}
                      autoFocus
                      maxLength={255}
                      onChange={(event) =>
                        setRenamedBranch(event.target.value)
                      }
                      spellCheck={false}
                      value={renamedBranch}
                    />
                    <button
                      className="mini-action"
                      disabled={
                        commands.busy ||
                        !renamedBranch.trim() ||
                        renamedBranch.trim() === branch.name
                      }
                      type="submit"
                    >
                      保存
                    </button>
                    <button
                      className="mini-action"
                      disabled={commands.busy}
                      onClick={() => {
                        setRenamingBranch(null);
                        setRenamedBranch("");
                      }}
                      type="button"
                    >
                      取消
                    </button>
                    </form>
                  ) : (
                    <button
                      aria-expanded={
                        branchMenu?.branchName === branch.name
                      }
                      aria-haspopup="menu"
                      aria-label={`打开 ${branch.name} 操作`}
                      className="icon-button branch-row-menu-trigger"
                      data-branch-menu-trigger
                      onClick={(event) => {
                        if (
                          branchMenu?.branchName === branch.name
                        ) {
                          setBranchMenu(null);
                          return;
                        }
                        setBranchMenu({
                          anchor: event.currentTarget,
                          branchName: branch.name,
                        });
                      }}
                      title="分支操作"
                      type="button"
                    >
                      <Icon name="more" size={14} />
                    </button>
                  )}
              </span>
            </div>
          );
        })}
        {branches.length === 0 && (
          <div className="branches-empty" role="row">
            <Icon name="branch" size={18} />
            <strong>暂无分支</strong>
            <span>空仓库在首次提交后会显示本地分支。</span>
          </div>
        )}
      </div>
      {branchMenu && branchMenuBranch && (
        <MenuPopover
          align="end"
          anchor={branchMenu.anchor}
          aria-label={`${branchMenuBranch.name} 分支操作`}
          className="branch-row-floating-menu"
          ref={branchMenuRef}
          side="bottom"
        >
            <MenuItem
              disabled={
                commands.busy ||
                branchMenuBranch.current ||
                branchMenuOccupiedElsewhere
              }
              leading={<Icon name="branch" size={14} />}
              onClick={() => {
                setBranchMenu(null);
                void commands.request({
                  type: "switch-branch",
                  target,
                  branch: branchMenuBranch.name
                });
              }}
              title={
                branchMenuOccupiedElsewhere
                  ? "该分支已被其他 Worktree 检出"
                  : branchMenuBranch.current
                    ? "当前分支"
                    : "切换前执行脏状态与 Worktree 占用预检"
              }
            >
              切换
            </MenuItem>
            <MenuItem
              disabled={
                commands.busy || branchMenuOccupiedElsewhere
              }
              leading={<Icon name="settings" size={14} />}
              onClick={() => {
                setBranchMenu(null);
                setRenamingBranch(branchMenuBranch.name);
                setRenamedBranch(branchMenuBranch.name);
              }}
              title={
                branchMenuOccupiedElsewhere
                  ? "该分支已被其他 Worktree 检出"
                  : "重命名本地分支"
              }
            >
              重命名
            </MenuItem>
            <MenuItem
              disabled={
                commands.busy ||
                branchMenuBranch.current ||
                branchMenuOccupiedElsewhere
              }
              leading={<Icon name="warning" size={14} />}
              onClick={() => {
                setBranchMenu(null);
                void commands.request({
                  type: "delete-branch",
                  target,
                  branch: branchMenuBranch.name
                });
              }}
              title={
                branchMenuBranch.current
                  ? "不能删除当前分支"
                  : branchMenuOccupiedElsewhere
                    ? "该分支已被其他 Worktree 检出"
                    : "仅允许删除已合并的本地分支"
              }
              tone="danger"
            >
              删除
            </MenuItem>
        </MenuPopover>
      )}
    </div>
  );
}

function branchSyncLabel(
  current: boolean,
  snapshot: RepositoryStatusSnapshotDto | undefined
): string {
  if (!current || !snapshot?.upstream) {
    return "—";
  }

  const parts = [
    snapshot.ahead > 0 ? `↑ ${snapshot.ahead}` : "",
    snapshot.behind > 0 ? `↓ ${snapshot.behind}` : ""
  ].filter(Boolean);

  return parts.join(" ") || "已同步";
}

function formatBranchUpdatedAt(value: string | undefined): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function branchOccupiedElsewhere(
  branchWorktreePath: string | undefined,
  currentWorktreePath: string | undefined
): boolean {
  if (!branchWorktreePath) {
    return false;
  }
  if (!currentWorktreePath) {
    return true;
  }
  return normalizeWorktreePath(branchWorktreePath) !==
    normalizeWorktreePath(currentWorktreePath);
}

function normalizeWorktreePath(path: string): string {
  return path
    .replace(/\//g, "\\")
    .replace(/\\+$/, "")
    .toLocaleLowerCase("en-US");
}

function RepositoryLoading({
  label,
  compact = false
}: {
  label: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`repository-loading${
        compact ? " compact" : ""
      }`}
      role="status"
    >
      <span className="empty-state-icon spinning">
        <Icon name="refresh" size={18} />
      </span>
      <span>{label}</span>
    </div>
  );
}

function RepositoryReadFailure({
  label
}: {
  label: string;
}) {
  return (
    <div className="empty-state repository-empty-state">
      <span className="empty-state-icon warning-icon">
        <Icon name="warning" size={20} />
      </span>
      <div>
        <strong>{label}</strong>
        <p>已保留其他成功读取的数据，可使用“重新读取”重试。</p>
      </div>
    </div>
  );
}

function workspaceChangeSummary(
  snapshot: RepositoryStatusSnapshotDto | undefined
): string {
  if (snapshot?.conflicted) {
    return `${snapshot.conflicted} 个冲突`;
  }

  const parts = [
    snapshot?.staged ? `${snapshot.staged} staged` : "",
    snapshot?.unstaged ? `${snapshot.unstaged} unstaged` : "",
    snapshot?.untracked ? `${snapshot.untracked} untracked` : ""
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" · ") : "无文件级变更";
}

function repositoryOverviewStatus(
  snapshot: RepositoryStatusSnapshotDto | undefined
): string {
  if (!snapshot) {
    return "等待状态";
  }
  if (snapshot.error) {
    return "读取失败";
  }
  if (snapshot.refreshPending) {
    return "刷新中";
  }
  if (snapshot.conflicted) {
    return `${snapshot.conflicted} 个冲突需要解决`;
  }
  const changes = getSnapshotChangeCount(snapshot);
  return changes > 0
    ? `${changes} 项未提交变更`
    : "工作区干净";
}

function snapshotTone(
  snapshot: RepositoryStatusSnapshotDto | undefined
): "neutral" | "blue" | "green" | "yellow" | "red" {
  if (snapshot?.error) {
    return "red";
  }
  if (snapshot?.conflicted) {
    return "red";
  }
  if (!snapshot || snapshot.stale || snapshot.refreshPending) {
    return "blue";
  }
  if (getSnapshotChangeCount(snapshot) > 0) {
    return "yellow";
  }
  return "green";
}

function snapshotStatus(
  snapshot: RepositoryStatusSnapshotDto | undefined
): string {
  if (!snapshot) {
    return "等待状态";
  }
  if (snapshot.refreshPending) {
    return "刷新中";
  }
  if (snapshot.error) {
    return "读取失败";
  }
  if (snapshot.stale) {
    return "缓存状态";
  }
  const changes = getSnapshotChangeCount(snapshot);
  return changes > 0 ? `${changes} 项变更` : "工作区干净";
}

function formatDirectoryOpenError(
  error: GitReadErrorDto
): string {
  if (error.code === "DIRECTORY_UNAVAILABLE") {
    return "当前工作目录不可用，可能已被移动、删除或无访问权限。";
  }

  if (error.code === "INVALID_REQUEST") {
    return "当前仓库目录信息无效，请重新选择仓库后重试。";
  }

  return "无法打开当前工作目录，请检查目录是否存在且有访问权限。";
}

function formatDirectoryOpenFailure(reason: unknown): string {
  const message =
    reason instanceof Error ? reason.message : "";

  if (
    /openDirectory is not a function|no handler registered/i.test(
      message
    )
  ) {
    return "当前应用未加载目录打开能力，请重启 GitNest 后重试。";
  }

  if (/permission|access denied/i.test(message)) {
    return "当前工作目录无访问权限，请检查目录权限后重试。";
  }

  if (/not exist|cannot find|path not found/i.test(message)) {
    return "当前工作目录不存在，可能已被移动或删除。";
  }

  return "无法打开当前工作目录，请检查目录是否存在且有访问权限。";
}
