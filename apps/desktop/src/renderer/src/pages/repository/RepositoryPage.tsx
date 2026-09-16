import { Button } from "../../shared/ui/Button";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent
} from "react";

import type {
  BranchDto,
  CommitHistoryComparisonSideDto,
  GitReadErrorDto,
  RepositoryCommitDto,
  RepositoryHistoryPageDto,
  RepositoryHistoryScopeDto,
  RepositoryStatusSnapshotDto,
  RepositoryTargetDto,
  WorkspaceDetailsDto,
  WorkspaceOperationDto
} from "@gitnest/contracts";

import type { RepositoryTab } from "../../app/navigation";
import type { RepositoryChangeSelectionRequest } from "../../entities/repository/changeSelection";
import {
  useRepositoryCommitDiff,
  type RepositoryCommitDiffController
} from "../../entities/repository/useRepositoryCommitDiff";
import { useRepositoryDetails } from "../../entities/repository/useRepositoryDetails";
import { useRepositoryCommitDraft } from "../../entities/repository/useRepositoryCommitDraft";
import {
  useRepositoryStashes,
  useRepositoryStashView
} from "../../entities/repository/useRepositoryStashes";
import type { ExternalApplicationController } from "../../features/external-application/useExternalApplications";
import type { RepositoryCommandController } from "../../features/repository-command/useRepositoryCommands";
import type { AppSettingsController } from "../../features/settings/useAppSettings";
import type { ExternalTerminalController } from "../../features/external-terminal/useExternalTerminals";
import { WorktreeCommandDialog } from "../../features/worktree-command/WorktreeCommandDialog";
import { useWorktreeCommands } from "../../features/worktree-command/useWorktreeCommands";
import {
  canStageChange,
  canDiscardChange,
  canUnstageChange,
  useRepositoryMutations
} from "../../entities/repository/useRepositoryMutations";
import {
  findTargetSnapshot,
  findWorkspaceEntryForTarget,
  getSnapshotChangeCount,
  resolveWorkspaceTarget
} from "../../entities/workspace/model";
import { Icon } from "../../shared/ui/Icon";
import {
  buildDiffViewerFiles,
  type DiffViewerFile
} from "../../shared/model/diffViewModel";
import { copyTextToClipboard } from "../../shared/lib/copyTextToClipboard";
import { formatCommitTimestamp } from "../../shared/lib/formatCommitTimestamp";
import { useMinimumLoadingIndicator } from "../../shared/lib/useMinimumLoadingIndicator";
import { Input } from "../../shared/ui/Input";
import {
  MenuHeading,
  MenuItem,
  MenuPopover,
  MenuSeparator
} from "../../shared/ui/Menu";
import {
  Skeleton,
  SkeletonBoundary
} from "../../shared/ui/Skeleton";
import { Toast, ToastViewport } from "../../shared/ui/Toast";
import { RepositoryWorktrees } from "./RepositoryWorktrees";
import { RepositoryStashBrowser } from "./RepositoryStashBrowser";
import {
  applyTapdKeywordToCommitMessage,
  readTapdKeywordPreference
} from "../../widgets/workspace-sidebar/tapdKeywordPreferences";
import { getRendererPreferenceStorage } from "../../widgets/workspace-sidebar/sidebarPreferences";
import {
  DEFAULT_DIFF_CONTEXT_LINES,
  DiffPanel,
  DiffViewerState,
  type DiffContextRequest,
  type DiffPanelState
} from "../../widgets/diff-workspace/DiffPanel";
import {
  DiffWorkspace,
  DiffWorkspaceSkeleton,
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
  appSettings: AppSettingsController;
  changeSelectionRequest?: RepositoryChangeSelectionRequest | null;
  onOpenTab(tab: RepositoryTab): void;
  onChangeSelectionHandled?(requestId: number): void;
  onCommitSelectionChange?(
    commit: RepositoryCommitDto["commit"] | null
  ): void;
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
  appSettings,
  changeSelectionRequest,
  onOpenTab,
  onChangeSelectionHandled,
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
    statusRevision,
    changeSelectionRequest,
    onChangeSelectionHandled
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
  const targetKey = target
    ? `${target.repositoryId}:${target.worktreeId}`
    : "";
  const commitDraftScopeKey = target
    ? `${workspace?.id ?? ""}\u0001${targetKey}`
    : "";
  const {
    message: commitMessage,
    pushAfterCommit,
    setMessage: setCommitMessage,
    setMessageForScope: setCommitMessageForScope,
    setPushAfterCommit
  } = useRepositoryCommitDraft(commitDraftScopeKey);
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
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiFeedback, setAiFeedback] = useState<{
    title: string;
    message: string;
    tone: "success" | "error";
  } | null>(null);
  const targetKeyRef = useRef(targetKey);
  targetKeyRef.current = targetKey;
  const handledCommandCompletion = useRef(
    commands.completionVersion
  );

  useEffect(() => {
    mutations.clearFeedback();
    commands.clearFeedback();
    terminals.clearFeedback();
    setDirectoryError(null);
    setCopyFeedback(null);
    setAiGenerating(false);
    setAiFeedback(null);
    handledCommandCompletion.current =
      commands.completionVersion;
  }, [mutations.clearFeedback, targetKey]);

  const generateAiCommitMessage = useCallback(async () => {
    if (!target || aiGenerating) {
      return;
    }
    const requestTargetKey = targetKey;
    const requestCommitDraftScopeKey =
      commitDraftScopeKey;
    setAiGenerating(true);
    setAiFeedback(null);
    try {
      const result =
        await window.gitnest.ai.generateCommitMessage({
          target
        });
      if (!result.ok) {
        if (targetKeyRef.current === requestTargetKey) {
          setAiFeedback({
            title: "AI 提交信息未生成",
            message: formatAiError(result.error),
            tone: "error"
          });
        }
        return;
      }
      const tapdKeyword = readTapdKeywordPreference(
        getRendererPreferenceStorage(),
        workspace?.id,
        findWorkspaceEntryForTarget(workspace, target)?.id ??
          workspace?.selectedEntryId
      );
      setCommitMessageForScope(
        requestCommitDraftScopeKey,
        applyTapdKeywordToCommitMessage(
          result.value.message,
          tapdKeyword
        )
      );
      if (targetKeyRef.current !== requestTargetKey) {
        return;
      }
      setAiFeedback({
        title: "AI 提交信息已生成",
        message: result.value.truncated
          ? `已根据 ${result.value.stagedFiles} 个变更文件生成；输入 Diff 过大，已按上限截断。`
          : `已根据 ${result.value.stagedFiles} 个变更文件填入提交信息。`,
        tone: "success"
      });
    } catch (reason) {
      if (targetKeyRef.current === requestTargetKey) {
        setAiFeedback({
          title: "AI 提交信息未生成",
          message:
            reason instanceof Error
              ? reason.message
              : "AI 请求失败。",
          tone: "error"
        });
      }
    } finally {
      if (targetKeyRef.current === requestTargetKey) {
        setAiGenerating(false);
      }
    }
  }, [
    aiGenerating,
    commitDraftScopeKey,
    setCommitMessageForScope,
    target,
    targetKey,
    workspace
  ]);

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
              <Button size="small"
                aria-busy={details.loading[tab]}
                onClick={() => void details.reload(tab)}
                type="button"
              >
                <Icon name="refresh" />
                重新读取
              </Button>
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
        {aiFeedback && (
          <Toast
            closeLabel="关闭 AI 提示"
            icon={
              aiFeedback.tone === "error"
                ? "warning"
                : "sparkle"
            }
            key="ai-commit-feedback"
            message={aiFeedback.message}
            onClose={() => setAiFeedback(null)}
            title={aiFeedback.title}
            tone={aiFeedback.tone}
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
          appSettings={appSettings}
          aiGenerating={aiGenerating}
          commitMessage={commitMessage}
          controller={details}
          externalApplications={externalApplications}
          mutations={mutations}
          onCommitMessageChange={setCommitMessage}
          onGenerateAi={generateAiCommitMessage}
          onCommitted={() => {
            setCommitMessage("");
          }}
          onPushAfterCommitChange={setPushAfterCommit}
          pushAfterCommit={pushAfterCommit}
          selectionRevealKey={
            details.changeSelectionRequestId === null
              ? undefined
              : String(details.changeSelectionRequestId)
          }
          target={target}
          workspaceId={workspace?.id}
        />
      )}
      {tab === "history" && (
        <RepositoryHistory
          branch={snapshot?.branch}
          controller={details}
          onCopyCommitId={copyCommitId}
          repositoryKey={`${target.repositoryId}:${target.worktreeId}`}
          target={target}
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
          <Button size="small"
            aria-busy={directoryOpening}
            className="repository-hero-action"
            disabled={!repositoryPath || directoryOpening}
            onClick={onOpenDirectory}
            type="button"
          >
            <Icon name="folder" />
            {directoryOpening ? "打开中…" : "打开目录"}
          </Button>
          <Button size="small" variant="primary"
            className="repository-hero-action"
            onClick={() => onOpenTab("changes")}
            type="button"
          >
            <Icon name="fileCode" />
            {changes > 0 ? "查看变更" : "查看状态"}
          </Button>
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
              {commits.length
                ? `快照采集 ${commits.length} 条`
                : "暂无提交"}
            </span>
            <Button variant="unstyled"
              className="panel-action"
              onClick={() => onOpenTab("history")}
              type="button"
            >
              打开历史视图
            </Button>
          </header>
          <SkeletonBoundary
            fallback={<RepositoryRecentCommitsSkeleton />}
            hasContent={Boolean(latestCommit)}
            label="正在读取最近提交"
            loading={historyLoading}
            surfaceClassName="repository-overview-skeleton"
          >
            {latestCommit ? (
              <div className="repository-overview-commit-list">
                {commits.map((commit) => (
                  <Button variant="unstyled"
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
                  </Button>
                ))}
              </div>
            ) : (
              <div className="repository-overview-loading">
                <Icon name="history" size={18} />
                暂无提交历史
              </div>
            )}
          </SkeletonBoundary>
        </article>
      </section>
    </>
  );
}

