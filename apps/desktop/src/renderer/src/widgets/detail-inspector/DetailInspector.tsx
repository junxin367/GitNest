import { Button } from "../../shared/ui/Button";
import {
  useEffect,
  useState,
  type FormEvent
} from "react";

import type {
  AccountOverviewDto,
  GitEnvironmentDto,
  GitReadErrorDto,
  RepositoryCommitDto,
  RepositoryStatusSnapshotDto,
  RuntimeInfo,
  WorkspaceDetailsDto,
  WorkspaceMonitorStateDto,
  WorkspaceOperationDto
} from "@gitnest/contracts";

import {
  findTargetSnapshot,
  getSnapshotChangeCount,
  resolveWorkspaceTarget
} from "../../entities/workspace/model";
import { copyTextToClipboard } from "../../shared/lib/copyTextToClipboard";
import { formatCommitTimestamp } from "../../shared/lib/formatCommitTimestamp";
import { Icon } from "../../shared/ui/Icon";
import { Input } from "../../shared/ui/Input";

interface DetailInspectorProps {
  accountOverview: AccountOverviewDto | null;
  commit: RepositoryCommitDto["commit"] | null;
  gitEnvironment: GitEnvironmentDto | null;
  gitError: GitReadErrorDto | null;
  runtimeInfo: RuntimeInfo | null;
  workspace: WorkspaceDetailsDto | null;
  snapshots: RepositoryStatusSnapshotDto[];
  operations: WorkspaceOperationDto[];
  monitor: WorkspaceMonitorStateDto | null;
  busy: boolean;
  onClose(): void;
  onOpenSettings(): void;
  onRenameWorkspace(
    workspaceId: string,
    name: string
  ): Promise<boolean>;
}

