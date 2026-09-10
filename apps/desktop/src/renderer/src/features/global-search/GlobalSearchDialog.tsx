import { Button } from "../../shared/ui/Button";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";

import type {
  RepositoryStatusSnapshotDto,
  RepositoryTargetDto,
  WorkspaceDetailsDto
} from "@gitnest/contracts";

import type { AppView } from "../../app/navigation";
import {
  findTargetSnapshot,
  getSnapshotChangeCount,
  listWorkspaceTargets,
  resolveWorkspaceTarget
} from "../../entities/workspace/model";
import { Icon, type IconName } from "../../shared/ui/Icon";
import { Input } from "../../shared/ui/Input";
import { LayerPortal } from "../../shared/ui/LayerPortal";
import { useModalFocusTrap } from "../../shared/ui/useModalFocusTrap";

interface GlobalSearchDialogProps {
  workspace: WorkspaceDetailsDto | null;
  snapshots: RepositoryStatusSnapshotDto[];
  onClose(): void;
  onOpenTarget(target: RepositoryTargetDto): void;
  onNavigate(view: AppView): void;
  onRefresh(): void;
  onToggleTheme(): void;
  onFetchAll(): void;
}

type SearchCommandAction =
  | {
      type: "navigate";
      view: AppView;
    }
  | {
      type: "refresh";
    }
  | {
      type: "theme";
    }
  | {
      type: "fetch-all";
    };

type RepositorySearchResult = {
  kind: "repository";
  id: string;
  title: string;
  subtitle: string;
  status: string;
  target: RepositoryTargetDto;
  icon: "repository";
};

type CommandSearchResult = {
  kind: "command";
  id: string;
  title: string;
  subtitle: string;
  icon: IconName;
  action: SearchCommandAction;
};

type SearchResult =
  | RepositorySearchResult
  | CommandSearchResult;