export function shouldShowRepositoryChangesSkeleton({
  hasCurrentChanges,
  hasError,
  scopeChanged
}: {
  hasCurrentChanges: boolean;
  hasError: boolean;
  scopeChanged: boolean;
}): boolean {
  return (
    scopeChanged || (!hasCurrentChanges && !hasError)
  );
}

function RepositoryChanges({
  appSettings,
  aiGenerating,
  commands,
  controller,
  mutations,
  externalApplications,
  commitMessage,
  pushAfterCommit,
  selectionRevealKey,
  onCommitMessageChange,
  onGenerateAi,
  onPushAfterCommitChange,
  onCommitted,
  workspaceId,
  target
}: {
  appSettings: AppSettingsController;
  aiGenerating: boolean;
  commands: RepositoryCommandController;
  controller: ReturnType<typeof useRepositoryDetails>;
  mutations: ReturnType<typeof useRepositoryMutations>;
  externalApplications: ExternalApplicationController;
  commitMessage: string;
  pushAfterCommit: boolean;
  selectionRevealKey?: string | undefined;
  onCommitMessageChange(value: string): void;
  onGenerateAi(): void | Promise<void>;
  onPushAfterCommitChange(value: boolean): void;
  onCommitted(): void;
  workspaceId: string | undefined;
  target: RepositoryTargetDto;
}) {
  const changesScopeKey = `${workspaceId ?? ""}\u0001${target.repositoryId}:${target.worktreeId}`;
  const controllerChangesScopeKey = controller.changes
    ? `${workspaceId ?? ""}\u0001${controller.changes.target.repositoryId}:${controller.changes.target.worktreeId}`
    : "";
  const currentChanges =
    controllerChangesScopeKey === changesScopeKey
      ? controller.changes
      : null;
  const previousChangesScopeKey = useRef(changesScopeKey);
  const scopeChanged =
    previousChangesScopeKey.current !== changesScopeKey;
  if (scopeChanged) {
    previousChangesScopeKey.current = changesScopeKey;
  }
  const changes = currentChanges?.snapshot.changes ?? [];
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
  const diffContextLines =
    controller.selectedChange?.contextLines ??
    DEFAULT_DIFF_CONTEXT_LINES;
  const selectedDiff =
    selectedFile &&
    controller.selectedChange?.path === selectedFile.path &&
    controller.selectedChange.mode === selectedFile.mode
      ? diff
      : undefined;
  const diffLoading =
    controller.loading.diff && !selectedDiff;
  const showChangesSkeleton =
    useMinimumLoadingIndicator(
      shouldShowRepositoryChangesSkeleton({
        hasCurrentChanges: Boolean(currentChanges),
        hasError: Boolean(controller.error),
        scopeChanged
      })
    );
  const showDiffSkeleton =
    useMinimumLoadingIndicator(diffLoading);
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
  const stashView = useRepositoryStashView(changesScopeKey);
  const stashMutationHooks = useMemo(
    () => ({
      afterMutation: () => controller.reload("changes")
    }),
    [controller.reload]
  );
  const stashes = useRepositoryStashes(
    target,
    changesScopeKey,
    stashMutationHooks
  );

  useEffect(() => {
    if (stashView.active) {
      void stashes.load();
    }
  }, [stashView.active, stashes.load]);

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
  const requestDiffContext = ({
    contextLines
  }: DiffContextRequest) => {
    if (!selectedFile || contextLines <= diffContextLines) {
      return;
    }

    void controller.selectChange(
      selectedFile.change,
      selectedFile.mode,
      {
        contextLines,
        preserveDiff: true
      }
    );
  };

  if (showChangesSkeleton) {
    return (
      <div className="changes-page">
        <DiffWorkspaceSkeleton
          className="changes-layout"
          commitPanelHeight={
            appSettings.settings.diff.commitPanelHeight
          }
          label="正在读取工作区变更…"
          showCommit
        />
      </div>
    );
  }

  const diffPanelState: DiffPanelState | undefined =
    changes.length === 0 && currentChanges
      ? {
          icon: "check",
          message:
            "没有 staged、unstaged、untracked 或冲突文件。",
          title: "工作区干净"
        }
      : showDiffSkeleton
      ? {
          busy: true,
          icon: "refresh",
          message: "正在读取所选文件内容。",
          title: "读取 Diff…"
        }
      : controller.diffNotice === "change-removed"
        ? {
            icon: "eye",
            message: "该变更在重新读取仓库状态后已不存在。",
            title: "状态已更新"
          }
        : !selectedDiff?.media &&
            selectedDiff?.mode === "unstaged" &&
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
      <ToastViewport>
        {(stashes.mutationError || stashes.notice) && (
          <Toast
            closeLabel="关闭储藏操作提示"
            icon={stashes.mutationError ? "warning" : "check"}
            key="repository-stash-mutation-feedback"
            message={
              stashes.mutationError?.message ??
              stashes.notice ??
              ""
            }
            onClose={stashes.clearMutationFeedback}
            title={
              stashes.mutationError
                ? "储藏操作未完成"
                : "储藏操作完成"
            }
            tone={stashes.mutationError ? "error" : "success"}
          />
        )}
      </ToastViewport>
      <DiffWorkspace
        auxiliaryView={{
          active: stashView.active,
          busy:
            stashes.loading.stashes ||
            stashes.loading.files ||
            stashes.active !== null ||
            mutations.active !== null ||
            commands.busy,
          content: (
            <RepositoryStashBrowser
              error={stashes.error}
              loading={stashes.loading}
              mutationBusy={
                stashes.active !== null ||
                mutations.active !== null ||
                commands.busy
              }
              selectedStashRef={stashes.selectedStashRef}
              stashFiles={stashes.stashFiles}
              stashes={stashes.stashes}
              onMutateStash={stashes.mutateStash}
              onReload={() => void stashes.reload()}
              onSelectStash={(stashRef) =>
                void stashes.selectStash(stashRef)
              }
            />
          ),
          count: stashes.stashes?.stashes.length,
          label: "储藏的变更",
          onToggle: () => {
            stashView.toggle();
          }
        }}
        className="changes-layout"
        canStageFile={(file) => canStageChange(file.change)}
        canUnstageFile={(file) =>
          canUnstageChange(file.change)
        }
        canDiscardFile={(file) => canDiscardChange(file.change)}
        changesError={
          !currentChanges && controller.error
            ? {
                icon: "warning",
                message: controller.error.message,
                title: "工作区变更暂时不可用"
              }
            : undefined
        }
        changesLoading={controller.loading.changes}
        commit={{
          ai: {
            enabled: appSettings.settings.ai.enabled,
            busy: aiGenerating,
            disabled:
              !appSettings.settings.ai.apiKeyConfigured ||
              !appSettings.settings.ai.apiUrl ||
              !appSettings.settings.ai.model ||
              !appSettings.settings.ai.prompt,
            title:
              !appSettings.settings.ai.apiKeyConfigured ||
              !appSettings.settings.ai.apiUrl ||
              !appSettings.settings.ai.model ||
              !appSettings.settings.ai.prompt
                ? "请先在设置中完成 AI 提交信息配置"
                : "根据当前提交范围生成提交信息",
            onGenerate: onGenerateAi
          },
          busy:
            mutations.active !== null ||
            stashes.active !== null ||
            commands.busy,
          commitPanelHeight:
            appSettings.settings.diff.commitPanelHeight,
          conflicted:
            currentChanges?.snapshot.conflicted ?? 0,
          message: commitMessage,
          push: pushAfterCommit,
          staged: currentChanges?.snapshot.staged ?? 0,
          unstaged:
            currentChanges?.snapshot.unstaged ?? 0,
          untracked:
            currentChanges?.snapshot.untracked ?? 0,
          submitting:
            mutations.active === "commit" ||
            (pushAfterCommit && commands.active === "push"),
          onMessageChange: onCommitMessageChange,
          onPushChange: onPushAfterCommitChange,
          onCommitPanelHeightChange: (height) =>
            void appSettings.update(
              { diff: { commitPanelHeight: height } },
              { silent: true }
            ),
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
        externalApplications={externalApplications}
        fileView={appSettings.settings.diff.fileView}
        files={workspaceFiles}
        mutationBusy={
          mutations.active !== null || stashes.active !== null
        }
        onFileViewChange={(fileView) =>
          void appSettings.update(
            { diff: { fileView } },
            { silent: true }
          )
        }
        onSelectedFileChange={(file) =>
          void controller.selectChange(file.change, file.mode)
        }
        onStageFile={(file) =>
          mutations.stageChange(file.change)
        }
        onUnstageFile={(file) =>
          mutations.unstageChange(file.change)
        }
        onDiscardFile={(file) =>
          mutations.discardChange(file.change)
        }
        onDiscardFiles={(files) =>
          mutations.discardChanges(
            files.map((file) => file.change)
          )
        }
        onStageFiles={(files) =>
          mutations.stageChanges(
            files.map((file) => file.change)
          )
        }
        onUnstageFiles={(files) =>
          mutations.unstageChanges(
            files.map((file) => file.change)
          )
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
          contextLines: diffContextLines,
          contextLoading: controller.loading.diff,
          deletions: selectedDiff?.deletions,
          emptyPathLabel: "选择一个文件",
          emptyStatsLabel: "",
          maxLines: 4_000,
          media: selectedDiff?.media,
          state: diffPanelState,
          statsAvailable: Boolean(selectedDiff),
          truncated: selectedDiff?.truncated,
          preferredLayout: appSettings.settings.diff.layout,
          preferredWrap: appSettings.settings.diff.wrap,
          onLayoutPreferenceChange: (layout) =>
            void appSettings.update(
              { diff: { layout } },
              { silent: true }
            ),
          onWrapPreferenceChange: (wrap) =>
            void appSettings.update(
              { diff: { wrap } },
              { silent: true }
            ),
          onContextRequest: requestDiffContext
        }}
        selectedFileKey={selectedFileKey}
        selectionRevealKey={selectionRevealKey}
        treePreference={{
          initiallyCollapsed:
            appSettings.settings.diff
              .treeDirectoriesCollapsed,
          scopeKey: changesScopeKey,
          onCollapsedPreferenceChange: (collapsed) =>
            void appSettings.update(
              {
                diff: {
                  treeDirectoriesCollapsed: collapsed
                }
              },
              { silent: true }
            )
        }}
      />
    </div>
  );
}

