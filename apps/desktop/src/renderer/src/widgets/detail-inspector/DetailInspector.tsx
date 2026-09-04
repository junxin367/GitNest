import {
  useEffect,
  useState,
  type FormEvent
} from "react";

import type {
  AccountOverviewDto,
  GitEnvironmentDto,
  GitReadErrorDto,
  RepositoryStatusSnapshotDto,
  RuntimeInfo,
  UpdateWorkspaceEntryRequest,
  WorkspaceDetailsDto,
  WorkspaceMonitorStateDto,
  WorkspaceOperationDto
} from "@gitnest/contracts";

import {
  WORKSPACE_ENTRY_LABELS,
  findTargetSnapshot,
  getEntryRepositoryCount,
  getSnapshotChangeCount,
  resolveWorkspaceTarget
} from "../../entities/workspace/model";
import { Icon } from "../../shared/ui/Icon";

interface DetailInspectorProps {
  accountOverview: AccountOverviewDto | null;
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
  onUpdateEntry(
    request: UpdateWorkspaceEntryRequest
  ): Promise<void>;
}

export function DetailInspector({
  accountOverview,
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
  onUpdateEntry
}: DetailInspectorProps) {
  const selectedEntry = workspace?.entries.find(
    (entry) => entry.id === workspace.selectedEntryId
  );
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
  const [displayName, setDisplayName] = useState("");
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

  useEffect(() => {
    setDisplayName(selectedEntry?.displayName ?? "");
  }, [selectedEntry?.displayName, selectedEntry?.id]);

  const saveDisplayName = (event: FormEvent) => {
    event.preventDefault();

    if (selectedEntry && displayName.trim()) {
      void onUpdateEntry({
        entryId: selectedEntry.id,
        displayName
      });
    }
  };

  return (
    <aside className="inspector">
      <header className="inspector-head">
        <div className="inspector-title">
          <Icon name="panel" />
          上下文详情
        </div>
        <button
          aria-label="折叠详情面板"
          className="icon-button"
          onClick={onClose}
          type="button"
        >
          <Icon name="close" />
        </button>
      </header>

      <section className="inspector-section">
        <div className="inspector-section-title">
          <span>当前仓库</span>
          <span
            className={`status-pill ${
              selectedSnapshot?.error
                ? "yellow"
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
              repositoryAccount ? "blue" : "green"
            }`}
          >
            {repositoryAccount ? "仓库覆盖" : "系统 Git"}
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
        <button
          className="button inspector-settings-button"
          onClick={onOpenSettings}
          type="button"
        >
          <Icon name="settings" />
          管理账号
        </button>
      </section>

      <section className="inspector-section">
        <div className="inspector-section-title">
          <span>当前顶层条目</span>
          {selectedEntry && (
            <span className="status-pill blue">
              {WORKSPACE_ENTRY_LABELS[selectedEntry.kind]}
            </span>
          )}
        </div>
        {selectedEntry ? (
          <>
            <dl className="detail-list">
              <DetailRow
                label="路径"
                value={selectedEntry.path}
              />
              <DetailRow
                label="仓库"
                value={`${getEntryRepositoryCount(selectedEntry)} 个`}
              />
              <DetailRow
                label="分组"
                value={`${selectedEntry.groups.length} 个`}
              />
              <DetailRow
                label="扫描问题"
                value={`${selectedEntry.scanIssues.length} 个`}
              />
            </dl>
            <form
              className="entry-settings-form"
              onSubmit={saveDisplayName}
            >
              <label htmlFor="entry-display-name">显示名称</label>
              <div>
                <input
                  id="entry-display-name"
                  maxLength={120}
                  onChange={(event) =>
                    setDisplayName(event.target.value)
                  }
                  value={displayName}
                />
                <button
                  className="button"
                  disabled={
                    busy ||
                    !displayName.trim() ||
                    displayName.trim() ===
                      selectedEntry.displayName
                  }
                  type="submit"
                >
                  保存
                </button>
              </div>
            </form>
            <div className="entry-order-actions">
              <button
                className="button"
                disabled={busy || selectedEntry.order === 0}
                onClick={() =>
                  void onUpdateEntry({
                    entryId: selectedEntry.id,
                    order: selectedEntry.order - 1
                  })
                }
                type="button"
              >
                上移
              </button>
              <button
                className="button"
                disabled={
                  busy ||
                  selectedEntry.order ===
                    (workspace?.entries.length ?? 1) - 1
                }
                onClick={() =>
                  void onUpdateEntry({
                    entryId: selectedEntry.id,
                    order: selectedEntry.order + 1
                  })
                }
                type="button"
              >
                下移
              </button>
            </div>
          </>
        ) : (
          <div className="inspector-empty">
            添加或选择顶层条目后，可在这里修改显示名称和顺序。
          </div>
        )}
      </section>

      <section className="inspector-section">
        <div className="inspector-section-title">
          <span>运行状态</span>
          <span
            className={`status-pill ${
              monitor?.mode === "polling" ? "yellow" : "green"
            }`}
          >
            {monitor?.mode === "polling"
              ? "轮询"
              : operations.some(
                    (item) =>
                      item.state === "queued" ||
                      item.state === "running" ||
                      item.state === "cancelling"
                  )
                ? "刷新中"
                : "已连接"}
          </span>
        </div>
        <div className="runtime-hero">
          <span className="runtime-hero-icon">
            <Icon name="check" size={22} />
          </span>
          <div>
            <strong>安全壳层已启动</strong>
            <p>Renderer 通过白名单 Bridge 获取运行时元数据。</p>
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
              gitError ? "yellow" : "green"
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
        <div className="inspector-section-title">安全边界</div>
        <div className="inspector-note">
          <Icon name="warning" size={15} />
          <p>
            Node Integration 已关闭；窗口导航和新窗口默认拒绝；IPC
            请求验证发送来源。
          </p>
        </div>
      </section>

      <section className="inspector-section">
        <div className="inspector-section-title">研发进度</div>
        <div className="next-list">
          <span>
            <strong>M1</strong>
            Workspace、状态刷新与安全壳层
          </span>
          <span>
            <strong>GN-M2-01</strong>
            仓库只读详情
          </span>
          <span>
            <strong>GN-M2-02</strong>
            Stage、Unstage 与 Commit
          </span>
          <span>
            <strong>GN-M2-03</strong>
            Fetch、Pull、Push 与分支
          </span>
          <span>
            <strong>GN-M2-04</strong>
            账号、外部终端与完整操作中心
          </span>
          <span>
            <strong>GN-M3-01</strong>
            Worktree 安全管理
          </span>
          <span>
            <strong>GN-M3-02</strong>
            恢复、迁移与诊断
          </span>
          <span>
            <strong>GN-M3-03</strong>
            Windows 安装与便携交付（已验收）
          </span>
          <span>
            <strong>RC-H1</strong>
            正确性与回归硬化（已通过）
          </span>
          <span>
            <strong>RC-H2</strong>
            安全性与韧性硬化（已通过）
          </span>
          <span>
            <strong>RC-H3</strong>
            UX 与性能硬化（已通过）
          </span>
          <span>
            <strong>1.0.0</strong>
            首个正式版本候选
          </span>
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
      <dd>{value}</dd>
    </div>
  );
}
