import { Button } from "../../shared/ui/Button";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
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
import type { RepositoryChangeSelectionRequest } from "../../entities/repository/changeSelection";
import { useRepositoryDetails } from "../../entities/repository/useRepositoryDetails";
import { useRepositoryCommitDraft } from "../../entities/repository/useRepositoryCommitDraft";
import type { ExternalApplicationController } from "../../features/external-application/useExternalApplications";
import type { RepositoryCommandController } from "../../features/repository-command/useRepositoryCommands";
import type { AppSettingsController } from "../../features/settings/useAppSettings";
import type { ExternalTerminalController } from "../../features/external-terminal/useExternalTerminals";
import { WorktreeCommandDialog } from "../../features/worktree-command/WorktreeCommandDialog";
import { useWorktreeCommands } from "../../features/worktree-command/useWorktreeCommands";
import { useWorkspaceWorktreeCommands } from "../../features/worktree-command/useWorkspaceWorktreeCommands";
import { useRepositoryMutations } from "../../entities/repository/useRepositoryMutations";
import {
  findTargetSnapshot,
  getSnapshotContentRevision,
  resolveWorkspaceTarget
} from "../../entities/workspace/model";
import { Icon } from "../../shared/ui/Icon";
import { copyTextToClipboard } from "../../shared/lib/copyTextToClipboard";
import { Toast, ToastViewport } from "../../shared/ui/Toast";
import { RepositoryBranches } from "./RepositoryBranches";
import { RepositoryChanges } from "./RepositoryChanges";
import { RepositoryHistory } from "./RepositoryHistory";
import { RepositoryOverview } from "./RepositoryOverview";
import { RepositoryWorktrees } from "./RepositoryWorktrees";
import {
  snapshotStatus,
  snapshotTone
} from "./repositoryStatusPresentation";
import {
  applyTapdKeywordToCommitMessage,
  readTapdKeywordPreference
} from "../../widgets/workspace-sidebar/tapdKeywordPreferences";
import { getRendererPreferenceStorage } from "../../widgets/workspace-sidebar/sidebarPreferences";

export {
  RepositoryCommitDetail,
  groupHistoryRefBranches,
  historyRefOptionClassName,
  resolveHistoryLoadingRegion
} from "./RepositoryHistory";
export { shouldShowRepositoryChangesSkeleton } from "./RepositoryChanges";

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
  onWorkspaceTopologyChanged?(): void | Promise<unknown>;
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
  onCommitSelectionChange,
  onWorkspaceTopologyChanged
}: RepositoryPageProps) {
  const snapshot = findTargetSnapshot(snapshots, target);
  const statusRevision = getSnapshotContentRevision(snapshot);
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
  const worktreeBatchCommands =
    useWorkspaceWorktreeCommands(
      workspace && target
        ? `${workspace.id}:${target.repositoryId}`
        : undefined,
      operations,
      onWorkspaceTopologyChanged,
      target?.repositoryId
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
  const handledWorktreeCommandCompletion = useRef(
    worktreeCommands.completionVersion
  );

  useEffect(() => {
    mutations.clearFeedback();
    commands.clearFeedback();
    worktreeBatchCommands.clearFeedback();
    terminals.clearFeedback();
    setDirectoryError(null);
    setCopyFeedback(null);
    setAiGenerating(false);
    setAiFeedback(null);
    handledCommandCompletion.current =
      commands.completionVersion;
    handledWorktreeCommandCompletion.current =
      worktreeCommands.completionVersion;
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
        workspace?.id
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

  useEffect(() => {
    if (
      handledWorktreeCommandCompletion.current ===
      worktreeCommands.completionVersion
    ) {
      return;
    }
    handledWorktreeCommandCompletion.current =
      worktreeCommands.completionVersion;
    void onWorkspaceTopologyChanged?.();
  }, [
    onWorkspaceTopologyChanged,
    worktreeCommands.completionVersion
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
        {(worktreeBatchCommands.error ||
          worktreeBatchCommands.notice) && (
          <Toast
            closeLabel="关闭 Worktree 批量操作提示"
            icon={
              worktreeBatchCommands.error
                ? "warning"
                : "check"
            }
            key="worktree-batch-command-feedback"
            message={
              worktreeBatchCommands.error?.message ??
              worktreeBatchCommands.notice ??
              ""
            }
            onClose={worktreeBatchCommands.clearFeedback}
            title={
              worktreeBatchCommands.error
                ? "Worktree 批量操作未完成"
                : "Worktree 批量操作状态"
            }
            tone={
              worktreeBatchCommands.error
                ? "error"
                : "success"
            }
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
          batchCommands={worktreeBatchCommands}
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
      {worktreeBatchCommands.preflights.length > 0 && (
        <WorktreeCommandDialog
          active={worktreeBatchCommands.active}
          onCancel={
            worktreeBatchCommands.dismissPreflight
          }
          onConfirm={() =>
            void worktreeBatchCommands.confirm()
          }
          preflight={worktreeBatchCommands.preflights}
          workspace={workspace}
        />
      )}
    </div>
  );
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