export function DetailInspector({
  accountOverview,
  commit,
  gitEnvironment,
  gitError,
  runtimeInfo,
  workspace,
  snapshots,
  operations,
  monitor,
  busy,
  onClose,
  onOpenSettings,
  onRenameWorkspace
}: DetailInspectorProps) {
  const selectedRepository =
    workspace?.selectedTarget && workspace
      ? resolveWorkspaceTarget(
          workspace,
          workspace.selectedTarget
        )
      : undefined;
  const selectedSnapshot = findTargetSnapshot(
    snapshots,
    workspace?.selectedTarget
  );
  const [workspaceName, setWorkspaceName] = useState("");
  const [commitNotice, setCommitNotice] = useState<string | null>(
    null
  );
  const repositoryAccountBinding =
    workspace?.selectedTarget
      ? accountOverview?.bindings.find(
          (binding) =>
            binding.repositoryId ===
            workspace.selectedTarget?.repositoryId
        )
      : undefined;
  const repositoryAccount =
    repositoryAccountBinding
      ? accountOverview?.accounts.find(
          (account) =>
            account.id ===
            repositoryAccountBinding.accountId
        )
      : undefined;
  const operationActive = operations.some(
    (item) =>
      item.state === "queued" ||
      item.state === "running" ||
      item.state === "cancelling"
  );
  const monitorTone =
    monitor?.mode === "polling"
      ? "yellow"
      : operationActive
        ? "blue"
        : monitor?.mode === "watching"
          ? "green"
          : "neutral";
  const monitorLabel =
    monitor?.mode === "polling"
      ? "轮询"
      : operationActive
        ? "刷新中"
        : monitor?.mode === "watching"
          ? "已连接"
          : "初始化";

  useEffect(() => {
    setWorkspaceName(workspace?.name ?? "");
  }, [workspace?.id, workspace?.name]);

  useEffect(() => {
    setCommitNotice(null);
  }, [commit?.hash]);

  const saveWorkspaceName = (event: FormEvent) => {
    event.preventDefault();
    const name = workspaceName.trim();

    if (workspace && name) {
      void onRenameWorkspace(workspace.id, name);
    }
  };

  if (commit) {
    const commitRefs = commit.refs ?? [];
    return (
      <aside className="inspector commit-inspector">
        <header className="inspector-head">
          <div className="inspector-title">
            <Icon name="commit" />
            提交详情
          </div>
          <Button variant="unstyled"
            aria-label="折叠详情面板"
            className="icon-button"
            onClick={onClose}
            title="折叠详情面板"
            type="button"
          >
            <Icon name="close" />
          </Button>
        </header>

        <section className="inspector-section history-commit-summary">
          <h2 className="selected-commit-title">
            {commit.subject}
          </h2>
          <div className="commit-detail-meta">
            <span>{commit.authorName}</span>
            <code>{commit.hash}</code>
            <span>
              {formatCommitTimestamp(commit.authoredAt)}
            </span>
          </div>
          {commitRefs.length > 0 && (
            <div className="commit-refs">
              {commitRefs.map((ref) => (
                <span key={ref}>{ref}</span>
              ))}
            </div>
          )}
          <p className="selected-commit-body">
            {commit.body}
          </p>
        </section>

        <section className="inspector-section">
          <div className="inspector-section-title">
            提交信息
          </div>
          <dl className="detail-list commit-detail-list">
            <DetailRow
              label="Commit"
              value={commit.hash}
            />
            <DetailRow
              label="分支"
              value={commitRefs.join(", ") || "—"}
            />
            <DetailRow
              label="作者"
              value={commit.authorName}
            />
            <DetailRow
              label="提交时间"
              value={formatCommitTimestamp(commit.authoredAt)}
            />
          </dl>
        </section>

        <section className="inspector-section">
          <div className="inspector-section-title">
            采集范围
          </div>
          <p className="selected-commit-body">
            当前页面展示提交的哈希、主题、作者、时间和变更文件统计。
          </p>
        </section>

        <section className="inspector-section">
          <div className="inspector-section-title">
            快捷操作
          </div>
          <div className="quick-grid">
            <Button variant="unstyled"
              className="quick-button"
              onClick={() => {
                void copyTextToClipboard(commit.hash)
                  .then(() =>
                    setCommitNotice("Commit ID 已复制。")
                  )
                  .catch(() =>
                    setCommitNotice(
                      "当前环境不允许访问剪贴板，请手动复制。"
                    )
                  );
              }}
              type="button"
            >
              <Icon name="copy" />
              复制 ID
            </Button>
            <Button variant="unstyled"
              className="quick-button"
              onClick={() =>
                setCommitNotice(
                  "远程查看暂未接入，当前仅展示本地提交快照。"
                )
              }
              type="button"
            >
              <Icon name="external" />
              远程查看
            </Button>
            <Button variant="unstyled"
              className="quick-button"
              onClick={() =>
                setCommitNotice(
                  "Cherry-pick 暂未接入，当前不会修改仓库。"
                )
              }
              type="button"
            >
              <Icon name="commit" />
              Cherry-pick
            </Button>
            <Button variant="unstyled"
              className="quick-button"
              onClick={() =>
                setCommitNotice(
                  "创建分支入口已保留，请从分支页面选择提交起点。"
                )
              }
              type="button"
            >
              <Icon name="branch" />
              创建分支
            </Button>
          </div>
          {commitNotice && (
            <div className="inspector-note commit-action-notice">
              <Icon name="activity" size={15} />
              <p>{commitNotice}</p>
            </div>
          )}
        </section>
      </aside>
    );
  }

  return (
    <aside className="inspector">
      <header className="inspector-head">
        <div className="inspector-title">
          <Icon name="panel" />
          上下文详情
        </div>
        <Button variant="unstyled"
          aria-label="折叠详情面板"
          className="icon-button"
          onClick={onClose}
          title="折叠详情面板"
          type="button"
        >
          <Icon name="close" />
        </Button>
      </header>

      <section className="inspector-section">
        <div className="inspector-section-title">
          <span>当前仓库</span>
          <span
            className={`status-pill ${
              selectedSnapshot?.error
                ? "red"
                : selectedSnapshot?.refreshPending ||
                    selectedSnapshot?.stale
                  ? "blue"
                  : selectedSnapshot
                    ? "green"
                    : "neutral"
            }`}
          >
            {selectedSnapshot?.error
              ? "读取失败"
              : selectedSnapshot?.refreshPending
                ? "刷新中"
                : selectedSnapshot?.stale
                  ? "缓存"
                  : selectedSnapshot
                    ? "已刷新"
                    : "未选择"}
          </span>
        </div>
        {selectedRepository?.worktree ? (
          <>
            <div className="selected-repository-hero">
              <span className="runtime-hero-icon">
                <Icon name="repository" size={20} />
              </span>
              <div>
                <strong>{selectedRepository.worktree.name}</strong>
                <p title={selectedRepository.worktree.path}>
                  {selectedRepository.worktree.path}
                </p>
              </div>
            </div>
            <dl className="detail-list repository-snapshot-details">
              <DetailRow
                label="分支"
                value={
                  selectedSnapshot?.branch ??
                  selectedRepository.worktree.branch ??
                  "detached"
                }
              />
              <DetailRow
                label="变更"
                value={`${getSnapshotChangeCount(selectedSnapshot)} 个`}
              />
              <DetailRow
                label="同步"
                value={
                  selectedSnapshot?.upstream
                    ? `↑${selectedSnapshot.ahead} ↓${selectedSnapshot.behind}`
                    : "无上游"
                }
              />
              <DetailRow
                label="更新时间"
                value={
                  selectedSnapshot?.refreshedAt
                    ? new Date(
                        selectedSnapshot.refreshedAt
                      ).toLocaleTimeString()
                    : "等待刷新"
                }
              />
            </dl>
            {selectedSnapshot?.error && (
              <div className="inspector-note">
                <Icon name="warning" size={15} />
                <p>{selectedSnapshot.error.message}</p>
              </div>
            )}
          </>
        ) : (
          <div className="inspector-empty">
            从侧栏或仓库状态表选择一个仓库。
          </div>
        )}
      </section>

      <section className="inspector-section">
        <div className="inspector-section-title">
          <span>认证来源</span>
          <span
            className={`status-pill ${
              repositoryAccount ? "blue" : "neutral"
            }`}
          >
            {repositoryAccount ? "仓库覆盖" : "继承默认"}
          </span>
        </div>
        <div className="inspector-note authentication-source">
          <Icon
            name={
              repositoryAccount?.authType === "system-ssh"
                ? "terminal"
                : "repository"
            }
            size={15}
          />
          <p>
            {repositoryAccount
              ? `${repositoryAccount.host} · ${
                  repositoryAccount.username ??
                  (repositoryAccount.authType === "system-ssh"
                    ? "系统 SSH"
                    : "HTTPS Token")
                }`
              : "当前仓库未设置显式覆盖；远程操作使用主机默认 GitNest 账号或系统 Credential Helper / SSH。"}
          </p>
        </div>
        <Button size="small"
          className="inspector-settings-button"
          fullWidth
          onClick={onOpenSettings}
          type="button"
        >
          <Icon name="settings" />
          管理账号
        </Button>
      </section>

      <section className="inspector-section">
        <div className="inspector-section-title">
          <span>Workspace 详情</span>
          {workspace && (
            <span className="status-pill blue">
              Schema v{workspace.schemaVersion}
            </span>
          )}
        </div>
        {workspace ? (
          <>
            <dl className="detail-list">
              <DetailRow
                label="根目录"
                value={workspace.path ?? "尚未设置"}
              />
              <DetailRow
                label="仓库"
                value={`${workspace.repositories.length} 个`}
              />
              <DetailRow
                label="Worktrees"
                value={`${workspace.worktrees.length} 个`}
              />
              <DetailRow
                label="分组"
                value={`${workspace.groups.length} 个`}
              />
              <DetailRow
                label="扫描问题"
                value={`${workspace.scanIssues.length} 个`}
              />
              <DetailRow
                label="最近扫描"
                value={
                  workspace.lastScannedAt
                    ? new Date(
                        workspace.lastScannedAt
                      ).toLocaleString()
                    : "尚未扫描"
                }
              />
            </dl>
            <form
              className="workspace-settings-form"
              onSubmit={saveWorkspaceName}
            >
              <label htmlFor="workspace-display-name">
                Workspace 名称
              </label>
              <div>
                <Input
                  fieldClassName="workspace-settings-input"
                  fullWidth
                  id="workspace-display-name"
                  maxLength={120}
                  onChange={(event) =>
                    setWorkspaceName(event.target.value)
                  }
                  size="small"
                  value={workspaceName}
                />
                <Button size="small"
                  disabled={
                    busy ||
                    !workspaceName.trim() ||
                    workspaceName.trim() === workspace.name
                  }
                  type="submit"
                >
                  保存
                </Button>
              </div>
            </form>
          </>
        ) : (
          <div className="inspector-empty">
            创建 Workspace 后，可在这里查看根目录与扫描摘要。
          </div>
        )}
      </section>

      <section className="inspector-section">
        <div className="inspector-section-title">
          <span>运行状态</span>
          <span
            className={`status-pill ${monitorTone}`}
          >
            {monitorLabel}
          </span>
        </div>
        <div className="runtime-hero">
          <span className="runtime-hero-icon">
            <Icon name="check" size={22} />
          </span>
          <div>
            <strong>本地服务已连接</strong>
            <p>应用可以安全读取 Workspace 与 Git 状态。</p>
          </div>
        </div>
      </section>

      <section className="inspector-section">
        <div className="inspector-section-title">运行时</div>
        <dl className="detail-list">
          <DetailRow
            label="应用"
            value={runtimeInfo?.appVersion ?? "连接中…"}
          />
          <DetailRow
            label="Electron"
            value={runtimeInfo?.electronVersion ?? "—"}
          />
          <DetailRow
            label="Chromium"
            value={runtimeInfo?.chromeVersion ?? "—"}
          />
          <DetailRow
            label="Node.js"
            value={runtimeInfo?.nodeVersion ?? "—"}
          />
          <DetailRow
            label="平台"
            value={runtimeInfo?.platform ?? "—"}
          />
        </dl>
      </section>

      <section className="inspector-section">
        <div className="inspector-section-title">
          <span>Git for Windows</span>
          <span
            className={`status-pill ${
              gitError ? "red" : "green"
            }`}
          >
            {gitError ? "不可用" : "已检测"}
          </span>
        </div>
        {gitError ? (
          <div className="inspector-note">
            <Icon name="warning" size={15} />
            <p>{gitError.message}</p>
          </div>
        ) : (
          <dl className="detail-list">
            <DetailRow
              label="版本"
              value={gitEnvironment?.version ?? "检测中…"}
            />
            <DetailRow
              label="可执行文件"
              value={gitEnvironment?.executablePath ?? "—"}
            />
            <DetailRow
              label="Git LFS"
              value={
                gitEnvironment
                  ? gitEnvironment.lfs.available
                    ? gitEnvironment.lfs.version ?? "可用"
                    : "未安装"
                  : "—"
              }
            />
            <DetailRow
              label="凭据助手"
              value={
                gitEnvironment
                  ? `${gitEnvironment.credentialHelpers.length} 个`
                  : "—"
              }
            />
            <DetailRow
              label="SSH"
              value={
                gitEnvironment
                  ? gitEnvironment.ssh.configExists
                    ? "检测到 config"
                    : gitEnvironment.ssh.command
                  : "—"
              }
            />
          </dl>
        )}
      </section>

      <section className="inspector-section">
        <div className="inspector-section-title">安全保护</div>
        <div className="inspector-note">
          <Icon name="warning" size={15} />
          <p>
            页面无法直接访问 Node.js；外部导航、新窗口和未授权请求会被应用阻止。
          </p>
        </div>
      </section>
    </aside>
  );
}

function DetailRow({
  label,
  value
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="detail-row">
      <dt>{label}</dt>
      <dd title={value}>{value}</dd>
    </div>
  );
}
