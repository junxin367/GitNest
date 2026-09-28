import {
  useEffect,
  useRef
} from "react";

import {
  GITNEST_PROJECT_URL,
  type ApplicationUpdateStateDto
} from "@gitnest/contracts";

import { Button } from "../../shared/ui/Button";
import { Dialog } from "../../shared/ui/Dialog";
import { Icon } from "../../shared/ui/Icon";

interface VersionDialogProps {
  state: ApplicationUpdateStateDto | null;
  fallbackVersion: string;
  onAcknowledgePrompt(version: string): void;
  onCheck(): void;
  onClose(): void;
  onDownloadAndInstall(): void;
  onOpenProjectPage(): void;
  onOpenReleasePage(): void;
}

export function VersionDialog({
  state,
  fallbackVersion,
  onAcknowledgePrompt,
  onCheck,
  onClose,
  onDownloadAndInstall,
  onOpenProjectPage,
  onOpenReleasePage
}: VersionDialogProps) {
  const acknowledgedVersionRef = useRef<string | null>(
    null
  );

  const busy =
    state?.phase === "checking" ||
    state?.phase === "downloading" ||
    state?.phase === "verifying" ||
    state?.phase === "launching";
  const currentVersion =
    state?.currentVersion ?? fallbackVersion;
  const progress =
    state?.totalBytes && state.totalBytes > 0
      ? Math.min(
          100,
          Math.round(
            (state.downloadedBytes /
              state.totalBytes) *
              100
          )
        )
      : 0;
  const releaseNotes = releaseNotesText(state);

  useEffect(() => {
    const version =
      state?.promptPending &&
      state.latestVersion
        ? state.latestVersion
        : null;
    if (
      version &&
      acknowledgedVersionRef.current !== version
    ) {
      acknowledgedVersionRef.current = version;
      onAcknowledgePrompt(version);
    }
  }, [
    onAcknowledgePrompt,
    state?.latestVersion,
    state?.promptPending
  ]);

  return (
    <Dialog
      bodyClassName="version-dialog-body"
      footer={
        <>
          <Button
            data-modal-initial-focus="true"
            onClick={onClose}
            size="small"
          >
            关闭
          </Button>
          {renderPrimaryAction({
            state,
            busy,
            onCheck,
            onDownloadAndInstall,
            onOpenReleasePage
          })}
        </>
      }
      icon="sparkle"
      onDismiss={onClose}
      size="information"
      title={`版本 v${currentVersion}`}
    >
      <dl className="version-dialog-facts">
        <div>
          <dt>当前版本</dt>
          <dd>v{currentVersion}</dd>
        </div>
        <div>
          <dt>最新版本</dt>
          <dd>
            {state?.latestVersion
              ? `v${state.latestVersion}`
              : "尚未检查"}
          </dd>
        </div>
        <div>
          <dt>运行方式</dt>
          <dd>
            {distributionLabel(state?.distribution)}
          </dd>
        </div>
        <div>
          <dt>检查时间</dt>
          <dd>{formatCheckedAt(state?.checkedAt)}</dd>
        </div>
      </dl>

      <section
        aria-labelledby="version-dialog-project-title"
        className="version-dialog-information"
      >
        <div className="version-dialog-section-heading">
          <div>
            <Icon name="repository" size={16} />
            <h3 id="version-dialog-project-title">
              项目信息
            </h3>
          </div>
          <Button
            aria-label="在浏览器中打开 GitNest 项目"
            icon={<Icon name="external" />}
            onClick={onOpenProjectPage}
            size="small"
          >
            打开项目
          </Button>
        </div>
        <div className="version-dialog-url">
          <span>项目 URL</span>
          <code title={GITNEST_PROJECT_URL}>
            {GITNEST_PROJECT_URL}
          </code>
        </div>
      </section>

      <section
        aria-labelledby="version-dialog-update-title"
        className="version-dialog-information version-dialog-update-information"
      >
        <div className="version-dialog-section-heading">
          <div>
            <Icon name="download" size={16} />
            <h3 id="version-dialog-update-title">
              更新信息
            </h3>
          </div>
          <Button
            aria-label="在浏览器中查看 GitNest Release"
            icon={<Icon name="external" />}
            onClick={onOpenReleasePage}
            size="small"
          >
            {state?.releaseUrl
              ? "查看 Release"
              : "打开 Releases"}
          </Button>
        </div>
        <dl className="version-dialog-update-meta">
          <div>
            <dt>目标版本</dt>
            <dd>
              {state?.latestVersion
                ? `v${state.latestVersion}`
                : "尚未获取"}
            </dd>
          </div>
          <div>
            <dt>发布时间</dt>
            <dd>
              {formatPublishedAt(state?.publishedAt)}
            </dd>
          </div>
        </dl>
        {(state?.phase === "downloading" ||
          state?.phase === "verifying") &&
          state.totalBytes !== null && (
            <div className="version-dialog-progress">
              <progress
                aria-label="更新下载进度"
                aria-valuetext={`${formatBytes(
                  state.downloadedBytes
                )} / ${formatBytes(
                  state.totalBytes
                )}，${progress}%`}
                max={state.totalBytes}
                value={state.downloadedBytes}
              />
              <span>
                {formatBytes(state.downloadedBytes)} /{" "}
                {formatBytes(state.totalBytes)} · {progress}%
              </span>
            </div>
          )}
        {releaseNotes && (
          <p
            aria-live="polite"
            className="version-dialog-update-notes"
          >
            {releaseNotes}
          </p>
        )}
      </section>
    </Dialog>
  );
}