export function GlobalSearchDialog({
  workspace,
  snapshots,
  onClose,
  onOpenTarget,
  onNavigate,
  onRefresh,
  onToggleTheme,
  onFetchAll
}: GlobalSearchDialogProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const dialogRef = useRef<HTMLElement>(null);
  useModalFocusTrap(dialogRef);

  const repositoryResults = useMemo<
    RepositorySearchResult[]
  >(() => {
    if (!workspace) {
      return [];
    }

    return listWorkspaceTargets(workspace).map((target) => {
      const resolved = resolveWorkspaceTarget(
        workspace,
        target
      );
      const snapshot = findTargetSnapshot(snapshots, target);
      const repositoryName =
        resolved.repository?.name ?? target.repositoryId;
      const worktreeName = resolved.worktree?.name;
      const title =
        worktreeName && worktreeName !== repositoryName
          ? `${repositoryName} / ${worktreeName}`
          : repositoryName;
      const branch =
        snapshot?.branch ??
        resolved.worktree?.branch ??
        (resolved.worktree?.isDetached ? "detached" : "未知分支");
      const path =
        resolved.worktree?.path ?? target.worktreeId;

      return {
        kind: "repository",
        id: `repository:${target.repositoryId}:${target.worktreeId}`,
        title,
        subtitle: `${branch} · ${path}`,
        status: formatTargetStatus(snapshot),
        target,
        icon: "repository"
      };
    });
  }, [snapshots, workspace]);

  const commandResults = useMemo<CommandSearchResult[]>(() => {
    const commands: CommandSearchResult[] = [
      {
        kind: "command",
        id: "command:workspace",
        title: "打开 Workspace 总览",
        subtitle: "查看全部仓库状态",
        icon: "grid",
        action: {
          type: "navigate",
          view: "workspace"
        }
      },
      ...(workspace?.selectedTarget
        ? [
            {
              kind: "command" as const,
              id: "command:repository",
              title: "打开当前仓库",
              subtitle: "查看所选仓库的状态、变更与历史",
              icon: "repository" as const,
              action: {
                type: "navigate" as const,
                view: "repository" as const
              }
            }
          ]
        : []),
      {
        kind: "command",
        id: "command:operations",
        title: "打开操作中心",
        subtitle: "查看批量 Git 操作进度",
        icon: "operations",
        action: {
          type: "navigate",
          view: "operations"
        }
      },
      {
        kind: "command",
        id: "command:settings",
        title: "打开设置",
        subtitle: "账号、Git 与终端配置",
        icon: "settings",
        action: {
          type: "navigate",
          view: "settings"
        }
      },
      {
        kind: "command",
        id: "command:refresh",
        title: "重新扫描 Workspace",
        subtitle: "重新读取仓库状态",
        icon: "refresh",
        action: {
          type: "refresh"
        }
      },
      ...(repositoryResults.length > 0
        ? [
            {
              kind: "command" as const,
              id: "command:fetch-all",
              title: "Fetch 全部仓库",
              subtitle: "获取 Workspace 中所有远程引用",
              icon: "download" as const,
              action: {
                type: "fetch-all" as const
              }
            }
          ]
        : []),
      {
        kind: "command",
        id: "command:theme",
        title: "切换深色 / 浅色主题",
        subtitle: "修改当前界面外观",
        icon: "sun",
        action: {
          type: "theme"
        }
      }
    ];

    return commands;
  }, [repositoryResults.length, workspace?.selectedTarget]);

  const normalizedQuery = query.trim().toLowerCase();
  const matchingRepositoryResults = useMemo(
    () =>
      repositoryResults
        .filter((result) =>
          matchesSearch(result, normalizedQuery)
        )
        .slice(0, 12),
    [normalizedQuery, repositoryResults]
  );
  const matchingCommandResults = useMemo(
    () =>
      commandResults.filter((result) =>
        matchesSearch(result, normalizedQuery)
      ),
    [commandResults, normalizedQuery]
  );
  const results = useMemo(
    () => [
      ...matchingRepositoryResults,
      ...matchingCommandResults
    ],
    [matchingCommandResults, matchingRepositoryResults]
  );

  useEffect(() => {
    setSelectedIndex((current) =>
      Math.min(current, Math.max(results.length - 1, 0))
    );
  }, [results.length]);

  const activate = (result: SearchResult | undefined) => {
    if (!result) {
      return;
    }

    onClose();
    if (result.kind === "repository") {
      onOpenTarget(result.target);
      return;
    }

    switch (result.action.type) {
      case "navigate":
        onNavigate(result.action.view);
        return;
      case "refresh":
        onRefresh();
        return;
      case "theme":
        onToggleTheme();
        return;
      case "fetch-all":
        onFetchAll();
        return;
    }
  };

  const handleKeyDown = (
    event: ReactKeyboardEvent<HTMLElement>
  ) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (!(event.target instanceof HTMLInputElement)) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((current) =>
        results.length === 0
          ? 0
          : Math.min(current + 1, results.length - 1)
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((current) =>
        results.length === 0
          ? 0
          : current <= 0
            ? results.length - 1
            : current - 1
      );
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      activate(results[selectedIndex]);
    }
  };

  return (
    <LayerPortal>
      <div
        className="global-search-backdrop"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            onClose();
          }
        }}
      >
        <section
        aria-labelledby="global-search-title"
        aria-modal="true"
        className="global-search-dialog"
        id="global-search-dialog"
        ref={dialogRef}
        role="dialog"
        onKeyDown={handleKeyDown}
      >
        <h2 className="visually-hidden" id="global-search-title">
          全局搜索
        </h2>
        <div className="global-search-input-wrap">
          <Icon name="search" size={18} />
          <Input
            appearance="unstyled"
            aria-activedescendant={
              results.length > 0
                ? getResultElementId(selectedIndex)
                : undefined
            }
            aria-controls="global-search-results"
            aria-label="搜索仓库、分支或命令"
            autoComplete="off"
            className="global-search-input"
            data-modal-initial-focus="true"
            id="global-search-input"
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedIndex(0);
            }}
            placeholder="搜索仓库、分支或命令…"
            role="combobox"
            value={query}
          />
          <kbd className="global-search-key">Esc</kbd>
        </div>

        <div
          aria-label="搜索结果"
          className="global-search-results"
          id="global-search-results"
          role="listbox"
        >
          {results.length === 0 ? (
            <div className="global-search-empty">
              {normalizedQuery
                ? "没有匹配的仓库或命令。"
                : "当前 Workspace 暂无可搜索内容。"}
            </div>
          ) : (
            results.map((result, index) => (
              <Fragment key={result.id}>
                {result.kind !== results[index - 1]?.kind && (
                  <div className="global-search-group-label">
                    {result.kind === "repository"
                      ? "仓库与 Worktree"
                      : "命令"}
                  </div>
                )}
                <Button variant="unstyled"
                  aria-selected={selectedIndex === index}
                  aria-setsize={results.length}
                  aria-posinset={index + 1}
                  className={`global-search-result${
                    selectedIndex === index ? " selected" : ""
                  }`}
                  id={getResultElementId(index)}
                  onClick={() => activate(result)}
                  onFocus={() => setSelectedIndex(index)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  role="option"
                  type="button"
                >
                  <span className="global-search-result-icon">
                    <Icon name={result.icon} size={16} />
                  </span>
                  <span className="global-search-result-copy">
                    <strong>{result.title}</strong>
                    <span>{result.subtitle}</span>
                  </span>
                  <span className="global-search-result-trailing">
                    {result.kind === "repository" && (
                      <span className="global-search-result-status">
                        {result.status}
                      </span>
                    )}
                    {selectedIndex === index && (
                      <kbd className="global-search-result-key">
                        Enter
                      </kbd>
                    )}
                  </span>
                </Button>
              </Fragment>
            ))
          )}
        </div>
        </section>
      </div>
    </LayerPortal>
  );
}

function matchesSearch(
  result: SearchResult,
  query: string
): boolean {
  if (!query) {
    return true;
  }

  const searchable = [
    result.title,
    result.subtitle,
    result.kind === "repository" ? result.status : ""
  ]
    .join(" ")
    .toLowerCase();

  return searchable.includes(query);
}

function formatTargetStatus(
  snapshot: RepositoryStatusSnapshotDto | undefined
): string {
  if (!snapshot) {
    return "未读取";
  }
  if (snapshot.error) {
    return "读取失败";
  }

  const changes = getSnapshotChangeCount(snapshot);
  if (changes > 0) {
    return `${changes} 项变更`;
  }

  const sync = [
    snapshot.ahead > 0 ? `↑${snapshot.ahead}` : "",
    snapshot.behind > 0 ? `↓${snapshot.behind}` : ""
  ].filter(Boolean);
  if (sync.length > 0) {
    return sync.join(" ");
  }

  if (snapshot.refreshPending || snapshot.stale) {
    return "待刷新";
  }

  return "干净";
}

function getResultElementId(index: number): string {
  return `global-search-result-${index}`;
}
