import {
  useEffect,
  useState,
  type FormEvent
} from "react";

import type {
  RepositoryStatusSnapshotDto,
  WorkspaceDetailsDto,
  WorkspaceWorktreeDto
} from "@gitnest/contracts";

import type { WorktreeCommandController } from "../../features/worktree-command/useWorktreeCommands";
import { Icon } from "../../shared/ui/Icon";

interface RepositoryWorktreesProps {
  workspace: WorkspaceDetailsDto;
  repositoryId: string;
  snapshots: RepositoryStatusSnapshotDto[];
  commands: WorktreeCommandController;
}

export function RepositoryWorktrees({
  workspace,
  repositoryId,
  snapshots,
  commands
}: RepositoryWorktreesProps) {
  const [createPath, setCreatePath] = useState("");
  const [createBranch, setCreateBranch] = useState("");
  const [createStartPoint, setCreateStartPoint] =
    useState("");
  const [lockReasons, setLockReasons] = useState<
    Record<string, string>
  >({});
  const [moveDestinations, setMoveDestinations] = useState<
    Record<string, string>
  >({});
  const repository = workspace.repositories.find(
    (candidate) => candidate.id === repositoryId
  );
  const worktrees = workspace.worktrees.filter(
    (worktree) => worktree.repositoryId === repositoryId
  );
  const prunableCount = worktrees.filter(
    (worktree) => worktree.isPrunable
  ).length;

  useEffect(() => {
    setCreatePath("");
    setCreateBranch("");
    setCreateStartPoint("");
    setLockReasons({});
    setMoveDestinations({});
    commands.clearFeedback();
  }, [repositoryId]);

  const submitCreate = (event: FormEvent) => {
    event.preventDefault();
    const path = createPath.trim();
    const branch = createBranch.trim();
    const startPoint = createStartPoint.trim();
    if (!path) {
      return;
    }
    void commands.request({
      type: "create",
      repositoryId,
      path,
      ...(branch ? { branch } : {}),
      ...(startPoint ? { startPoint } : {})
    });
  };

  if (!repository) {
    return (
      <div className="empty-state">
        <strong>仓库实例已不可用</strong>
      </div>
    );
  }

  return (
    <div className="worktree-management">
      {(commands.error || commands.notice) && (
        <div
          className={`workspace-feedback ${
            commands.error ? "error" : "success"
          }`}
          role={commands.error ? "alert" : "status"}
        >
          <Icon
            name={commands.error ? "warning" : "check"}
          />
          <div>
            <strong>
              {commands.error
                ? "Worktree 操作未完成"
                : "Worktree 操作状态"}
            </strong>
            <span>
              {commands.error?.message ?? commands.notice}
            </span>
          </div>
          <button
            aria-label="关闭 Worktree 操作提示"
            className="icon-button"
            onClick={commands.clearFeedback}
            type="button"
          >
            <Icon name="close" />
          </button>
        </div>
      )}

      <section className="worktree-management-grid">
        <article className="panel worktree-create-panel">
          <header className="panel-header">
            <div className="panel-title">
              <Icon name="plus" />
              创建 Worktree
            </div>
            <span className="panel-caption">
              已有分支或新分支；留空分支将创建 detached HEAD
            </span>
          </header>
          <form onSubmit={submitCreate}>
            <label className="field">
              <span>目标绝对路径</span>
              <div className="worktree-path-input">
                <input
                  aria-label="Worktree 目标绝对路径"
                  disabled={commands.busy}
                  onChange={(event) =>
                    setCreatePath(event.target.value)
                  }
                  placeholder="C:\worktrees\feature-name"
                  spellCheck={false}
                  value={createPath}
                />
                <button
                  className="button"
                  disabled={commands.busy}
                  onClick={() => {
                    void commands
                      .chooseDirectory()
                      .then((path) => {
                        if (path) {
                          setCreatePath(path);
                        }
                      });
                  }}
                  type="button"
                >
                  <Icon name="folder" />
                  选择
                </button>
              </div>
              <small>
                可选择一个空目录，或选择父目录后在路径末尾补充新目录名。
              </small>
            </label>
            <div className="worktree-create-fields">
              <label className="field">
                <span>分支（可选）</span>
                <input
                  disabled={commands.busy}
                  onChange={(event) =>
                    setCreateBranch(event.target.value)
                  }
                  placeholder="feature/worktree"
                  spellCheck={false}
                  value={createBranch}
                />
              </label>
              <label className="field">
                <span>起点（可选）</span>
                <input
                  disabled={commands.busy}
                  onChange={(event) =>
                    setCreateStartPoint(event.target.value)
                  }
                  placeholder="HEAD 或提交"
                  spellCheck={false}
                  value={createStartPoint}
                />
              </label>
            </div>
            <div className="worktree-form-footer">
              <span>
                目标必须不存在或为空，且不能与已有 Worktree 重叠。
              </span>
              <button
                className="button primary"
                disabled={commands.busy || !createPath.trim()}
                type="submit"
              >
                <Icon
                  name={
                    commands.active === "create"
                      ? "refresh"
                      : "plus"
                  }
                />
                {commands.active === "create"
                  ? "预检中…"
                  : "预检并创建"}
              </button>
            </div>
          </form>
        </article>

        <article className="panel worktree-safety-panel">
          <header className="panel-header">
            <div className="panel-title">
              <Icon name="worktree" />
              安全边界
            </div>
          </header>
          <ul>
            <li>Primary Worktree 永不允许移除。</li>
            <li>脏、冲突、锁定目录不允许 Remove。</li>
            <li>Move/Remove 不提供强制模式。</li>
            <li>Prune 只清理失效 Git 登记。</li>
          </ul>
          <button
            className="button"
            disabled={commands.busy || prunableCount === 0}
            onClick={() =>
              void commands.request({
                type: "prune",
                repositoryId
              })
            }
            type="button"
          >
            <Icon name="refresh" />
            预检 Prune ({prunableCount})
          </button>
        </article>
      </section>

      <section className="worktree-inventory">
        <header className="worktree-inventory-header">
          <div>
            <span className="eyebrow">Git common directory</span>
            <h2>已登记 Worktrees</h2>
          </div>
          <span>
            {worktrees.length} 个目录 · {prunableCount} 个失效登记
          </span>
        </header>

        <div className="worktree-grid">
          {worktrees.map((worktree) => {
            const snapshot = snapshots.find(
              (candidate) =>
                candidate.repositoryId === repositoryId &&
                candidate.worktreeId === worktree.id
            );
            const dirty = Boolean(
              snapshot &&
                (snapshot.staged > 0 ||
                  snapshot.unstaged > 0 ||
                  snapshot.untracked > 0 ||
                  snapshot.conflicted > 0)
            );
            return (
              <WorktreeCard
                commands={commands}
                dirty={dirty}
                key={worktree.id}
                lockReason={lockReasons[worktree.id] ?? ""}
                moveDestination={
                  moveDestinations[worktree.id] ?? ""
                }
                onLockReasonChange={(value) =>
                  setLockReasons((current) => ({
                    ...current,
                    [worktree.id]: value
                  }))
                }
                onMoveDestinationChange={(value) =>
                  setMoveDestinations((current) => ({
                    ...current,
                    [worktree.id]: value
                  }))
                }
                worktree={worktree}
              />
            );
          })}
        </div>

        {worktrees.length === 0 && (
          <div className="empty-state">
            <strong>没有可展示的 Worktree</strong>
          </div>
        )}
      </section>
    </div>
  );
}

