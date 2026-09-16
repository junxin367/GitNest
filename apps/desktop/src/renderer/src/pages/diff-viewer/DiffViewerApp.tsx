import { Button } from "../../shared/ui/Button";
import {
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import type {
  ChangedPathDto,
  GitReadErrorDto,
  OpenDiffViewerRequest,
  RepositoryDiffDto
} from "@gitnest/contracts";
import type { WorkspaceRuntimeStateDto } from "@gitnest/contracts";

import {
  canStageChange,
  canDiscardChange,
  canUnstageChange,
  useRepositoryMutations
} from "../../entities/repository/useRepositoryMutations";
import { useExternalApplications } from "../../features/external-application/useExternalApplications";
import { useAppSettings } from "../../features/settings/useAppSettings";
import {
  buildDiffViewerFiles,
  type DiffViewerFile,
  type DiffViewerMode
} from "../../shared/model/diffViewModel";
import { useMinimumLoadingIndicator } from "../../shared/lib/useMinimumLoadingIndicator";
import { Icon } from "../../shared/ui/Icon";
import { Toast, ToastViewport } from "../../shared/ui/Toast";
import {
  DEFAULT_DIFF_CONTEXT_LINES,
  DiffViewerState,
  type DiffContextRequest,
  type DiffPanelState,
  type DiffPathCopyStatus
} from "../../widgets/diff-workspace/DiffPanel";
import {
  DiffWorkspace,
  DiffWorkspaceSkeleton
} from "../../widgets/diff-workspace/DiffWorkspace";
import { standaloneDiffWorkspaceConfiguration } from "../../widgets/diff-workspace/diffWorkspaceConfiguration";

let querySequence = 0;

export function DiffViewerApp() {
  const request = useMemo(
    () => parseDiffViewerRequest(window.location.search),
    []
  );

  if (!request) {
    return <InvalidDiffViewer />;
  }

  return <DiffViewer request={request} />;
}

function DiffViewer({
  request
}: {
  request: OpenDiffViewerRequest;
}) {
  const appSettings = useAppSettings();
  const externalApplications = useExternalApplications({
    scope: "repository",
    target: request.target
  });
  const initialFile = useMemo<DiffViewerFile>(() => {
    const change: ChangedPathDto = {
      path: request.path,
      indexStatus: request.mode === "staged" ? "M" : ".",
      worktreeStatus:
        request.mode === "unstaged"
          ? "M"
          : request.mode === "untracked"
            ? "?"
            : ".",
      kind:
        request.mode === "untracked"
          ? "untracked"
          : "ordinary"
    };
    return {
      key: fileKey(request.path, request.mode),
      path: request.path,
      mode: request.mode,
      status: request.mode === "untracked" ? "?" : "M",
      kind: change.kind,
      change
    };
  }, [request.mode, request.path]);
  const [files, setFiles] = useState<DiffViewerFile[]>([
    initialFile
  ]);
  const [selectedKey, setSelectedKey] = useState(
    initialFile.key
  );
  const [branch, setBranch] = useState<string | undefined>();
  const [diff, setDiff] =
    useState<RepositoryDiffDto["diff"] | null>(null);
  const [changesLoading, setChangesLoading] = useState(true);
  const [changesLoaded, setChangesLoaded] = useState(false);
  const [diffLoading, setDiffLoading] = useState(true);
  const [diffContextLines, setDiffContextLines] = useState(
    DEFAULT_DIFF_CONTEXT_LINES
  );
  const [changesError, setChangesError] =
    useState<GitReadErrorDto | null>(null);
  const [diffError, setDiffError] =
    useState<GitReadErrorDto | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const diffRequestKeyRef = useRef<string | null>(null);
  const selectedFileKeyRef = useRef(initialFile.key);
  const [pathCopyStatus, setPathCopyStatus] =
    useState<DiffPathCopyStatus>("idle");
  const mutationHooks = useMemo(
    () => ({
      beforeMutation: () => undefined,
      afterMutation: async () => {
        setRefreshVersion((version) => version + 1);
      }
    }),
    []
  );
  const mutations = useRepositoryMutations(
    request.target,
    mutationHooks
  );
  const selectedFile =
    files.find((file) => file.key === selectedKey) ??
    files[0];
  const workspaceFiles = useMemo(
    () =>
      files.map((file) =>
        diff &&
        file.path === diff.path &&
        file.mode === diff.mode
          ? {
              ...file,
              additions: diff.additions,
              deletions: diff.deletions
            }
          : file
      ),
    [
      diff?.additions,
      diff?.deletions,
      diff?.mode,
      diff?.path,
      files
    ]
  );
  const showChangesSkeleton = useMinimumLoadingIndicator(
    changesLoading && !changesLoaded
  );

  useEffect(() => {
    document.documentElement.dataset.theme =
      appSettings.settings.appearance.theme;
  }, [appSettings.settings.appearance.theme]);

  useEffect(() => {
    document.title = selectedFile
      ? `${fileName(selectedFile.path)} — GitNest Diff`
      : "GitNest Diff";
  }, [selectedFile]);

  useEffect(() => {
    const nextKey = selectedFile?.key ?? "";
    if (selectedFileKeyRef.current === nextKey) {
      return;
    }
    selectedFileKeyRef.current = nextKey;
    setDiffContextLines(DEFAULT_DIFF_CONTEXT_LINES);
  }, [selectedFile?.key]);

  useEffect(() => {
    const queryId = nextQueryId("diff-viewer-changes");
    let current = true;
    setChangesLoading(true);
    setChangesError(null);

    void window.gitnest.repository
      .getChanges({
        queryId,
        target: request.target
      })
      .then((result) => {
        if (!current) {
          return;
        }
        if (!result.ok) {
          setChangesError(result.error);
          return;
        }

        const nextFiles = buildDiffViewerFiles(
          result.value.snapshot.changes
        );
        setBranch(result.value.snapshot.branch);
        setFiles(nextFiles);
        if (nextFiles.length === 0) {
          setDiff(null);
          setDiffLoading(false);
        }
        setSelectedKey((currentKey) =>
          nextFiles.some((file) => file.key === currentKey)
            ? currentKey
            : (nextFiles[0]?.key ?? "")
        );
      })
      .catch((reason) => {
        if (current) {
          setChangesError(unexpectedError(reason));
        }
      })
      .finally(() => {
        if (current) {
          setChangesLoaded(true);
          setChangesLoading(false);
        }
      });

    return () => {
      current = false;
      void window.gitnest.repository.cancelQuery({ queryId });
    };
  }, [
    refreshVersion,
    request.target.repositoryId,
    request.target.worktreeId
  ]);

  useEffect(() => {
    let active = true;
    const unsubscribe = window.gitnest.workspace.onStateChanged(
      (state: WorkspaceRuntimeStateDto) => {
        if (!active) {
          return;
        }
        const snapshot = state.snapshots.find(
          (candidate) =>
            candidate.repositoryId === request.target.repositoryId &&
            candidate.worktreeId === request.target.worktreeId
        );
        if (!snapshot) {
          return;
        }
        if (refreshTimerRef.current) {
          clearTimeout(refreshTimerRef.current);
        }
        refreshTimerRef.current = setTimeout(() => {
          refreshTimerRef.current = null;
          if (active) {
            setRefreshVersion((version) => version + 1);
          }
        }, 120);
      }
    );

    return () => {
      active = false;
      unsubscribe();
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [
    request.target.repositoryId,
    request.target.worktreeId
  ]);

  useEffect(() => {
    if (!selectedFile) {
      setDiff(null);
      setDiffLoading(false);
      diffRequestKeyRef.current = null;
      return;
    }

    const diffRequestKey = [
      request.target.repositoryId,
      request.target.worktreeId,
      selectedFile.key
    ].join("\u0001");
    const preserveExistingDiff =
      diffRequestKeyRef.current === diffRequestKey;
    diffRequestKeyRef.current = diffRequestKey;
    const queryId = nextQueryId("diff-viewer-diff");
    let current = true;
    if (!preserveExistingDiff) {
      setDiff(null);
    }
    setDiffError(null);
    setDiffLoading(true);
    setPathCopyStatus("idle");

    void window.gitnest.repository
      .getDiff({
        queryId,
        target: request.target,
        path: selectedFile.path,
        mode: selectedFile.mode,
        contextLines: diffContextLines
      })
      .then((result) => {
        if (!current) {
          return;
        }
        if (result.ok) {
          setDiff(result.value.diff);
        } else {
          setDiffError(result.error);
        }
      })
      .catch((reason) => {
        if (current) {
          setDiffError(unexpectedError(reason));
        }
      })
      .finally(() => {
        if (current) {
          setDiffLoading(false);
        }
      });

    return () => {
      current = false;
      void window.gitnest.repository.cancelQuery({ queryId });
    };
  }, [
    request.target.repositoryId,
    request.target.worktreeId,
    refreshVersion,
    diffContextLines,
    selectedFile?.key,
    selectedFile?.mode,
    selectedFile?.path
  ]);

  const repositoryContext = `${request.target.repositoryId}/${
    branch ?? request.target.worktreeId
  }`;
  const language = selectedFile
    ? languageLabel(selectedFile.path)
    : "—";
  const panelState: DiffPanelState | undefined = !selectedFile
    ? {
        icon: "files",
        message: "当前工作区没有可查看的本地变更。",
        title: "工作区干净"
      }
    : diffLoading && !diff
      ? {
          busy: true,
          icon: "refresh",
          message: "正在读取所选文件内容。",
          title: "读取 Diff…"
        }
      : diffError
        ? {
            icon: "warning",
            message: diffError.message,
            title: "Diff 读取失败"
          }
        : undefined;
  const changesMessage =
    changesError && files.length <= 1
      ? {
          icon: "warning" as const,
          message: changesError.message,
          title: "变更列表读取失败"
        }
      : undefined;
  const requestDiffContext = ({
    contextLines
  }: DiffContextRequest) => {
    setDiffContextLines((current) =>
      Math.max(current, contextLines)
    );
  };

  return (
    <div className="diff-viewer-app">
      <header
        className="diff-viewer-titlebar"
        onDoubleClick={(event) => {
          if (
            !(event.target as HTMLElement).closest("button")
          ) {
            void window.gitnest.window.toggleMaximize();
          }
        }}
      >
        <div className="diff-viewer-brand">
          <span className="brand-mark">
            <Icon name="fileCode" size={15} />
          </span>
          <strong>GitNest Diff</strong>
        </div>
        <span
          aria-hidden="true"
          className="diff-viewer-title-separator"
        />
        <span
          className="diff-viewer-context"
          title={repositoryContext}
        >
          {repositoryContext}
        </span>
        <div className="titlebar-drag-region" />
        <div className="titlebar-actions">
          <Button variant="unstyled"
            aria-label="最小化"
            className="window-button"
            onClick={() => void window.gitnest.window.minimize()}
            title="最小化"
            type="button"
          >
            <Icon name="minimize" size={14} />
          </Button>
          <Button variant="unstyled"
            aria-label="最大化或还原"
            className="window-button"
            onClick={() =>
              void window.gitnest.window.toggleMaximize()
            }
            title="最大化或还原"
            type="button"
          >
            <Icon name="maximize" size={13} />
          </Button>
          <Button variant="unstyled"
            aria-label="关闭"
            className="window-button window-button-close"
            onClick={() => void window.gitnest.window.close()}
            title="关闭"
            type="button"
          >
            <Icon name="close" size={14} />
          </Button>
        </div>
      </header>

      {showChangesSkeleton ? (
        <DiffWorkspaceSkeleton
          className="diff-viewer-workspace"
          label="正在读取工作区变更"
        />
      ) : (
        <DiffWorkspace
        {...(changesMessage
          ? { changesError: changesMessage }
          : {})}
        canStageFile={(file) => canStageChange(file.change)}
        canUnstageFile={(file) =>
          canUnstageChange(file.change)
        }
        canDiscardFile={(file) => canDiscardChange(file.change)}
        changesLoading={changesLoading}
        className="diff-viewer-workspace"
        configuration={standaloneDiffWorkspaceConfiguration}
        externalApplications={externalApplications}
        fileView={appSettings.settings.diff.fileView}
        files={workspaceFiles}
        mutationBusy={mutations.active !== null}
        onRefresh={() =>
          setRefreshVersion((version) => version + 1)
        }
        onFileViewChange={(fileView) =>
          void appSettings.update(
            { diff: { fileView } },
            { silent: true }
          )
        }
        onSelectedFileChange={(file) => {
          setDiffContextLines(DEFAULT_DIFF_CONTEXT_LINES);
          setSelectedKey(file.key);
        }}
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
        panelProps={{
          additions: diff?.additions,
          binary: diff?.binary,
          content: diff?.content,
          contextLines: diffContextLines,
          contextLoading: diffLoading,
          deletions: diff?.deletions,
          media: diff?.media,
          onContextRequest: requestDiffContext,
          onPathCopyStatusChange: setPathCopyStatus,
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
          preferredLayout: appSettings.settings.diff.layout,
          preferredWrap: appSettings.settings.diff.wrap,
          state: panelState,
          truncated: diff?.truncated
        }}
        selectedFileKey={selectedKey}
        treePreference={{
          initiallyCollapsed:
            appSettings.settings.diff
              .treeDirectoriesCollapsed,
          scopeKey: `${request.target.repositoryId}:${request.target.worktreeId}`,
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
        statusbar={
          <>
            <span>{language}</span>
            <span>UTF-8</span>
            <span>LF</span>
            <span className="diff-workspace-status-spacer" />
            <span>
              <kbd>Ctrl F</kbd> 搜索
            </span>
            <span>
              <kbd>Enter</kbd> 下一匹配
            </span>
            <span>
              <kbd>Esc</kbd> 关闭搜索
            </span>
          </>
        }
        />
      )}

      <ToastViewport>
        {pathCopyStatus === "copied" && selectedFile ? (
          <Toast
            message={`已复制文件路径：${selectedFile.path}`}
            onClose={() => setPathCopyStatus("idle")}
            title="已复制"
            tone="success"
          />
        ) : null}
        {pathCopyStatus === "failed" ? (
          <Toast
            message="无法写入剪贴板，请重试。"
            onClose={() => setPathCopyStatus("idle")}
            title="复制失败"
            tone="error"
          />
        ) : null}
        {changesError && files.length > 1 ? (
          <Toast
            message={changesError.message}
            onClose={() => setChangesError(null)}
            title="变更列表刷新失败"
            tone="error"
          />
        ) : null}
        {mutations.notice ? (
          <Toast
            message={mutations.notice}
            onClose={mutations.clearFeedback}
            title="操作完成"
            tone="success"
          />
        ) : null}
        {mutations.error ? (
          <Toast
            message={mutations.error.message}
            onClose={mutations.clearFeedback}
            title="Git 操作失败"
            tone="error"
          />
        ) : null}
        {externalApplications.error ? (
          <Toast
            message={externalApplications.error.message}
            onClose={externalApplications.clearError}
            title="无法打开本地应用"
            tone="error"
          />
        ) : null}
      </ToastViewport>
    </div>
  );
}

function InvalidDiffViewer() {
  return (
    <div className="diff-viewer-app invalid">
      <header className="diff-viewer-titlebar">
        <div className="diff-viewer-brand">
          <span className="brand-mark">
            <Icon name="fileCode" size={15} />
          </span>
          <strong>GitNest Diff</strong>
        </div>
        <div className="titlebar-drag-region" />
        <div className="titlebar-actions">
          <Button variant="unstyled"
            aria-label="关闭"
            className="window-button window-button-close"
            onClick={() => void window.gitnest.window.close()}
            title="关闭"
            type="button"
          >
            <Icon name="close" size={14} />
          </Button>
        </div>
      </header>
      <DiffViewerState
        icon="warning"
        message="窗口参数不完整，请从 Changes 页重新打开。"
        title="无法打开 Diff"
      />
    </div>
  );
}

function parseDiffViewerRequest(
  search: string
): OpenDiffViewerRequest | null {
  const params = new URLSearchParams(search);
  const repositoryId = params.get("repositoryId");
  const worktreeId = params.get("worktreeId");
  const path = params.get("path");
  const mode = params.get("mode");
  if (
    !repositoryId ||
    !worktreeId ||
    !path ||
    !isDiffViewerMode(mode)
  ) {
    return null;
  }

  return {
    target: { repositoryId, worktreeId },
    path,
    mode
  };
}

function isDiffViewerMode(
  value: string | null
): value is DiffViewerMode {
  return (
    value === "staged" ||
    value === "unstaged" ||
    value === "untracked"
  );
}

function nextQueryId(prefix: string): string {
  querySequence += 1;
  return `${prefix}_${Date.now()}_${querySequence}`;
}

function fileKey(path: string, mode: DiffViewerMode): string {
  return `${mode}\u0001${path}`;
}

function fileName(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? path;
}

function languageLabel(path: string): string {
  const name = fileName(path);
  const extension = name
    .split(".")
    .at(-1)
    ?.toLocaleLowerCase();
  if (!extension || extension === name.toLocaleLowerCase()) {
    return "Plain Text";
  }

  return (
    {
      c: "C",
      cc: "C++",
      cpp: "C++",
      cs: "C#",
      css: "CSS",
      go: "Go",
      h: "C/C++ Header",
      html: "HTML",
      java: "Java",
      js: "JavaScript",
      json: "JSON",
      jsx: "JavaScript React",
      md: "Markdown",
      ps1: "PowerShell",
      py: "Python",
      rs: "Rust",
      sh: "Shell",
      ts: "TypeScript",
      tsx: "TypeScript React",
      xml: "XML",
      yaml: "YAML",
      yml: "YAML"
    }[extension] ?? extension.toLocaleUpperCase()
  );
}

function unexpectedError(reason: unknown): GitReadErrorDto {
  return {
    code: "COMMAND_FAILED",
    message:
      reason instanceof Error
        ? reason.message
        : "发生了未预期的读取错误。",
    details: {}
  };
}
