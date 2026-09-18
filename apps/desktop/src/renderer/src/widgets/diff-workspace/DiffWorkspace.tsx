import {
  useCallback,
  useEffect,
  useId,
  useState,
  type MouseEvent,
  type ReactNode
} from "react";

import type { DiffFileViewDto } from "@gitnest/contracts";

import type { DiffViewerFile } from "../../shared/model/diffViewModel";
import { Button } from "../../shared/ui/Button";
import { Icon } from "../../shared/ui/Icon";
import {
  Skeleton,
  SkeletonSurface
} from "../../shared/ui/Skeleton";
import {
  DiffCommitComposer,
  type DiffWorkspaceCommit
} from "./DiffCommitComposer";
import { DiffDiscardConfirmationDialog } from "./DiffDiscardConfirmationDialog";
import {
  DiffFileNavigator,
  type DiffWorkspaceMessage,
  type DiffWorkspaceTreePreference
} from "./DiffFileNavigator";
import {
  createDiffFileContextMenuState,
  DiffFileContextMenu,
  type DiffFileContextMenuState,
  type DiffWorkspaceExternalApplications
} from "./DiffFileContextMenu";
import {
  DiffContentSkeleton,
  DiffPanel,
  type DiffPanelProps
} from "./DiffPanel";
import type { DiffWorkspaceConfiguration } from "./diffWorkspaceConfiguration";

export interface DiffWorkspaceOpenStandaloneAction {
  busy: boolean;
  disabled?: boolean | undefined;
  title?: string | undefined;
  onOpen(): void | Promise<void>;
}

export interface DiffWorkspaceSkeletonProps {
  className?: string | undefined;
  commitPanelHeight?: number | undefined;
  label?: string | undefined;
  showCommit?: boolean | undefined;
}

export interface DiffWorkspaceAuxiliaryView {
  active: boolean;
  busy?: boolean | undefined;
  content: ReactNode;
  count?: number | undefined;
  label: string;
  onToggle(): void;
}

interface DiffDiscardRequest {
  kind: "file" | "group";
  files: readonly DiffViewerFile[];
}

export interface DiffWorkspaceProps {
  configuration: DiffWorkspaceConfiguration;
  externalApplications: DiffWorkspaceExternalApplications;
  files: readonly DiffViewerFile[];
  selectedFileKey?: string | undefined;
  selectionRevealKey?: string | undefined;
  onSelectedFileChange(file: DiffViewerFile): void;
  onStageFile?:
    | ((
        file: DiffViewerFile
      ) => void | boolean | Promise<void | boolean>)
    | undefined;
  onUnstageFile?:
    | ((
        file: DiffViewerFile
      ) => void | boolean | Promise<void | boolean>)
    | undefined;
  canStageFile?:
    | ((file: DiffViewerFile) => boolean)
    | undefined;
  canUnstageFile?:
    | ((file: DiffViewerFile) => boolean)
    | undefined;
  mutationBusy?: boolean | undefined;
  changesLoading?: boolean | undefined;
  changesError?: DiffWorkspaceMessage | undefined;
  onRefresh?: (() => void) | undefined;
  panelProps: Omit<
    DiffPanelProps,
    | "config"
    | "headerActions"
    | "path"
    | "scopeKey"
    | "searchScopeKey"
  >;
  openStandalone?: DiffWorkspaceOpenStandaloneAction | undefined;
  commit?: DiffWorkspaceCommit | undefined;
  auxiliaryView?: DiffWorkspaceAuxiliaryView | undefined;
  statusbar?: ReactNode | undefined;
  treePreference?: DiffWorkspaceTreePreference | undefined;
  fileView?: DiffFileViewDto | undefined;
  onFileViewChange?:
    | ((value: DiffFileViewDto) => void)
    | undefined;
  onDiscardFile?:
    | ((
        file: DiffViewerFile
      ) => void | boolean | Promise<void | boolean>)
    | undefined;
  canDiscardFile?:
    | ((file: DiffViewerFile) => boolean)
    | undefined;
  onStageFiles?:
    | ((
        files: readonly DiffViewerFile[]
      ) => void | boolean | Promise<void | boolean>)
    | undefined;
  onUnstageFiles?:
    | ((
        files: readonly DiffViewerFile[]
      ) => void | boolean | Promise<void | boolean>)
    | undefined;
  onDiscardFiles?:
    | ((
        files: readonly DiffViewerFile[]
      ) => void | boolean | Promise<void | boolean>)
    | undefined;
  className?: string | undefined;
}

