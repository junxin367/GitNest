import {
  useEffect,
  useRef,
  useState,
  type FormEvent
} from "react";

import type {
  RepositoryStatusSnapshotDto,
  RepositoryTargetDto
} from "@gitnest/contracts";

import type { useRepositoryDetails } from "../../entities/repository/useRepositoryDetails";
import type { RepositoryCommandController } from "../../features/repository-command/useRepositoryCommands";
import { Button } from "../../shared/ui/Button";
import { Icon } from "../../shared/ui/Icon";
import { Input } from "../../shared/ui/Input";
import {
  MenuItem,
  MenuPopover
} from "../../shared/ui/Menu";
import {
  Skeleton,
  SkeletonBoundary
} from "../../shared/ui/Skeleton";
import { RepositoryReadFailure } from "./RepositoryReadFailure";

interface BranchMenuState {
  anchor: HTMLButtonElement;
  branchName: string;
}

export function RepositoryBranches({
  controller,
  commands,
  snapshot,
  target,
  worktreePath
}: {
  controller: ReturnType<typeof useRepositoryDetails>;
  commands: RepositoryCommandController;
  snapshot: RepositoryStatusSnapshotDto | undefined;
  target: RepositoryTargetDto;
  worktreePath: string | undefined;
}) {
  const branches = controller.branches?.branches ?? [];
  const [createFormOpen, setCreateFormOpen] = useState(false);
  const [newBranch, setNewBranch] = useState("");
  const [renamingBranch, setRenamingBranch] =
    useState<string | null>(null);
  const [renamedBranch, setRenamedBranch] = useState("");
  const [branchMenu, setBranchMenu] =
    useState<BranchMenuState | null>(null);
  const branchMenuRef = useRef<HTMLDivElement>(null);
  const localCount = branches.filter(
    (branch) => !branch.remote
  ).length;

  useEffect(() => {
    if (!branchMenu) {
      return;
    }

    const close = () => setBranchMenu(null);
    const handlePointerDown = (event: PointerEvent) => {
      const eventTarget = event.target;
      if (
        eventTarget instanceof Element &&
        eventTarget.closest("[data-branch-menu-trigger]")
      ) {
        return;
      }
      if (
        eventTarget instanceof Node &&
        branchMenuRef.current?.contains(eventTarget)
      ) {
        return;
      }
      close();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    const focusFrame = window.requestAnimationFrame(() => {
      branchMenuRef.current
        ?.querySelector<HTMLButtonElement>('[role="menuitem"]')
        ?.focus({ preventScroll: true });
    });

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener(
        "pointerdown",
        handlePointerDown
      );
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [branchMenu]);

  const createBranch = (event: FormEvent) => {
    event.preventDefault();
    const branch = newBranch.trim();
    if (!branch || commands.busy) {
      return;
    }
    void commands
      .request({
        type: "create-branch",
        target,
        branch
      })
      .then((accepted) => {
        if (accepted) {
          setNewBranch("");
          setCreateFormOpen(false);
        }
      });
  };

  const renameBranch = (
    event: FormEvent,
    branch: string
  ) => {
    event.preventDefault();
    const newName = renamedBranch.trim();
    if (
      !newName ||
      newName === branch ||
      commands.busy
    ) {
      return;
    }
    void commands
      .request({
        type: "rename-branch",
        target,
        branch,
        newName
      })
      .then((accepted) => {
        if (accepted) {
          setRenamingBranch(null);
          setRenamedBranch("");
        }
      });
  };

  if (
    !controller.loading.branches &&
    !controller.branches &&
    controller.error
  ) {
    return <RepositoryReadFailure label="分支列表暂时不可用" />;
  }

  const branchMenuBranch = branchMenu
    ? branches.find(
        (branch) =>
          !branch.remote &&
          branch.name === branchMenu.branchName
      )
    : undefined;
  const branchMenuOccupiedElsewhere = branchMenuBranch
    ? branchOccupiedElsewhere(
        branchMenuBranch.worktreePath,
        worktreePath
      )
    : false;

  return (
    <SkeletonBoundary
      fallback={<RepositoryBranchesSkeleton />}
      hasContent={branches.length > 0}
      label="正在读取分支"
      loading={controller.loading.branches}
      surfaceClassName="repository-branches-page repository-branches-skeleton"
    >
      <div className="repository-branches-page">
        <header className="panel-header sticky-panel-header">
          <div className="panel-title">
            <Icon name="branch" />
            分支管理
          </div>
          <span className="panel-caption">
            快照采集当前本地分支 {localCount} 条
          </span>
          <Button size="small"
            aria-controls="new-branch-form"
            aria-expanded={createFormOpen}
            className="branch-header-action"
            onClick={() => setCreateFormOpen((open) => !open)}
            type="button"
          >
            <Icon
              name={createFormOpen ? "close" : "plus"}
              size={13}
            />
            {createFormOpen ? "收起" : "新建分支"}
          </Button>
        </header>
        {createFormOpen && (
          <div className="branch-management-toolbar">
            <form id="new-branch-form" onSubmit={createBranch}>
              <label htmlFor="new-branch-name">
                从当前 HEAD 创建分支
              </label>
              <div>
                <Input
                  fullWidth
                  id="new-branch-name"
                  maxLength={255}
                  onChange={(event) =>
                    setNewBranch(event.target.value)
                  }
                  placeholder="例如 feature/safe-sync"
                  size="small"
                  spellCheck={false}
                  value={newBranch}
                />
                <Button size="small" variant="primary"
                  aria-busy={commands.active === "create-branch"}
                  disabled={
                    commands.busy || !newBranch.trim()
                  }
                  type="submit"
                >
                  <Icon
                    name={
                      commands.active === "create-branch"
                        ? "refresh"
                        : "plus"
                    }
                  />
                  {commands.active === "create-branch"
                    ? "预检中…"
                    : "创建"}
                </Button>
              </div>
            </form>
            <p>
              分支写操作都会先展示目标、路径与引用影响；GitNest
              不会自动 Stash。
            </p>
          </div>
        )}
        <div className="branches-table" role="table">
        <div className="branches-row branches-head" role="row">
          <span role="columnheader">分支</span>
          <span role="columnheader">类型</span>
          <span role="columnheader">上游</span>
          <span role="columnheader">同步</span>
          <span role="columnheader">更新</span>
          <span role="columnheader">
            <span className="visually-hidden">操作</span>
          </span>
        </div>
        {branches.map((branch) => {
          const editing =
            renamingBranch === branch.name &&
            !branch.remote;

          return (
            <div
              className={`branches-row${
                branch.current ? " current" : ""
              }`}
              key={branch.fullName}
              role="row"
              >
              <span className="branch-name-column" role="cell">
                <span
                  className={`branch-name-cell${
                    branch.current ? " current" : ""
                  }`}
                >
                  {branch.current ? (
                    <span
                      aria-hidden="true"
                      className="branch-current-dot"
                    />
                  ) : (
                    <Icon name="branch" size={14} />
                  )}
                  <span title={branch.name}>{branch.name}</span>
                </span>
              </span>
              <span role="cell">
                <span
                  className={`status-pill ${
                    branch.remote ? "blue" : "neutral"
                  }`}
                >
                  {branch.remote ? "远程" : "本地"}
                </span>
              </span>
              <span
                role="cell"
                title={branch.upstream ?? undefined}
              >
                {branch.upstream ?? "—"}
              </span>
              <span
                className="branch-sync"
                role="cell"
                title={
                  branch.current && snapshot?.upstream
                    ? `领先 ${snapshot.ahead}，落后 ${snapshot.behind}`
                    : undefined
                }
              >
                {branchSyncLabel(branch.current, snapshot)}
              </span>
              <span
                className="branch-updated"
                role="cell"
                title={branch.updatedAt}
              >
                {formatBranchUpdatedAt(branch.updatedAt)}
              </span>
              <span className="branch-row-actions" role="cell">
                {branch.remote ? (
                  "—"
                ) : editing ? (
                  <form
                    className="branch-rename-form"
                    onSubmit={(event) =>
                      renameBranch(event, branch.name)
                    }
                  >
                    <Input
                      appearance="unstyled"
                      aria-label={`重命名 ${branch.name}`}
                      autoFocus
                      maxLength={255}
                      onChange={(event) =>
                        setRenamedBranch(event.target.value)
                      }
                      spellCheck={false}
                      value={renamedBranch}
                    />
                    <Button variant="unstyled"
                      className="mini-action"
                      disabled={
                        commands.busy ||
                        !renamedBranch.trim() ||
                        renamedBranch.trim() === branch.name
                      }
                      type="submit"
                    >
                      保存
                    </Button>
                    <Button variant="unstyled"
                      className="mini-action"
                      disabled={commands.busy}
                      onClick={() => {
                        setRenamingBranch(null);
                        setRenamedBranch("");
                      }}
                      type="button"
                    >
                      取消
                    </Button>
                    </form>
                  ) : (
                    <Button variant="unstyled"
                      aria-expanded={
                        branchMenu?.branchName === branch.name
                      }
                      aria-haspopup="menu"
                      aria-label={`打开 ${branch.name} 操作`}
                      className="icon-button branch-row-menu-trigger"
                      data-branch-menu-trigger
                      onClick={(event) => {
                        if (
                          branchMenu?.branchName === branch.name
                        ) {
                          setBranchMenu(null);
                          return;
                        }
                        setBranchMenu({
                          anchor: event.currentTarget,
                          branchName: branch.name,
                        });
                      }}
                      title="分支操作"
                      type="button"
                    >
                      <Icon name="more" size={14} />
                    </Button>
                  )}
              </span>
            </div>
          );
        })}
        {branches.length === 0 && (
          <div className="branches-empty" role="row">
            <Icon name="branch" size={18} />
            <strong>暂无分支</strong>
            <span>空仓库在首次提交后会显示本地分支。</span>
          </div>
        )}
        </div>
        {branchMenu && branchMenuBranch && (
          <MenuPopover
            align="end"
            anchor={branchMenu.anchor}
            aria-label={`${branchMenuBranch.name} 分支操作`}
            className="branch-row-floating-menu"
            ref={branchMenuRef}
            side="bottom"
          >
            <MenuItem
              disabled={
                commands.busy ||
                branchMenuBranch.current ||
                branchMenuOccupiedElsewhere
              }
              leading={<Icon name="branch" size={14} />}
              onClick={() => {
                setBranchMenu(null);
                void commands.request({
                  type: "switch-branch",
                  target,
                  branch: branchMenuBranch.name
                });
              }}
              title={
                branchMenuOccupiedElsewhere
                  ? "该分支已被其他 Worktree 检出"
                  : branchMenuBranch.current
                    ? "当前分支"
                    : "切换前执行脏状态与 Worktree 占用预检"
              }
            >
              切换
            </MenuItem>
            <MenuItem
              disabled={
                commands.busy || branchMenuOccupiedElsewhere
              }
              leading={<Icon name="settings" size={14} />}
              onClick={() => {
                setBranchMenu(null);
                setRenamingBranch(branchMenuBranch.name);
                setRenamedBranch(branchMenuBranch.name);
              }}
              title={
                branchMenuOccupiedElsewhere
                  ? "该分支已被其他 Worktree 检出"
                  : "重命名本地分支"
              }
            >
              重命名
            </MenuItem>
            <MenuItem
              disabled={
                commands.busy ||
                branchMenuBranch.current ||
                branchMenuOccupiedElsewhere
              }
              leading={<Icon name="warning" size={14} />}
              onClick={() => {
                setBranchMenu(null);
                void commands.request({
                  type: "delete-branch",
                  target,
                  branch: branchMenuBranch.name
                });
              }}
              title={
                branchMenuBranch.current
                  ? "不能删除当前分支"
                  : branchMenuOccupiedElsewhere
                    ? "该分支已被其他 Worktree 检出"
                    : "仅允许删除已合并的本地分支"
              }
              tone="danger"
            >
              删除
            </MenuItem>
          </MenuPopover>
        )}
      </div>
    </SkeletonBoundary>
  );
}

function branchSyncLabel(
  current: boolean,
  snapshot: RepositoryStatusSnapshotDto | undefined
): string {
  if (!current || !snapshot?.upstream) {
    return "—";
  }

  const parts = [
    snapshot.ahead > 0 ? `↑ ${snapshot.ahead}` : "",
    snapshot.behind > 0 ? `↓ ${snapshot.behind}` : ""
  ].filter(Boolean);

  return parts.join(" ") || "已同步";
}

function formatBranchUpdatedAt(value: string | undefined): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function branchOccupiedElsewhere(
  branchWorktreePath: string | undefined,
  currentWorktreePath: string | undefined
): boolean {
  if (!branchWorktreePath) {
    return false;
  }
  if (!currentWorktreePath) {
    return true;
  }
  return normalizeWorktreePath(branchWorktreePath) !==
    normalizeWorktreePath(currentWorktreePath);
}

function normalizeWorktreePath(path: string): string {
  return path
    .replace(/\//g, "\\")
    .replace(/\\+$/, "")
    .toLocaleLowerCase("en-US");
}

function RepositoryBranchesSkeleton() {
  return (
    <>
      <div className="gn-skeleton-panel-header">
        <Skeleton variant="text" width={112} height={16} />
        <Skeleton variant="text" width={184} height={13} />
        <Skeleton width={96} height={30} />
      </div>
      <div className="gn-skeleton-list repository-branches-skeleton-table">
        {[82, 68, 76, 60, 72, 64].map((width, index) => (
          <div
            className="gn-skeleton-row repository-branches-skeleton-row"
            key={`${width}-${index}`}
          >
            <span className="gn-skeleton-row-copy">
              <Skeleton
                variant="text"
                width={`${width}%`}
                height={14}
              />
            </span>
            <Skeleton variant="text" width={48} height={20} />
            <Skeleton variant="text" width={92} height={12} />
            <Skeleton variant="text" width={54} height={12} />
            <Skeleton variant="text" width={88} height={12} />
            <Skeleton variant="circle" width={24} height={24} />
          </div>
        ))}
      </div>
    </>
  );
}