interface HistoryScopeControlsProps {
  branches: BranchDto[];
  currentBranchName: string | undefined;
  loading: boolean;
  scope: RepositoryHistoryScopeDto | null;
  onChange(scope: RepositoryHistoryScopeDto | null): void;
}

type HistoryCompareDraft = {
  leftRef: string;
  rightRef: string;
};

function HistoryScopeControls({
  branches,
  currentBranchName,
  loading,
  scope,
  onChange
}: HistoryScopeControlsProps) {
  const currentBranch =
    branches.find((branch) => branch.current) ??
    branches.find(
      (branch) =>
        !branch.remote && branch.name === currentBranchName
    );
  const selectedSingleRef =
    scope?.kind === "ref"
      ? scope.ref
      : currentBranch?.fullName ?? "";
  const selectedSingleBranch = branches.find(
    (branch) => branch.fullName === selectedSingleRef
  );
  const lastSingleScopeRef =
    useRef<RepositoryHistoryScopeDto | null>(null);
  const [compareDraft, setCompareDraft] =
    useState<HistoryCompareDraft | null>(null);

  useEffect(() => {
    if (scope?.kind !== "compare" && !compareDraft) {
      lastSingleScopeRef.current = scope;
    }
  }, [compareDraft, scope]);

  useEffect(() => {
    if (scope?.kind === "compare") {
      setCompareDraft(null);
    }
  }, [scope]);

  const comparison =
    scope?.kind === "compare" ? scope : compareDraft;
  const beginComparison = () => {
    if (!selectedSingleRef) {
      return;
    }
    lastSingleScopeRef.current =
      scope?.kind === "ref" ? scope : null;
    const upstream = selectedSingleBranch?.upstream
      ? branches.find(
          (branch) =>
            branch.name === selectedSingleBranch.upstream
        )
      : undefined;

    if (
      upstream &&
      upstream.fullName !== selectedSingleRef
    ) {
      onChange({
        kind: "compare",
        leftRef: upstream.fullName,
        rightRef: selectedSingleRef
      });
      return;
    }
    setCompareDraft({
      leftRef: "",
      rightRef: selectedSingleRef
    });
  };
  const updateComparison = (
    side: "left" | "right",
    ref: string
  ) => {
    const current = comparison ?? {
      leftRef: "",
      rightRef: selectedSingleRef
    };
    const next = {
      ...current,
      [side === "left" ? "leftRef" : "rightRef"]: ref
    };

    if (
      next.leftRef &&
      next.rightRef &&
      next.leftRef !== next.rightRef
    ) {
      setCompareDraft(null);
      onChange({
        kind: "compare",
        leftRef: next.leftRef,
        rightRef: next.rightRef
      });
      return;
    }
    setCompareDraft(next);
  };
  const leaveComparison = () => {
    setCompareDraft(null);
    onChange(lastSingleScopeRef.current);
  };

  if (comparison) {
    return (
      <div
        className="history-scope-controls comparison"
        aria-label="比较分支提交历史"
      >
        <HistoryRefPicker
          branches={branches}
          disabledRef={comparison.rightRef}
          label="基准"
          loading={loading}
          onChange={(ref) =>
            updateComparison("left", ref)
          }
          selectedRef={comparison.leftRef}
        />
        <HistoryRefPicker
          branches={branches}
          disabledRef={comparison.leftRef}
          label="目标"
          loading={loading}
          onChange={(ref) =>
            updateComparison("right", ref)
          }
          selectedRef={comparison.rightRef}
        />
        <Button
          className="history-compare-exit"
          onClick={leaveComparison}
          size="small"
          type="button"
        >
          退出比较
        </Button>
      </div>
    );
  }

  return (
    <div
      className="history-scope-controls"
      aria-label="选择提交历史范围"
    >
      <HistoryRefPicker
        branches={branches}
        label="查看"
        loading={loading}
        onChange={(ref) =>
          onChange({ kind: "ref", ref })
        }
        selectedRef={selectedSingleRef}
        selectedName={
          selectedSingleBranch?.name ??
          currentBranchName ??
          "当前分支"
        }
      />
      <Button
        disabled={loading || branches.length < 2}
        onClick={beginComparison}
        size="small"
        title="比较两个本地或远程跟踪分支的差异提交"
        type="button"
      >
        <Icon name="diff" size={13} />
        比较
      </Button>
    </div>
  );
}

