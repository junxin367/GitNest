import type {
  RepositoryStatusSnapshotDto,
  RepositoryTargetDto,
  WorkspaceDetailsDto,
  WorkspaceRepositoryDto,
  WorkspaceWorktreeDto
} from "@gitnest/contracts";
import { useState } from "react";

import type { WorkspaceTab } from "../../app/navigation";
import {
  findTargetSnapshot,
  getSnapshotChangeCount
} from "../../entities/workspace/model";
import { Icon } from "../../shared/ui/Icon";

type CollectionTab = Exclude<WorkspaceTab, "overview">;

interface WorkspaceCollectionPageProps {
  busy: boolean;
  snapshots: RepositoryStatusSnapshotDto[];
  tab: CollectionTab;
  workspace: WorkspaceDetailsDto | null;
  onAddDirectory(): void;
  onSelectTarget(target: RepositoryTargetDto): void;
}

interface WorkspaceRepositoryRow {
  repository: WorkspaceRepositoryDto;
  target: RepositoryTargetDto | undefined;
  worktree: WorkspaceWorktreeDto | undefined;
  snapshot: RepositoryStatusSnapshotDto | undefined;
}

export function WorkspaceCollectionPage({
  busy,
  snapshots,
  tab,
  workspace,
  onAddDirectory,
  onSelectTarget
}: WorkspaceCollectionPageProps) {
  if (!workspace) {
    return (
      <div className="page-scroll">
        <section className="page-heading">
          <div>
            <span className="eyebrow">多仓库工作区</span>
            <h1>Workspace</h1>
            <p>正在恢复 Workspace 数据。</p>
          </div>
        </section>
        <div className="repository-loading" role="status">
          <span className="empty-state-icon spinning">
            <Icon name="refresh" size={18} />
          </span>
          <span>正在读取 Workspace…</span>
        </div>
      </div>
    );
  }

  const repositoryRows = workspace.repositories
    .map((repository) =>
      createRepositoryRow(repository, workspace, snapshots)
    )
    .sort(compareRepositoryRows);

  if (tab === "repositories") {
    return (
      <div className="page-scroll workspace-collection-page">
        <WorkspacePageHeading
          title="仓库管理"
          description="统一查看实际仓库路径、当前分支、工作区状态与本地远程跟踪引用差异。"
        />
        <section className="panel">
          <header className="panel-header">
            <div className="panel-title">
              <Icon name="repository" />
              全部仓库
            </div>
            <span className="panel-caption">
              {workspace.repositories.length} 个仓库 ·{" "}
              {workspace.entries.length} 个配置项
            </span>
            <button
              className="panel-action"
              disabled={busy}
              onClick={onAddDirectory}
              type="button"
            >
              <Icon name="plus" size={13} />
              添加仓库
            </button>
          </header>
          {repositoryRows.length > 0 ? (
            <RepositoryTable
              rows={repositoryRows}
              onSelectTarget={onSelectTarget}
            />
          ) : (
            <WorkspaceEmptyState
              busy={busy}
              onAddDirectory={onAddDirectory}
            />
          )}
        </section>
      </div>
    );
  }

  if (tab === "activity") {
    return (
      <div className="page-scroll workspace-collection-page">
        <WorkspacePageHeading
          title="Workspace 活动"
          description="按本次只读快照汇总各仓库当前 HEAD、分支与远程同步状态。"
        />
        <WorkspaceActivityPanel
          busy={busy}
          onAddDirectory={onAddDirectory}
          onSelectTarget={onSelectTarget}
          rows={repositoryRows}
        />
      </div>
    );
  }

  return (
    <div className="page-scroll workspace-collection-page">
      <WorkspacePageHeading
        title="跨仓 Worktrees"
        description={`聚合仓库实际登记 ${workspace.worktrees.length} 个 Worktree；其中 ${workspace.worktrees.filter((worktree) => worktree.isPrunable).length} 个记录指向不存在的目录。`}
      />
      {workspace.worktrees.length > 0 ? (
        <div className="worktree-grid">
          {workspace.worktrees.map((worktree) => {
            const target = {
              repositoryId: worktree.repositoryId,
              worktreeId: worktree.id
            };
            return (
              <WorkspaceWorktreeCard
                key={worktree.id}
                onSelect={() => onSelectTarget(target)}
                worktree={worktree}
              />
            );
          })}
        </div>
      ) : (
        <section className="panel">
          <WorkspaceEmptyState
            busy={busy}
            onAddDirectory={onAddDirectory}
          />
        </section>
      )}
    </div>
  );
}

