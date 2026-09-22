import type {
  GitEnvironmentDto,
  GitReadErrorDto,
  RepositoryStatusSnapshotDto,
  WorkspaceMonitorStateDto,
  WorkspaceOperationDto,
  WorkspaceDetailsDto
} from "@gitnest/contracts";

import { Icon } from "../../shared/ui/Icon";

interface StatusBarProps {
  cleanupWarning?: string | null;
  gitEnvironment: GitEnvironmentDto | null;
  gitError: GitReadErrorDto | null;
  workspace: WorkspaceDetailsDto | null;
  snapshots: RepositoryStatusSnapshotDto[];
  operations: WorkspaceOperationDto[];
  monitor: WorkspaceMonitorStateDto | null;
  operation:
    | "loading"
    | "selecting"
    | "scanning"
    | "switching"
    | "saving"
    | null;
}

export function StatusBar({
  cleanupWarning,
  gitEnvironment,
  gitError,
  workspace,
  snapshots,
  operations,
  monitor,
  operation
}: StatusBarProps) {
  const activeOperations = operations.filter(
    (item) =>
      item.state === "queued" ||
      item.state === "running" ||
      item.state === "cancelling"
  ).length;
  const changedRepositories = snapshots.filter(
    (snapshot) =>
      snapshot.staged +
        snapshot.unstaged +
        snapshot.untracked +
        snapshot.conflicted >
      0
  ).length;

  return (
    <footer className="status-bar">
      <span>
        <Icon name="check" size={12} />
        GitNest 已就绪
      </span>
      <span className={gitError ? "status-error" : ""}>
        <Icon
          name={gitError ? "warning" : "repository"}
          size={12}
        />
        {gitError
          ? "Git 不可用"
          : gitEnvironment
            ? `Git ${gitEnvironment.version}`
            : "正在检测 Git…"}
      </span>
      <span>
        <Icon
          name={operation === "scanning" ? "refresh" : "layers"}
          size={12}
        />
        {operation === "switching"
          ? "正在切换 Workspace…"
          : operation === "scanning"
            ? "正在扫描 Workspace…"
          : workspace
            ? `${workspace.repositories.length} 个仓库 · ${workspace.worktrees.length} 个 Worktree · ${changedRepositories} 个有变更`
            : "正在恢复 Workspace…"}
      </span>
      <span
        className={
          monitor?.mode === "polling" ? "status-error" : ""
        }
      >
        <Icon
          name={
            monitor?.mode === "polling" ? "warning" : "activity"
          }
          size={12}
        />
        {activeOperations > 0
          ? `${activeOperations} 个后台操作`
          : monitor?.mode === "watching"
            ? "文件监听中"
            : monitor?.mode === "polling"
              ? "低频轮询"
              : "监听未启动"}
      </span>
      <span className="status-bar-spacer" />
      {cleanupWarning && (
        <span className="status-error" title={cleanupWarning} role="status">
          <Icon name="warning" size={12} />
          Workspace 清理未完成
        </span>
      )}
      <span>v0.0.1</span>
    </footer>
  );
}
