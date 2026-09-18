import {
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import type { RepositoryTargetDto } from "@gitnest/contracts";

import type { useRepositoryDetails } from "../../entities/repository/useRepositoryDetails";
import {
  useRepositoryStashes,
  useRepositoryStashView
} from "../../entities/repository/useRepositoryStashes";
import {
  canDiscardChange,
  canStageChange,
  canUnstageChange,
  type useRepositoryMutations
} from "../../entities/repository/useRepositoryMutations";
import type { ExternalApplicationController } from "../../features/external-application/useExternalApplications";
import type { RepositoryCommandController } from "../../features/repository-command/useRepositoryCommands";
import type { AppSettingsController } from "../../features/settings/useAppSettings";
import { useMinimumLoadingIndicator } from "../../shared/lib/useMinimumLoadingIndicator";
import { buildDiffViewerFiles } from "../../shared/model/diffViewModel";
import { Toast, ToastViewport } from "../../shared/ui/Toast";
import {
  DEFAULT_DIFF_CONTEXT_LINES,
  type DiffContextRequest,
  type DiffPanelState
} from "../../widgets/diff-workspace/DiffPanel";
import {
  DiffWorkspace,
  DiffWorkspaceSkeleton,
  parseCommitMessage
} from "../../widgets/diff-workspace/DiffWorkspace";
import { repositoryDiffWorkspaceConfiguration } from "../../widgets/diff-workspace/diffWorkspaceConfiguration";
import { RepositoryStashBrowser } from "./RepositoryStashBrowser";

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

export function RepositoryChanges({
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
