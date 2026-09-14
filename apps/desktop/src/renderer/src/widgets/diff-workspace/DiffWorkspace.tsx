import type {
  MouseEvent,
  ReactNode
} from "react";

import type { DiffFileViewDto } from "@gitnest/contracts";

import type { DiffViewerFile } from "../../shared/model/diffViewModel";
import { Button } from "../../shared/ui/Button";
import { Icon } from "../../shared/ui/Icon";
import {
  DiffCommitComposer,
  type DiffWorkspaceCommit
} from "./DiffCommitComposer";
import {
  DiffFileNavigator,
  type DiffWorkspaceMessage,
  type DiffWorkspaceTreePreference
} from "./DiffFileNavigator";
import {
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

export interface DiffWorkspaceProps {
  configuration: DiffWorkspaceConfiguration;
  files: readonly DiffViewerFile[];
  selectedFileKey?: string | undefined;
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
  onFileContextMenu?:
    | ((
        event: MouseEvent<HTMLDivElement>,
        file: DiffViewerFile
      ) => void)
    | undefined;
  panelProps: Omit<
    DiffPanelProps,
    "config" | "headerActions" | "path" | "scopeKey"
  >;
  openStandalone?: DiffWorkspaceOpenStandaloneAction | undefined;
  commit?: DiffWorkspaceCommit | undefined;
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
  files,
  selectedFileKey,
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
  onFileContextMenu,
  panelProps,
  openStandalone,
  commit,
  statusbar,
  treePreference,
  fileView,
  onFileViewChange,
  className
}: DiffWorkspaceProps) {
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
        aria-label="文件变更"
        className={[
          "diff-workspace-sidebar",
          showCommit ? "with-commit" : ""
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
          onFileContextMenu={onFileContextMenu}
          onRefresh={onRefresh}
          onSelectedFileChange={onSelectedFileChange}
          onStageFile={onStageFile}
          onUnstageFile={onUnstageFile}
          onDiscardFile={onDiscardFile}
          canDiscardFile={canDiscardFile}
          onStageFiles={onStageFiles}
          onUnstageFiles={onUnstageFiles}
          onDiscardFiles={onDiscardFiles}
          selectedFileKey={selectedFileKey}
          treePreference={treePreference}
          fileView={fileView}
          onFileViewChange={onFileViewChange}
        />
        {showCommit && commit ? (
          <DiffCommitComposer
            {...commit}
            showPush={configuration.extensions.pushRegion}
          />
        ) : null}
      </aside>
      <div className="diff-workspace-content">
        <DiffPanel
          {...panelProps}
          additions={
            panelProps.additions ?? selectedFile?.additions
          }
          config={configuration.document}
          deletions={
            panelProps.deletions ?? selectedFile?.deletions
          }
          headerActions={headerActions}
          path={selectedFile?.path}
          scopeKey={selectedFile?.key ?? ""}
          statsAvailable={
            panelProps.statsAvailable ??
            ((Number.isFinite(panelProps.additions) &&
              Number.isFinite(panelProps.deletions)) ||
              (Number.isFinite(selectedFile?.additions) &&
                Number.isFinite(selectedFile?.deletions)))
          }
        />
      </div>
      {showStatusbar ? (
        <footer className="diff-workspace-statusbar">
          {statusbar}
        </footer>
      ) : null}
    </section>
  );
}

export type {
  DiffWorkspaceCommit,
  DiffWorkspaceMessage,
  DiffWorkspaceTreePreference
};
export { parseCommitMessage } from "./DiffCommitComposer";