interface HistoryRefPickerProps {
  branches: BranchDto[];
  disabledRef?: string;
  label: string;
  loading: boolean;
  selectedRef: string;
  selectedName?: string;
  onChange(ref: string): void;
}

type HistoryRefGroup = "local" | "remote";

interface HistoryRefBranch {
  fullName: string;
  merged?: boolean;
  name: string;
  remote: boolean;
  upstream?: string | null;
}

interface HistoryRefFilterOptions {
  selectedRef?: string;
  showMergedRemote?: boolean;
}

export function groupHistoryRefBranches<
  TBranch extends HistoryRefBranch
>(
  branches: TBranch[],
  query: string,
  activeGroup: HistoryRefGroup,
  {
    selectedRef = "",
    showMergedRemote = false
  }: HistoryRefFilterOptions = {}
) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matches = normalizedQuery
    ? branches.filter((branch) =>
        [
          branch.name,
          branch.fullName,
          branch.upstream ?? ""
        ].some((value) =>
          value
            .toLocaleLowerCase()
            .includes(normalizedQuery)
        )
      )
    : branches;
  const searching = normalizedQuery.length > 0;
  const localBranchCount = branches.filter(
    (branch) => !branch.remote
  ).length;
  const remoteBranchCount = branches.filter(
    (branch) => branch.remote
  ).length;
  const remoteMatches = matches.filter(
    (branch) => branch.remote
  );
  const mergedRemoteCount = branches.filter(
    (branch) =>
      branch.remote &&
      branch.merged === true &&
      branch.fullName !== selectedRef
  ).length;

  return {
    localBranchCount,
    localBranches:
      searching || activeGroup === "local"
        ? matches.filter((branch) => !branch.remote)
        : [],
    mergedRemoteCount,
    remoteBranchCount,
    remoteBranches:
      searching || activeGroup === "remote"
        ? remoteMatches.filter(
            (branch) =>
              searching ||
              showMergedRemote ||
              branch.merged !== true ||
              branch.fullName === selectedRef
          )
        : [],
    searching
  };
}