function renderPrimaryAction({
  state,
  busy,
  onCheck,
  onDownloadAndInstall,
  onOpenReleasePage
}: {
  state: ApplicationUpdateStateDto | null;
  busy: boolean;
  onCheck(): void;
  onDownloadAndInstall(): void;
  onOpenReleasePage(): void;
}) {
  if (state?.updateAvailable) {
    if (state.installSupported) {
      return (
        <Button
          icon={<Icon name="download" />}
          loading={
            state.phase === "downloading" ||
            state.phase === "verifying" ||
            state.phase === "launching"
          }
          onClick={onDownloadAndInstall}
          size="small"
          variant="primary"
        >
          {state.phase === "launching"
            ? "正在启动安装器"
            : state.phase === "verifying"
              ? "正在校验"
              : state.phase === "downloading"
                ? "正在下载"
                : "下载并安装"}
        </Button>
      );
    }
    return (
      <Button
        icon={<Icon name="external" />}
        onClick={onOpenReleasePage}
        size="small"
        variant="primary"
      >
        打开 Release
      </Button>
    );
  }

  return (
    <Button
      icon={<Icon name="refresh" />}
      loading={state?.phase === "checking"}
      disabled={busy}
      onClick={onCheck}
      size="small"
      variant="primary"
    >
      {state?.phase === "checking"
        ? "正在检查"
        : "检查更新"}
    </Button>
  );
}

function distributionLabel(
  distribution:
    | ApplicationUpdateStateDto["distribution"]
    | undefined
): string {
  switch (distribution) {
    case "installed":
      return "安装版";
    case "portable":
      return "便携版";
    case "development":
      return "开发环境";
    default:
      return "正在识别";
  }
}

function formatCheckedAt(
  value: string | null | undefined
): string {
  if (!value) {
    return "尚未检查";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "未知"
    : date.toLocaleString("zh-CN");
}

function formatPublishedAt(
  value: string | null | undefined
): string {
  if (!value) {
    return "尚未获取";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "未知"
    : date.toLocaleString("zh-CN");
}

function releaseNotesText(
  state: ApplicationUpdateStateDto | null
): string | null {
  if (state?.errorMessage) {
    return state.errorMessage;
  }
  const releaseNotes = state?.releaseNotes?.trim();
  if (releaseNotes) {
    return releaseNotes;
  }
  if (state?.phase === "checking") {
    return "正在读取最新正式版的发布时间和更新内容。";
  }
  if (state?.phase === "error") {
    return "本次未能获取更新信息，可重新检查后再试。";
  }
  if (state?.latestVersion) {
    return "该正式版本未提供更新说明。";
  }
  return null;
}

function formatBytes(value: number): string {
  if (value < 1_024) {
    return `${value} B`;
  }
  if (value < 1_024 * 1_024) {
    return `${(value / 1_024).toFixed(1)} KB`;
  }
  return `${(value / (1_024 * 1_024)).toFixed(1)} MB`;
}