function WorktreeCard({
  worktree,
  dirty,
  commands,
  lockReason,
  moveDestination,
  onLockReasonChange,
  onMoveDestinationChange
}: {
  worktree: WorkspaceWorktreeDto;
  dirty: boolean;
  commands: WorktreeCommandController;
  lockReason: string;
  moveDestination: string;
  onLockReasonChange(value: string): void;
  onMoveDestinationChange(value: string): void;
}) {
  const linked = !worktree.isPrimary && !worktree.isBare;
  const mutable =
    linked && !worktree.isLocked && !worktree.isPrunable;
  const removable = mutable && !dirty;

  return (
    <article
      className={`worktree-card worktree-management-card${
        worktree.isPrunable ? " prunable" : ""
      }`}
    >
      <div className="worktree-card-heading">
        <span className="runtime-hero-icon">
          <Icon name="worktree" size={20} />
        </span>
        <div>
          <strong>{worktree.name}</strong>
          <code title={worktree.path}>{worktree.path}</code>
        </div>
      </div>

      <div className="worktree-badges">
        <span className="status-pill neutral">
          {worktree.isPrimary ? "Primary" : "Linked"}
        </span>
        <span className="status-pill blue">
          {worktree.branch ?? "detached"}
        </span>
        {worktree.isLocked && (
          <span className="status-pill yellow">Locked</span>
        )}
        {worktree.isPrunable && (
          <span className="status-pill yellow">Prunable</span>
        )}
        {dirty && (
          <span className="status-pill yellow">有未提交变更</span>
        )}
      </div>

      {(worktree.lockReason || worktree.pruneReason) && (
        <div className="worktree-reason">
          {worktree.lockReason && (
            <span>锁定原因：{worktree.lockReason}</span>
          )}
          {worktree.pruneReason && (
            <span>失效原因：{worktree.pruneReason}</span>
          )}
        </div>
      )}

      <div className="worktree-card-actions">
        {linked && !worktree.isLocked && !worktree.isPrunable && (
          <div className="worktree-inline-action">
            <input
              aria-label={`${worktree.name} 锁定原因`}
              disabled={commands.busy}
              maxLength={512}
              onChange={(event) =>
                onLockReasonChange(event.target.value)
              }
              placeholder="锁定原因（可选）"
              value={lockReason}
            />
            <button
              className="mini-action"
              disabled={commands.busy}
              onClick={() =>
                void commands.request({
                  type: "lock",
                  worktreeId: worktree.id,
                  ...(lockReason.trim()
                    ? { reason: lockReason.trim() }
                    : {})
                })
              }
              type="button"
            >
              锁定
            </button>
          </div>
        )}

        {linked && worktree.isLocked && (
          <button
            className="button"
            disabled={commands.busy}
            onClick={() =>
              void commands.request({
                type: "unlock",
                worktreeId: worktree.id
              })
            }
            type="button"
          >
            解锁 Worktree
          </button>
        )}

        {mutable && (
          <div className="worktree-inline-action move">
            <input
              aria-label={`${worktree.name} 移动目标`}
              disabled={commands.busy}
              onChange={(event) =>
                onMoveDestinationChange(event.target.value)
              }
              placeholder="新的绝对路径"
              spellCheck={false}
              value={moveDestination}
            />
            <button
              aria-label={`选择 ${worktree.name} 移动父目录`}
              className="mini-action"
              disabled={commands.busy}
              onClick={() => {
                void commands
                  .chooseDirectory()
                  .then((path) => {
                    if (path) {
                      onMoveDestinationChange(
                        joinWindowsPath(
                          path,
                          pathBasename(worktree.path)
                        )
                      );
                    }
                  });
              }}
              type="button"
            >
              选择
            </button>
            <button
              className="mini-action"
              disabled={
                commands.busy || !moveDestination.trim()
              }
              onClick={() =>
                void commands.request({
                  type: "move",
                  worktreeId: worktree.id,
                  destination: moveDestination.trim()
                })
              }
              type="button"
            >
              移动
            </button>
          </div>
        )}

        <div className="worktree-button-row">
          <button
            className="button"
            disabled={commands.busy || worktree.isBare}
            onClick={() =>
              void commands.request({
                type: "repair",
                worktreeId: worktree.id
              })
            }
            type="button"
          >
            修复登记
          </button>
          {linked && (
            <button
              className="button danger"
              disabled={commands.busy || !removable}
              onClick={() =>
                void commands.request({
                  type: "remove",
                  worktreeId: worktree.id
                })
              }
              title={
                worktree.isLocked
                  ? "请先解锁 Worktree"
                  : worktree.isPrunable
                    ? "失效登记请使用 Prune"
                    : dirty
                      ? "脏 Worktree 不允许移除"
                      : "安全移除 linked Worktree"
              }
              type="button"
            >
              移除
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function pathBasename(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).pop() || "worktree";
}

function joinWindowsPath(parent: string, child: string): string {
  return `${parent.replace(/[\\/]+$/, "")}\\${child}`;
}