export function historyRefOptionClassName(
  selected: boolean
) {
  return selected
    ? "history-ref-option is-selected"
    : "history-ref-option";
}

function HistoryRefPicker({
  branches,
  disabledRef,
  label,
  loading,
  selectedRef,
  selectedName,
  onChange
}: HistoryRefPickerProps) {
  const [anchor, setAnchor] =
    useState<HTMLButtonElement | null>(null);
  const [activeGroup, setActiveGroup] =
    useState<HistoryRefGroup>("local");
  const [query, setQuery] = useState("");
  const [showMergedRemote, setShowMergedRemote] =
    useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const {
    localBranchCount,
    localBranches,
    mergedRemoteCount,
    remoteBranchCount,
    remoteBranches,
    searching
  } = groupHistoryRefBranches(
    branches,
    query,
    activeGroup,
    {
      selectedRef,
      showMergedRemote
    }
  );
  const visibleBranchCount =
    localBranches.length + remoteBranches.length;
  const selected = branches.find(
    (branch) => branch.fullName === selectedRef
  );

  useEffect(() => {
    if (!anchor) {
      return;
    }
    const closeForPointer = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (anchor.contains(target) ||
          menuRef.current?.contains(target))
      ) {
        return;
      }
      setAnchor(null);
      setQuery("");
    };
    const closeForEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      setAnchor(null);
      setQuery("");
      anchor.focus();
    };
    document.addEventListener("pointerdown", closeForPointer);
    document.addEventListener("keydown", closeForEscape);
    return () => {
      document.removeEventListener(
        "pointerdown",
        closeForPointer
      );
      document.removeEventListener(
        "keydown",
        closeForEscape
      );
    };
  }, [anchor]);

  const selectRef = (ref: string) => {
    onChange(ref);
    setAnchor(null);
    setQuery("");
    anchor?.focus();
  };
  const renderGroup = (
    heading: string,
    items: BranchDto[]
  ) =>
    items.length ? (
      <>
        {searching && <MenuHeading>{heading}</MenuHeading>}
        {items.map((branch) => (
          <MenuItem
            aria-checked={
              branch.fullName === selectedRef
            }
            className={historyRefOptionClassName(
              branch.fullName === selectedRef
            )}
            disabled={branch.fullName === disabledRef}
            key={branch.fullName}
            leading={<Icon name="branch" size={14} />}
            onClick={() => selectRef(branch.fullName)}
            role="menuitemradio"
            title={
              branch.fullName === disabledRef
                ? "比较范围不能选择同一个分支"
                : branch.fullName
            }
          >
            <span className="history-ref-option-copy">
              <strong>{branch.name}</strong>
              {!branch.remote && branch.upstream && (
                <small>跟踪 {branch.upstream}</small>
              )}
            </span>
          </MenuItem>
        ))}
      </>
    ) : null;

  return (
    <div className="history-ref-picker">
      <span className="history-ref-picker-label">{label}</span>
      <Button
        aria-expanded={Boolean(anchor)}
        aria-haspopup="menu"
        className="history-ref-trigger"
        disabled={loading && branches.length === 0}
        onClick={(event) => {
          const nextAnchor = anchor
            ? null
            : event.currentTarget;
          setAnchor(nextAnchor);
          setQuery("");
          if (nextAnchor) {
            setActiveGroup("local");
            setShowMergedRemote(false);
          }
        }}
        size="small"
        title={
          selected?.remote
            ? `${selected.name} · 本地远程引用快照`
            : selected?.fullName ?? selectedName
        }
        type="button"
      >
        <Icon name="branch" size={13} />
        <span>
          {selected?.name ??
            selectedName ??
            (loading ? "读取分支…" : "选择分支")}
        </span>
        <Icon name="chevron" size={12} />
      </Button>
      {anchor && (
        <MenuPopover
          align="start"
          anchor={anchor}
          aria-label={`${label}分支`}
          className="history-ref-menu"
          ref={menuRef}
          side="bottom"
        >
          <div className="history-ref-menu-header">
            <Input
              appearance="unstyled"
              aria-label={`搜索${label}分支`}
              autoFocus
              className="history-ref-search"
              onChange={(event) =>
                setQuery(event.target.value)
              }
              placeholder="搜索本地或远程分支"
              value={query}
            />
            <div className="history-ref-breadcrumb-row">
              <div
                aria-label="分支类型"
                className="history-ref-breadcrumb"
                role="tablist"
              >
                <button
                  aria-selected={activeGroup === "local"}
                  className={
                    activeGroup === "local"
                      ? "is-active"
                      : undefined
                  }
                  onClick={() => {
                    setActiveGroup("local");
                    setQuery("");
                  }}
                  role="tab"
                  type="button"
                >
                  <span>本地分支</span>
                  <span className="history-ref-count">
                    {localBranchCount}
                  </span>
                </button>
                <span aria-hidden="true">/</span>
                <button
                  aria-selected={activeGroup === "remote"}
                  className={
                    activeGroup === "remote"
                      ? "is-active"
                      : undefined
                  }
                  onClick={() => {
                    setActiveGroup("remote");
                    setQuery("");
                  }}
                  role="tab"
                  type="button"
                >
                  <span>远程分支</span>
                  <span className="history-ref-count">
                    {remoteBranchCount}
                  </span>
                </button>
              </div>
              {activeGroup === "remote" &&
                !searching &&
                mergedRemoteCount > 0 && (
                  <button
                    aria-pressed={showMergedRemote}
                    className="history-ref-merged-toggle"
                    onClick={() =>
                      setShowMergedRemote(
                        (current) => !current
                      )
                    }
                    type="button"
                  >
                    {showMergedRemote
                      ? "隐藏已合并"
                      : `显示已合并 ${mergedRemoteCount}`}
                  </button>
                )}
            </div>
          </div>
          {renderGroup("本地分支", localBranches)}
          {searching &&
            localBranches.length > 0 &&
            remoteBranches.length > 0 && <MenuSeparator />}
          {renderGroup("远程分支", remoteBranches)}
          {visibleBranchCount === 0 && (
            <span className="history-ref-empty">
              没有匹配的分支
            </span>
          )}
        </MenuPopover>
      )}
    </div>
  );
}