function WorkspacePageHeading({
  title,
  description
}: {
  title: string;
  description: string;
}) {
  return (
    <section className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </section>
  );
}

function WorkspaceActivityPanel({
  busy,
  onAddDirectory,
  onSelectTarget,
  rows
}: {
  busy: boolean;
  onAddDirectory(): void;
  onSelectTarget(target: RepositoryTargetDto): void;
  rows: WorkspaceRepositoryRow[];
}) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const normalizedFilter = filterQuery.trim().toLocaleLowerCase();
  const activityRows = [...rows].sort(compareActivityRows);
  const visibleRows = normalizedFilter
    ? activityRows.filter((row) =>
        workspaceActivitySearchValues(row).some((value) =>
          value.toLocaleLowerCase().includes(normalizedFilter)
        )
      )
    : activityRows;
  const snapshotAt = activityRows.find((row) => row.snapshot)?.snapshot
    ?.refreshedAt;
  const countLabel =
    visibleRows.length === activityRows.length
      ? `${activityRows.length} 条`
      : `${visibleRows.length}/${activityRows.length} 条`;

  return (
    <section className="panel">
      <header className="panel-header">
        <div className="panel-title">
          <Icon name="history" />
          最近 HEAD 提交
        </div>
        <span className="panel-caption">
          {countLabel}
          {snapshotAt
            ? ` · 快照 ${formatWorkspaceTimestamp(snapshotAt)}`
            : ""}
        </span>
        {filterOpen && (
          <input
            aria-label="筛选 Workspace 活动"
            autoFocus
            className="workspace-activity-filter-input"
            onChange={(event) => setFilterQuery(event.target.value)}
            placeholder="筛选仓库、分支或 Hash"
            value={filterQuery}
          />
        )}
        <button
          aria-expanded={filterOpen}
          className={`panel-action${
            filterOpen ? " workspace-activity-filter-open" : ""
          }`}
          onClick={() => setFilterOpen((open) => !open)}
          type="button"
        >
          <Icon name="filter" size={13} />
          筛选
        </button>
      </header>
      <div className="workspace-activity-list">
        {visibleRows.map((row, index) => {
          const name = row.worktree?.name ?? row.repository.name;
          const snapshot = row.snapshot;
          const time = snapshot
            ? formatWorkspaceTimestamp(snapshot.refreshedAt)
            : "—";
          const detail = snapshot
            ? `${shortHead(snapshot.head)} · ${workspaceActivityStatus(
                snapshot
              )}`
            : "等待状态刷新";

          return (
            <button
              aria-label={`${name} 的 HEAD 最近提交，${detail}，${time}`}
              className={`workspace-activity-row${
                index === visibleRows.length - 1 ? " last" : ""
              }`}
              disabled={!row.target}
              key={row.repository.id}
              onClick={() => {
                if (row.target) {
                  onSelectTarget(row.target);
                }
              }}
              type="button"
            >
              <span
                aria-hidden="true"
                className={`workspace-activity-marker ${repositoryTone(
                  snapshot
                )}`}
              >
                <Icon name="commit" size={12} />
              </span>
              <span className="workspace-activity-copy">
                <span className="workspace-activity-title">
                  <strong>{name}</strong> 的 HEAD 最近提交
                </span>
                <span className="workspace-activity-sub">
                  {snapshot ? (
                    <>
                      <code>{shortHead(snapshot.head)}</code>
                      {" · "}
                      {workspaceActivityStatus(snapshot)}
                    </>
                  ) : (
                    "等待状态刷新"
                  )}
                </span>
              </span>
              <time
                className="workspace-activity-meta"
                dateTime={snapshot?.refreshedAt}
              >
                {time}
              </time>
            </button>
          );
        })}
        {activityRows.length === 0 && (
          <WorkspaceEmptyState
            busy={busy}
            onAddDirectory={onAddDirectory}
          />
        )}
        {activityRows.length > 0 && visibleRows.length === 0 && (
          <div className="workspace-activity-filter-empty">
            没有匹配的 HEAD 快照
          </div>
        )}
      </div>
    </section>
  );
}