export function DiffWorkspace({
  configuration,
  externalApplications,
  files,
  selectedFileKey,
  selectionRevealKey,
  onSelectedFileChange,
  onStageFile,
  onUnstageFile,
  onDiscardFile,
  canDiscardFile,
  onStageFiles,
  onUnstageFiles,
  onDiscardFiles,
  canStageFile,
  canUnstageFile,
  mutationBusy,
  changesLoading,
  changesError,
  onRefresh,
  panelProps,
  openStandalone,
  commit,
  auxiliaryView,
  statusbar,
  treePreference,
  fileView,
  onFileViewChange,
  className
}: DiffWorkspaceProps) {
  const auxiliaryViewId = useId();
  const [fileContextMenu, setFileContextMenu] =
    useState<DiffFileContextMenuState | null>(null);
  const [discardRequest, setDiscardRequest] =
    useState<DiffDiscardRequest | null>(null);
  const selectedFile =
    files.find((file) => file.key === selectedFileKey) ??
    files[0];
  const showOpenStandalone =
    configuration.extensions.openStandaloneDiff &&
    Boolean(openStandalone);
  const showCommit =
    configuration.extensions.commitRegion && Boolean(commit);
  const showStatusbar =
    configuration.extensions.statusbar && Boolean(statusbar);
  const closeFileContextMenu = useCallback(() => {
    setFileContextMenu(null);
  }, []);
  const closeDiscardConfirmation = useCallback(() => {
    setDiscardRequest(null);
  }, []);
  const selectFile = useCallback(
    (file: DiffViewerFile) => {
      if (auxiliaryView?.active) {
        auxiliaryView.onToggle();
      }
      onSelectedFileChange(file);
    },
    [
      auxiliaryView?.active,
      auxiliaryView?.onToggle,
      onSelectedFileChange
    ]
  );
  const openFileContextMenu = useCallback(
    (
      event: MouseEvent<HTMLDivElement>,
      file: DiffViewerFile
    ) => {
      event.preventDefault();
      event.stopPropagation();
      setFileContextMenu(
        createDiffFileContextMenuState(
          file,
          event.clientX,
          event.clientY
        )
      );
      selectFile(file);
    },
    [selectFile]
  );
  const requestDiscardFile = useCallback(
    (file: DiffViewerFile) => {
      closeFileContextMenu();
      setDiscardRequest({
        kind: "file",
        files: [file]
      });
    },
    [closeFileContextMenu]
  );
  const requestDiscardFiles = useCallback(
    (requestedFiles: readonly DiffViewerFile[]) => {
      closeFileContextMenu();
      setDiscardRequest({
        kind: "group",
        files: [...requestedFiles]
      });
    },
    [closeFileContextMenu]
  );
  const confirmDiscard = useCallback(async () => {
    if (!discardRequest) {
      return false;
    }
    if (discardRequest.kind === "file") {
      const file = discardRequest.files[0];
      if (!file || !onDiscardFile) {
        return false;
      }
      return await onDiscardFile(file);
    }
    if (!onDiscardFiles) {
      return false;
    }
    return await onDiscardFiles(discardRequest.files);
  }, [discardRequest, onDiscardFile, onDiscardFiles]);

  useEffect(() => {
    closeFileContextMenu();
    closeDiscardConfirmation();
  }, [
    closeDiscardConfirmation,
    closeFileContextMenu,
    treePreference?.scopeKey
  ]);

  const headerActions = showOpenStandalone ? (
    <Button
      aria-label="在独立窗口中打开 Diff"
      className="diff-workspace-open-standalone"
      disabled={
        openStandalone?.disabled ||
        openStandalone?.busy ||
        !selectedFile
      }
      icon={<Icon name="external" size={14} />}
      loading={Boolean(openStandalone?.busy)}
      onClick={() => void openStandalone?.onOpen()}
      size="small"
      title={
        openStandalone?.title ??
        "在独立窗口中打开完整 Diff 查看器"
      }
      variant="icon"
    />
  ) : undefined;
  const diffPanel = (
    <DiffPanel
      {...panelProps}
      additions={panelProps.additions ?? selectedFile?.additions}
      config={configuration.document}
      deletions={panelProps.deletions ?? selectedFile?.deletions}
      headerActions={headerActions}
      keyboardShortcutsEnabled={!auxiliaryView?.active}
      path={selectedFile?.path}
      searchScopeKey={
        treePreference?.scopeKey ?? selectedFile?.key ?? ""
      }
      scopeKey={selectedFile?.key ?? ""}
      statsAvailable={
        panelProps.statsAvailable ??
        ((Number.isFinite(panelProps.additions) &&
          Number.isFinite(panelProps.deletions)) ||
          (Number.isFinite(selectedFile?.additions) &&
            Number.isFinite(selectedFile?.deletions)))
      }
    />
  );

  return (
    <section
      className={[
        "diff-workspace",
        showStatusbar ? "with-statusbar" : "",
        className
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <aside
        aria-label="变更文件"
        className={[
          "diff-workspace-sidebar",
          showCommit ? "with-commit" : "",
          auxiliaryView ? "with-auxiliary-view" : ""
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <DiffFileNavigator
          canStageFile={canStageFile}
          canUnstageFile={canUnstageFile}
          changesError={changesError}
          changesLoading={changesLoading}
          configuration={configuration.navigation}
          files={files}
          mutationBusy={mutationBusy}
          onFileContextMenu={openFileContextMenu}
          onRefresh={onRefresh}
          onSelectedFileChange={selectFile}
          onStageFile={onStageFile}
          onUnstageFile={onUnstageFile}
          onDiscardFile={
            onDiscardFile ? requestDiscardFile : undefined
          }
          canDiscardFile={canDiscardFile}
          onStageFiles={onStageFiles}
          onUnstageFiles={onUnstageFiles}
          onDiscardFiles={
            onDiscardFiles ? requestDiscardFiles : undefined
          }
          selectedFileKey={selectedFileKey}
          selectionRevealKey={selectionRevealKey}
          treePreference={treePreference}
          fileView={fileView}
          onFileViewChange={onFileViewChange}
        />
        {auxiliaryView ? (
          <div className="diff-workspace-auxiliary-entry">
            <Button
              aria-busy={auxiliaryView.busy}
              aria-controls={auxiliaryViewId}
              aria-label={auxiliaryView.label}
              aria-pressed={auxiliaryView.active}
              className="diff-workspace-auxiliary-toggle"
              onClick={auxiliaryView.onToggle}
              type="button"
              variant="unstyled"
            >
              <span className="diff-workspace-auxiliary-label">
                <Icon
                  className={
                    auxiliaryView.busy
                      ? "diff-workspace-auxiliary-busy"
                      : undefined
                  }
                  name={auxiliaryView.busy ? "refresh" : "layers"}
                  size={14}
                />
                <span>{auxiliaryView.label}</span>
                {auxiliaryView.count !== undefined ? (
                  <span className="diff-workspace-auxiliary-count">
                    {auxiliaryView.count}
                  </span>
                ) : null}
              </span>
              <Icon
                className="diff-workspace-auxiliary-chevron"
                name="collapse"
                size={13}
              />
            </Button>
          </div>
        ) : null}
        {showCommit && commit ? (
          <DiffCommitComposer
            {...commit}
            showPush={configuration.extensions.pushRegion}
          />
        ) : null}
      </aside>
      <div
        className="diff-workspace-content"
        id={auxiliaryView ? auxiliaryViewId : undefined}
      >
        {auxiliaryView ? (
          <>
            <div
              className="diff-workspace-primary-content"
              hidden={auxiliaryView.active}
            >
              {diffPanel}
            </div>
            <div
              className="diff-workspace-auxiliary-content"
              hidden={!auxiliaryView.active}
            >
              {auxiliaryView.content}
            </div>
          </>
        ) : (
          diffPanel
        )}
      </div>
      {showStatusbar ? (
        <footer className="diff-workspace-statusbar">
          {statusbar}
        </footer>
      ) : null}
      <DiffFileContextMenu
        applications={externalApplications}
        contextMenu={fileContextMenu}
        onClose={closeFileContextMenu}
      />
      {discardRequest ? (
        <DiffDiscardConfirmationDialog
          files={discardRequest.files}
          mutationBusy={mutationBusy}
          scope={discardRequest.kind}
          onCancel={closeDiscardConfirmation}
          onConfirm={confirmDiscard}
        />
      ) : null}
    </section>
  );
}

const DIFF_WORKSPACE_SKELETON_FILE_ROWS = [
  "long",
  "medium",
  "short",
  "long",
  "medium"
] as const;

export function DiffWorkspaceSkeleton({
  className,
  commitPanelHeight,
  label = "正在读取工作区变更…",
  showCommit = false
}: DiffWorkspaceSkeletonProps) {
  return (
    <SkeletonSurface
      as="section"
      className={[
        "diff-workspace",
        "diff-workspace-skeleton",
        className
      ]
        .filter(Boolean)
        .join(" ")}
      label={label}
    >
      <aside
        aria-hidden="true"
        className={[
          "diff-workspace-sidebar",
          showCommit ? "with-commit" : ""
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div className="diff-workspace-sidebar-header diff-workspace-skeleton-sidebar-header">
          <Skeleton className="diff-workspace-skeleton-sidebar-title" />
          <Skeleton className="diff-workspace-skeleton-filter" />
          <Skeleton className="diff-workspace-skeleton-square" />
        </div>
        <div className="diff-workspace-file-list diff-workspace-skeleton-file-list">
          <DiffWorkspaceSkeletonFileSection
            rows={DIFF_WORKSPACE_SKELETON_FILE_ROWS.slice(0, 3)}
          />
          <DiffWorkspaceSkeletonFileSection
            rows={DIFF_WORKSPACE_SKELETON_FILE_ROWS.slice(3)}
          />
        </div>
        {showCommit && (
          <div
            className="diff-workspace-skeleton-commit"
            style={
              commitPanelHeight === undefined
                ? undefined
                : { height: commitPanelHeight }
            }
          >
            <Skeleton className="diff-workspace-skeleton-resizer" />
            <div className="diff-workspace-skeleton-commit-header">
              <Skeleton className="diff-workspace-skeleton-commit-option" />
              <Skeleton className="diff-workspace-skeleton-commit-pill" />
            </div>
            <div className="diff-workspace-skeleton-commit-body">
              <Skeleton className="diff-workspace-skeleton-textarea" />
              <div className="diff-workspace-skeleton-commit-actions">
                <Skeleton className="diff-workspace-skeleton-square" />
                <Skeleton className="diff-workspace-skeleton-submit" />
              </div>
            </div>
          </div>
        )}
      </aside>
      <div
        aria-hidden="true"
        className="diff-workspace-content diff-workspace-skeleton-content"
      >
        <div className="diff-workspace-skeleton-document-header">
          <Skeleton className="diff-workspace-skeleton-document-title" />
          <Skeleton className="diff-workspace-skeleton-document-stat" />
          <Skeleton className="diff-workspace-skeleton-square" />
        </div>
        <DiffContentSkeleton />
      </div>
    </SkeletonSurface>
  );
}

function DiffWorkspaceSkeletonFileSection({
  rows
}: {
  rows: readonly (typeof DIFF_WORKSPACE_SKELETON_FILE_ROWS)[number][];
}) {
  return (
    <div className="diff-workspace-skeleton-file-section">
      <div className="diff-workspace-skeleton-group">
        <Skeleton className="diff-workspace-skeleton-chevron" />
        <Skeleton className="diff-workspace-skeleton-group-title" />
        <Skeleton className="diff-workspace-skeleton-count" />
      </div>
      {rows.map((width, index) => (
        <div
          className={`diff-workspace-skeleton-file-row is-${width}`}
          key={`${width}-${index + 1}`}
        >
          <Skeleton className="diff-workspace-skeleton-file-name" />
          <Skeleton className="diff-workspace-skeleton-file-meta" />
        </div>
      ))}
    </div>
  );
}

export type {
  DiffWorkspaceExternalApplications,
  DiffWorkspaceCommit,
  DiffWorkspaceMessage,
  DiffWorkspaceTreePreference
};
export { parseCommitMessage } from "./DiffCommitComposer";