function RepositoryHistory({
  branch,
  controller,
  onCopyCommitId,
  repositoryKey,
  target
}: {
  branch: string | undefined;
  controller: ReturnType<typeof useRepositoryDetails>;
  onCopyCommitId(hash: string): Promise<void>;
  repositoryKey: string;
  target: RepositoryTargetDto;
}) {
  const controllerHistoryKey = controller.history
    ? `${controller.history.target.repositoryId}:${controller.history.target.worktreeId}`
    : null;
  const history =
    controllerHistoryKey === repositoryKey
      ? controller.history
      : null;
  const historyLifecycleRef = useRef({
    repositoryKey,
    hasLoaded: false
  });
  if (
    historyLifecycleRef.current.repositoryKey !== repositoryKey
  ) {
    historyLifecycleRef.current = {
      repositoryKey,
      hasLoaded: false
    };
  }
  if (history) {
    historyLifecycleRef.current.hasLoaded = true;
  }
  const hasLoadedHistory =
    historyLifecycleRef.current.hasLoaded;
  const loadingRegion = resolveHistoryLoadingRegion({
    hasCurrentHistory: Boolean(history),
    hasLoadedHistory,
    loading: controller.loading.history
  });
  const commits = history?.page.commits ?? [];
  const branches = controller.branches?.branches ?? [];
  const comparison = history?.page.comparison;
  const selected = controller.commit?.commit;
  const showCommitDetail = Boolean(
    controller.historyDetailOpen &&
      (controller.selectedCommitHash ||
        selected ||
        controller.loading.commit)
  );
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const scopeKey = historyScopeKey(controller.historyScope);
  useEffect(() => {
    setFilterOpen(false);
    setFilterQuery("");
  }, [scopeKey]);
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

  if (
    !controller.loading.history &&
    !history &&
    !hasLoadedHistory &&
    controller.error
  ) {
    return <RepositoryReadFailure label="提交历史暂时不可用" />;
  }

  return (
    <SkeletonBoundary
      fallback={<RepositoryHistorySkeleton />}
      hasContent={false}
      label="正在读取提交历史"
      loading={loadingRegion === "page"}
      surfaceAs="section"
      surfaceClassName="history-layout repository-history-skeleton"
    >
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
              {loadingRegion === "content"
                ? "正在读取所选引用…"
                : historyScopeCaption(
                    controller.historyScope,
                    commits.length,
                    branch
                  )}
            </span>
            <div className="history-header-actions">
              <HistoryScopeControls
                branches={branches}
                currentBranchName={branch}
                loading={controller.loading.branches}
                onChange={(scope) =>
                  void controller.selectHistoryScope(scope)
                }
                scope={controller.historyScope}
              />
              <div className="history-filter-controls">
                {filterOpen && (
                  <Input
                    appearance="unstyled"
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
                <Button
                  aria-expanded={filterOpen}
                  className="panel-header-action"
                  onClick={() =>
                    setFilterOpen((open) => !open)
                  }
                  size="small"
                  type="button"
                >
                  <Icon name="filter" size={13} />
                  筛选
                </Button>
              </div>
            </div>
          </header>
          <SkeletonBoundary
            fallback={<RepositoryHistoryRowsSkeleton />}
            hasContent={false}
            label="正在切换提交历史"
            loading={loadingRegion === "content"}
            surfaceClassName="history-content-region repository-history-content-skeleton"
          >
            <div className="history-content-region">
              {comparison && (
                <div className="history-comparison-summary">
                  <span className="history-comparison-side left">
                    {historyRefDisplayName(comparison.leftRef)}
                    <strong>{comparison.leftOnly}</strong>
                    条独有
                  </span>
                  <span className="history-comparison-side right">
                    {historyRefDisplayName(comparison.rightRef)}
                    <strong>{comparison.rightOnly}</strong>
                    条独有
                  </span>
                  <span className="history-comparison-base">
                    共同基点
                    <code>
                      {comparison.mergeBase?.slice(0, 7) ?? "无"}
                    </code>
                  </span>
                  <span className="history-comparison-note">
                    仅显示差异提交与共同基点
                  </span>
                </div>
              )}
              <div className="commit-list">
            {visibleCommits.map((item, index) => {
              const displayRef = item.comparisonSide
                ? comparisonSideLabel(
                    item.comparisonSide,
                    comparison
                  )
                : getPrimaryCommitRef(item.refs, branch);

              return (
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
                  }${
                    item.comparisonSide
                      ? ` comparison-${item.comparisonSide}`
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
                      item.comparisonSide
                        ? `comparison-${item.comparisonSide}`
                        : `${index === 2 ? "branch " : ""}lane-${index % 3}`
                    }`}
                  >
                    <span className="commit-node" />
                  </span>
                  <span className="commit-message">
                    <strong className="commit-subject">
                      {item.subject}
                    </strong>
                    <span className="commit-meta">
                      <span
                        className={`ref-label${
                          displayRef.startsWith("origin/")
                            ? " remote"
                            : ""
                        }${
                          item.comparisonSide
                            ? ` comparison-${item.comparisonSide}`
                            : ""
                        }`}
                        title={displayRef}
                      >
                        {displayRef}
                      </span>
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
                      if (
                        event.key !== "Enter" &&
                        event.key !== " "
                      ) {
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
              );
            })}
            {controller.error && !history ? (
              <div className="history-filter-empty error">
                <Icon name="warning" size={18} />
                <strong>提交历史切换失败</strong>
                <span>{controller.error.message}</span>
              </div>
            ) : visibleCommits.length === 0 ? (
              <div className="history-filter-empty">
                <Icon
                  name={normalizedFilter ? "search" : "history"}
                  size={18}
                />
                <strong>
                  {normalizedFilter
                    ? "没有匹配的提交"
                    : comparison
                      ? "两个分支没有差异提交"
                      : "该引用暂无提交历史"}
                </strong>
                <span>
                  {normalizedFilter
                    ? "可修改筛选关键词后重试。"
                    : comparison
                      ? "双方当前指向相同历史，或没有可展示的独有提交。"
                      : "可选择其他本地或远程引用查看。"}
                </span>
              </div>
            ) : null}
            {history?.page.nextOffset !== undefined && (
              <Button variant="unstyled"
                aria-busy={controller.loading.history}
                className="load-more-button"
                disabled={controller.loading.history}
                onClick={() => void controller.loadMoreHistory()}
                type="button"
              >
                {controller.loading.history
                  ? "加载中…"
                  : "加载更多"}
              </Button>
            )}
              </div>
            </div>
          </SkeletonBoundary>
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
            <SkeletonBoundary
              fallback={<RepositoryCommitDetailSkeleton />}
              hasContent={Boolean(selected)}
              label="正在读取提交详情"
              loading={controller.loading.commit}
              surfaceClassName="repository-commit-detail-skeleton"
            >
              {selected ? (
                <RepositoryCommitDetail
                  commit={selected}
                  key={selected.hash}
                  target={target}
                />
              ) : (
                <div className="diff-empty">
                  <Icon name="activity" size={20} />
                  <strong>选择提交查看详情</strong>
                </div>
              )}
            </SkeletonBoundary>
          </article>
        )}
      </section>
    </SkeletonBoundary>
  );
}

export function RepositoryCommitDetail({
  commit,
  target
}: {
  commit: RepositoryCommitDto["commit"];
  target: RepositoryTargetDto;
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
    <div className="commit-detail-body">
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

      <section
        aria-label="提交变更文件"
        className="history-commit-files"
      >
        <header className="history-commit-files-header">
          <div>
            <strong>变更文件</strong>
            <span>{commit.files.length}</span>
          </div>
          <CommitFileStats
            additions={commit.additions}
            deletions={commit.deletions}
          />
        </header>
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
          message: "正在读取该提交中的文件变更。",
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

function historyScopeKey(
  scope: RepositoryHistoryScopeDto | null
): string {
  if (!scope) {
    return "head";
  }
  return scope.kind === "ref"
    ? `ref:${scope.ref}`
    : `compare:${scope.leftRef}:${scope.rightRef}`;
}

export function resolveHistoryLoadingRegion({
  hasCurrentHistory,
  hasLoadedHistory,
  loading
}: {
  hasCurrentHistory: boolean;
  hasLoadedHistory: boolean;
  loading: boolean;
}): "content" | "page" | "ready" {
  if (!loading || hasCurrentHistory) {
    return "ready";
  }
  return hasLoadedHistory ? "content" : "page";
}

function historyScopeCaption(
  scope: RepositoryHistoryScopeDto | null,
  commitCount: number,
  currentBranch: string | undefined
): string {
  if (!scope) {
    return `只读快照 · 最近 ${commitCount} 条 ${
      currentBranch ?? "HEAD"
    } 提交`;
  }
  if (scope.kind === "ref") {
    return `只读快照 · 最近 ${commitCount} 条 ${historyRefDisplayName(
      scope.ref
    )} 提交`;
  }
  return `只读对比 · ${historyRefDisplayName(
    scope.leftRef
  )} ↔ ${historyRefDisplayName(scope.rightRef)}`;
}

function historyRefDisplayName(ref: string): string {
  return ref
    .replace(/^refs\/heads\//, "")
    .replace(/^refs\/remotes\//, "");
}

function comparisonSideLabel(
  side: CommitHistoryComparisonSideDto,
  comparison: RepositoryHistoryPageDto["page"]["comparison"]
): string {
  if (side === "base") {
    return "共同基点";
  }
  const ref =
    side === "left"
      ? comparison?.leftRef
      : comparison?.rightRef;
  return ref
    ? historyRefDisplayName(ref)
    : side === "left"
      ? "基准分支"
      : "目标分支";
}

function getPrimaryCommitRef(
  refs: string[] | undefined,
  branch: string | undefined
): string {
  const ref =
    (refs ?? []).find(
      (value) =>
        !value.startsWith("origin/") &&
        !value.startsWith("tag:")
    ) ??
    (refs ?? []).find((value) => !value.startsWith("tag:")) ??
    (refs ?? [])[0] ??
    branch ??
    "detached";

  return ref.replace(/^HEAD -> /, "");
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

  if (
    !controller.loading.branches &&
    !controller.branches &&
    controller.error
  ) {
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
    <SkeletonBoundary
      fallback={<RepositoryBranchesSkeleton />}
      hasContent={branches.length > 0}
      label="正在读取分支"
      loading={controller.loading.branches}
      surfaceClassName="repository-branches-page repository-branches-skeleton"
    >
      <div className="repository-branches-page">
        <header className="panel-header sticky-panel-header">
          <div className="panel-title">
            <Icon name="branch" />
            分支管理
          </div>
          <span className="panel-caption">
            快照采集当前本地分支 {localCount} 条
          </span>
          <Button size="small"
            aria-controls="new-branch-form"
            aria-expanded={createFormOpen}
            className="branch-header-action"
            onClick={() => setCreateFormOpen((open) => !open)}
            type="button"
          >
            <Icon
              name={createFormOpen ? "close" : "plus"}
              size={13}
            />
            {createFormOpen ? "收起" : "新建分支"}
          </Button>
        </header>
        {createFormOpen && (
          <div className="branch-management-toolbar">
            <form id="new-branch-form" onSubmit={createBranch}>
              <label htmlFor="new-branch-name">
                从当前 HEAD 创建分支
              </label>
              <div>
                <Input
                  fullWidth
                  id="new-branch-name"
                  maxLength={255}
                  onChange={(event) =>
                    setNewBranch(event.target.value)
                  }
                  placeholder="例如 feature/safe-sync"
                  size="small"
                  spellCheck={false}
                  value={newBranch}
                />
                <Button size="small" variant="primary"
                  aria-busy={commands.active === "create-branch"}
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
                </Button>
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
                    <Input
                      appearance="unstyled"
                      aria-label={`重命名 ${branch.name}`}
                      autoFocus
                      maxLength={255}
                      onChange={(event) =>
                        setRenamedBranch(event.target.value)
                      }
                      spellCheck={false}
                      value={renamedBranch}
                    />
                    <Button variant="unstyled"
                      className="mini-action"
                      disabled={
                        commands.busy ||
                        !renamedBranch.trim() ||
                        renamedBranch.trim() === branch.name
                      }
                      type="submit"
                    >
                      保存
                    </Button>
                    <Button variant="unstyled"
                      className="mini-action"
                      disabled={commands.busy}
                      onClick={() => {
                        setRenamingBranch(null);
                        setRenamedBranch("");
                      }}
                      type="button"
                    >
                      取消
                    </Button>
                    </form>
                  ) : (
                    <Button variant="unstyled"
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
                    </Button>
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
    </SkeletonBoundary>
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

function RepositoryRecentCommitsSkeleton() {
  return (
    <div className="gn-skeleton-list repository-recent-commits-skeleton">
      {[88, 72, 80, 64].map((width, index) => (
        <div className="gn-skeleton-row" key={width}>
          <Skeleton variant="circle" width={12} height={12} />
          <span className="gn-skeleton-row-copy">
            <Skeleton
              variant="text"
              width={`${width}%`}
              height={14}
            />
            <Skeleton variant="text" width="42%" height={11} />
          </span>
          <Skeleton variant="text" width={74} height={12} />
          <Skeleton variant="text" width={58} height={12} />
          <Skeleton
            variant="text"
            width={52 + index * 2}
            height={12}
          />
        </div>
      ))}
    </div>
  );
}

function RepositoryHistorySkeleton() {
  return (
    <div className="history-list repository-history-list-skeleton">
      <div className="gn-skeleton-panel-header">
        <Skeleton variant="text" width={132} height={16} />
        <Skeleton variant="text" width={196} height={13} />
        <Skeleton width={152} height={30} />
      </div>
      <div className="history-content-region">
        <RepositoryHistoryRowsSkeleton />
      </div>
    </div>
  );
}

function RepositoryHistoryRowsSkeleton() {
  return (
    <div className="gn-skeleton-list repository-history-rows-skeleton">
      {[78, 92, 70, 84, 66, 88, 74].map((width, index) => (
        <div className="gn-skeleton-row" key={`${width}-${index}`}>
          <Skeleton variant="circle" width={12} height={12} />
          <span className="gn-skeleton-row-copy">
            <Skeleton
              variant="text"
              width={`${width}%`}
              height={14}
            />
            <Skeleton
              variant="text"
              width={`${32 + index * 4}%`}
              height={11}
            />
          </span>
          <Skeleton variant="text" width={82} height={12} />
          <Skeleton variant="text" width={68} height={12} />
          <Skeleton variant="text" width={54} height={12} />
        </div>
      ))}
    </div>
  );
}

function RepositoryCommitDetailSkeleton() {
  return (
    <div className="gn-skeleton-panel-body repository-commit-skeleton-body">
      <Skeleton variant="text" width="76%" height={24} />
      <div className="repository-commit-skeleton-meta">
        <Skeleton variant="text" width={90} height={12} />
        <Skeleton variant="text" width="58%" height={12} />
        <Skeleton variant="text" width={118} height={12} />
      </div>
      <Skeleton variant="text" width="92%" height={13} />
      <Skeleton variant="text" width="86%" height={13} />
      <Skeleton variant="text" width="64%" height={13} />
    </div>
  );
}

function RepositoryBranchesSkeleton() {
  return (
    <>
      <div className="gn-skeleton-panel-header">
        <Skeleton variant="text" width={112} height={16} />
        <Skeleton variant="text" width={184} height={13} />
        <Skeleton width={96} height={30} />
      </div>
      <div className="gn-skeleton-list repository-branches-skeleton-table">
        {[82, 68, 76, 60, 72, 64].map((width, index) => (
          <div
            className="gn-skeleton-row repository-branches-skeleton-row"
            key={`${width}-${index}`}
          >
            <span className="gn-skeleton-row-copy">
              <Skeleton
                variant="text"
                width={`${width}%`}
                height={14}
              />
            </span>
            <Skeleton variant="text" width={48} height={20} />
            <Skeleton variant="text" width={92} height={12} />
            <Skeleton variant="text" width={54} height={12} />
            <Skeleton variant="text" width={88} height={12} />
            <Skeleton variant="circle" width={24} height={24} />
          </div>
        ))}
      </div>
    </>
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

function formatAiError(error: GitReadErrorDto): string {
  if (error.code === "AUTHENTICATION_FAILED") {
    return "AI 认证失败，请检查 API Key。";
  }
  if (error.code === "COMMAND_TIMEOUT") {
    return "AI 请求超时，请检查服务地址或网络连接。";
  }
  if (error.code === "INVALID_REQUEST") {
    if (
      error.message
        .trim()
        .toLowerCase()
        .includes("no repository changes are available")
    ) {
      return "当前仓库没有可用于生成的变更。";
    }
    return error.message;
  }
  return error.message;
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