function RepositoryTable({
  rows,
  onSelectTarget
}: {
  rows: WorkspaceRepositoryRow[];
  onSelectTarget(target: RepositoryTargetDto): void;
}) {
  return (
    <div
      aria-label="Workspace 全部仓库"
      className="repository-status-table"
      role="list"
    >
      <div
        aria-hidden="true"
        className="repository-status-row repository-status-head"
      >
        <span>仓库</span>
        <span>分支</span>
        <span>工作区</span>
        <span>远程同步</span>
      </div>
      {rows.map((row) => {
        const name = row.worktree?.name ?? row.repository.name;
        const branch =
          row.snapshot?.branch ?? row.worktree?.branch ?? "detached";
        const state = workspaceStatusLabel(row.snapshot);
        const target = row.target;

        return (
          <div
            className="repository-status-item"
            key={row.repository.id}
            role="listitem"
          >
            <button
              aria-label={`${name}，分支 ${branch}，工作区 ${state}，同步 ${syncLabel(
                row.snapshot
              )}`}
              className={`repository-status-row${
                target ? "" : " disabled"
              }`}
              disabled={!target}
              onClick={() => {
                if (target) {
                  onSelectTarget(target);
                }
              }}
              type="button"
            >
              <span className="table-name">
                <span
                  className={`repository-state ${repositoryTone(
                    row.snapshot
                  )}`}
                >
                  <Icon name="repository" size={13} />
                </span>
                <span className="table-name-copy" title={name}>
                  {name}
                  <small
                    title={row.worktree?.path ?? "路径不可用"}
                  >
                    {row.worktree?.path ?? "路径不可用"}
                  </small>
                </span>
              </span>
              <span
                className="repository-status-branch"
                title={branch}
              >
                {branch}
              </span>
              <span>
                <span
                  className={`status-pill ${workspaceStatusTone(
                    row.snapshot
                  )}`}
                >
                  {state}
                </span>
              </span>
              <span
                className="repository-status-sync"
                title={syncLabel(row.snapshot)}
              >
                {syncLabel(row.snapshot)}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

function WorkspaceWorktreeCard({
  onSelect,
  worktree
}: {
  onSelect(): void;
  worktree: WorkspaceWorktreeDto;
}) {
  const statusTone = worktree.isPrunable
    ? "red"
    : worktree.isDetached
      ? "yellow"
      : worktree.isPrimary
        ? "green"
        : "neutral";
  const statusLabel = worktree.isPrunable
    ? "可清理记录"
    : worktree.isPrimary
        ? "主工作目录"
        : worktree.isDetached
          ? "Detached"
          : "已登记";
  const title = worktree.branch || "detached HEAD";
  const locationLabel = worktree.isPrunable ? "目录不存在" : "目录存在";
  const actionLabel = worktree.isPrunable ? "可 Prune" : "登记路径";

  return (
    <article
      aria-label={`${title}，${statusLabel}，提交 ${shortHead(
        worktree.head
      )}，${locationLabel}，${worktree.path}`}
      className={`worktree-card worktree-summary-card${
        worktree.isPrimary ? " primary" : ""
      }`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="worktree-card-head">
        <span className="worktree-symbol">
          <Icon name="worktree" size={20} />
        </span>
        <span className="worktree-card-head-copy">
          <span className="worktree-title" title={title}>
            {title}
          </span>
          <span className="worktree-branch">
            <Icon name="commit" size={11} />
            <span>{shortHead(worktree.head)}</span>
          </span>
        </span>
        <span className={`status-pill ${statusTone} worktree-card-status`}>
          {statusLabel}
        </span>
      </div>
      <div className="worktree-path" title={worktree.path}>
        {worktree.path}
      </div>
      <div className="worktree-foot">
        <span
          className={`worktree-location-status${
            worktree.isPrunable ? " missing" : ""
          }`}
        >
          {locationLabel}
        </span>
        <span className="spacer" />
        <span
          className={`worktree-foot-action${
            worktree.isPrunable ? " prune" : ""
          }`}
        >
          <Icon
            name={worktree.isPrunable ? "warning" : "external"}
            size={12}
          />
          {actionLabel}
        </span>
      </div>
    </article>
  );
}

function WorkspaceEmptyState({
  busy,
  onAddDirectory
}: {
  busy: boolean;
  onAddDirectory(): void;
}) {
  return (
    <div className="empty-state workspace-empty-state">
      <span className="empty-state-icon">
        <Icon name="folder" size={20} />
      </span>
      <div>
        <strong>尚未添加本地目录</strong>
        <p>使用目录选择器添加 Workspace 后，这里会显示对应内容。</p>
        <button
          className="button primary"
          disabled={busy}
          onClick={onAddDirectory}
          type="button"
        >
          <Icon name="plus" />
          添加目录
        </button>
      </div>
    </div>
  );
}

function createRepositoryRow(
  repository: WorkspaceRepositoryDto,
  workspace: WorkspaceDetailsDto,
  snapshots: RepositoryStatusSnapshotDto[]
): WorkspaceRepositoryRow {
  const worktree =
    repository.worktreeIds
      .map((worktreeId) =>
        workspace.worktrees.find(
          (candidate) => candidate.id === worktreeId
        )
      )
      .find((candidate) => candidate?.isPrimary) ??
    repository.worktreeIds
      .map((worktreeId) =>
        workspace.worktrees.find(
          (candidate) => candidate.id === worktreeId
        )
      )
      .find(Boolean);
  const target = worktree
    ? {
        repositoryId: repository.id,
        worktreeId: worktree.id
      }
    : undefined;

  return {
    repository,
    target,
    worktree,
    snapshot: findTargetSnapshot(snapshots, target)
  };
}

function compareRepositoryRows(
  left: WorkspaceRepositoryRow,
  right: WorkspaceRepositoryRow
): number {
  return (
    repositoryPriority(right.snapshot) -
      repositoryPriority(left.snapshot) ||
    (left.worktree?.name ?? left.repository.name).localeCompare(
      right.worktree?.name ?? right.repository.name,
      undefined,
      { sensitivity: "base" }
    )
  );
}

function compareActivityRows(
  left: WorkspaceRepositoryRow,
  right: WorkspaceRepositoryRow
): number {
  return (
    snapshotTimestamp(right.snapshot) - snapshotTimestamp(left.snapshot) ||
    compareRepositoryRows(left, right)
  );
}

function snapshotTimestamp(
  snapshot: RepositoryStatusSnapshotDto | undefined
): number {
  if (!snapshot) {
    return Number.NEGATIVE_INFINITY;
  }
  const timestamp = new Date(snapshot.refreshedAt).getTime();
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
}

function repositoryPriority(
  snapshot: RepositoryStatusSnapshotDto | undefined
): number {
  if (snapshot?.error || snapshot?.conflicted) {
    return 4;
  }
  if (snapshot && getSnapshotChangeCount(snapshot) > 0) {
    return 3;
  }
  if (snapshot && (snapshot.ahead > 0 || snapshot.behind > 0)) {
    return 2;
  }
  if (!snapshot || snapshot.stale) {
    return 1;
  }
  return 0;
}

function repositoryTone(
  snapshot: RepositoryStatusSnapshotDto | undefined
): "clean" | "idle" | "pending" | "warning" | "danger" {
  if (snapshot?.refreshPending) {
    return "pending";
  }
  if (snapshot?.error || snapshot?.conflicted) {
    return "danger";
  }
  if (!snapshot || snapshot.stale) {
    return "idle";
  }
  return getSnapshotChangeCount(snapshot) > 0 ? "warning" : "clean";
}

function workspaceStatusLabel(
  snapshot: RepositoryStatusSnapshotDto | undefined
): string {
  if (snapshot?.error) {
    return "读取失败";
  }
  if (snapshot?.refreshPending) {
    return "刷新中";
  }
  if (!snapshot || snapshot.stale) {
    return "缓存";
  }
  if (snapshot.conflicted > 0) {
    return `${snapshot.conflicted} 冲突`;
  }
  const changes = getSnapshotChangeCount(snapshot);
  return changes > 0 ? `${changes} 变更` : "干净";
}

function workspaceStatusTone(
  snapshot: RepositoryStatusSnapshotDto | undefined
): "neutral" | "blue" | "green" | "yellow" | "red" {
  if (snapshot?.error || snapshot?.conflicted) {
    return "red";
  }
  if (snapshot?.refreshPending || snapshot?.stale || !snapshot) {
    return "blue";
  }
  return getSnapshotChangeCount(snapshot) > 0 ? "yellow" : "green";
}

function syncLabel(
  snapshot: RepositoryStatusSnapshotDto | undefined
): string {
  if (!snapshot?.upstream) {
    return "无上游";
  }
  if (snapshot.ahead === 0 && snapshot.behind === 0) {
    return "已同步";
  }
  return `↑${snapshot.ahead} ↓${snapshot.behind}`;
}

function workspaceActivityStatus(
  snapshot: RepositoryStatusSnapshotDto
): string {
  if (snapshot.error) {
    return "读取失败";
  }
  if (snapshot.refreshPending) {
    return "正在刷新";
  }
  return `${snapshot.branch ?? "detached"} · ${syncLabel(snapshot)}`;
}

function workspaceActivitySearchValues(
  row: WorkspaceRepositoryRow
): string[] {
  return [
    row.repository.name,
    row.worktree?.name ?? "",
    row.snapshot?.branch ?? "",
    row.snapshot?.head ?? "",
    row.snapshot?.upstream ?? ""
  ];
}

function shortHead(head: string): string {
  return head ? head.slice(0, 7) : "—";
}

function formatWorkspaceTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "时间未知";
  }
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(
    date.getDate()
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
