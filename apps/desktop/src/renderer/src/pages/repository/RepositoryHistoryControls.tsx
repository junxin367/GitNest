import {
  useEffect,
  useRef,
  useState
} from "react";

import type {
  BranchDto,
  RepositoryHistoryFilterDto,
  RepositoryHistoryScopeDto
} from "@gitnest/contracts";

import { Button } from "../../shared/ui/Button";
import { Icon } from "../../shared/ui/Icon";
import { Input } from "../../shared/ui/Input";
import {
  MenuHeading,
  MenuItem,
  MenuPopover,
  MenuSeparator
} from "../../shared/ui/Menu";

const ALL_HISTORY_REF = "all";

export function HistorySearchControls({
  search,
  onSearch,
  onClose
}: {
  search: RepositoryHistoryFilterDto | null;
  onSearch(search: RepositoryHistoryFilterDto | null): void;
  onClose(): void;
}) {
  const [draft, setDraft] = useState(search?.keyword ?? search?.author ?? "");
  return (
    <form
      aria-label="搜索完整提交历史"
      className="history-search-form"
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
      onSubmit={(event) => {
        event.preventDefault();
        const keyword = draft.trim();
        onSearch(keyword ? { keyword } : null);
      }}
    >
      <Input
        aria-label="筛选提交历史"
        autoFocus
        fieldClassName="history-search-field"
        maxLength={4096}
        leading={<Icon name="search" size={14} />}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="搜索提交说明、作者或邮箱"
        size="small"
        value={draft}
      />
      <div className="history-search-actions">
        <Button type="submit" size="small">搜索历史</Button>
        <Button type="button" size="small" onClick={() => {
          setDraft("");
          onSearch(null);
        }}>清除条件</Button>
      </div>
      <p className="history-search-hint">搜索所选引用的完整历史，匹配提交说明、作者或邮箱。</p>
    </form>
  );
}

interface HistoryScopeControlsProps {
  branches: BranchDto[];
  currentBranchName: string | undefined;
  loading: boolean;
  scope: RepositoryHistoryScopeDto | null;
  onChange(scope: RepositoryHistoryScopeDto | null): void;
}

export function HistoryScopeControls({
  branches,
  currentBranchName,
  loading,
  scope,
  onChange
}: HistoryScopeControlsProps) {
  const currentBranch =
    branches.find((branch) => branch.current) ??
    branches.find(
      (branch) =>
        !branch.remote && branch.name === currentBranchName
    );
  const selectedSingleRef =
    scope?.kind === "all"
      ? ALL_HISTORY_REF
      : scope?.kind === "ref"
        ? scope.ref
        : currentBranch?.fullName ?? "";
  const selectedSingleBranch = branches.find(
    (branch) => branch.fullName === selectedSingleRef
  );
  return (
    <div
      className="history-scope-controls"
      aria-label="选择提交历史范围"
    >
      <HistoryRefPicker
        branches={branches}
        label="查看"
        loading={loading}
        onChange={(ref) =>
          onChange(ref === ALL_HISTORY_REF ? { kind: "all" } : { kind: "ref", ref })
        }
        selectedRef={selectedSingleRef}
        selectedName={
          scope?.kind === "all"
            ? "Show All"
            : selectedSingleBranch?.name ??
              currentBranchName ??
              "当前分支"
        }
      />
    </div>
  );
}

interface HistoryRefPickerProps {
  branches: BranchDto[];
  label: string;
  loading: boolean;
  selectedRef: string;
  selectedName?: string;
  onChange(ref: string): void;
}

type HistoryRefGroup = "local" | "remote";

interface HistoryRefBranch {
  fullName: string;
  merged?: boolean;
  name: string;
  remote: boolean;
  upstream?: string | null;
}

interface HistoryRefFilterOptions {
  selectedRef?: string;
  showMergedRemote?: boolean;
}

export function groupHistoryRefBranches<
  TBranch extends HistoryRefBranch
>(
  branches: TBranch[],
  query: string,
  activeGroup: HistoryRefGroup,
  {
    selectedRef = "",
    showMergedRemote = false
  }: HistoryRefFilterOptions = {}
) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matches = normalizedQuery
    ? branches.filter((branch) =>
        [
          branch.name,
          branch.fullName,
          branch.upstream ?? ""
        ].some((value) =>
          value
            .toLocaleLowerCase()
            .includes(normalizedQuery)
        )
      )
    : branches;
  const searching = normalizedQuery.length > 0;
  const localBranchCount = branches.filter(
    (branch) => !branch.remote
  ).length;
  const remoteBranchCount = branches.filter(
    (branch) => branch.remote
  ).length;
  const remoteMatches = matches.filter(
    (branch) => branch.remote
  );
  const mergedRemoteCount = branches.filter(
    (branch) =>
      branch.remote &&
      branch.merged === true &&
      branch.fullName !== selectedRef
  ).length;

  return {
    localBranchCount,
    localBranches:
      searching || activeGroup === "local"
        ? matches.filter((branch) => !branch.remote)
        : [],
    mergedRemoteCount,
    remoteBranchCount,
    remoteBranches:
      searching || activeGroup === "remote"
        ? remoteMatches.filter(
            (branch) =>
              searching ||
              showMergedRemote ||
              branch.merged !== true ||
              branch.fullName === selectedRef
          )
        : [],
    searching
  };
}

export function historyRefOptionClassName(
  selected: boolean
) {
  return selected
    ? "history-ref-option is-selected"
    : "history-ref-option";
}

function HistoryRefPicker({
  branches,
  label,
  loading,
  selectedRef,
  selectedName,
  onChange
}: HistoryRefPickerProps) {
  const [anchor, setAnchor] =
    useState<HTMLButtonElement | null>(null);
  const [activeGroup, setActiveGroup] =
    useState<HistoryRefGroup>("local");
  const [query, setQuery] = useState("");
  const [showMergedRemote, setShowMergedRemote] =
    useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const {
    localBranchCount,
    localBranches,
    mergedRemoteCount,
    remoteBranchCount,
    remoteBranches,
    searching
  } = groupHistoryRefBranches(
    branches,
    query,
    activeGroup,
    {
      selectedRef,
      showMergedRemote
    }
  );
  const visibleBranchCount =
    localBranches.length + remoteBranches.length;
  const selected = branches.find(
    (branch) => branch.fullName === selectedRef
  );

  useEffect(() => {
    if (!anchor) {
      return;
    }
    const closeForPointer = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (anchor.contains(target) ||
          menuRef.current?.contains(target))
      ) {
        return;
      }
      setAnchor(null);
      setQuery("");
    };
    const closeForEscape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.isComposing ||
        event.keyCode === 229
      ) {
        return;
      }
      event.preventDefault();
      setAnchor(null);
      setQuery("");
      anchor.focus();
    };
    document.addEventListener("pointerdown", closeForPointer);
    document.addEventListener("keydown", closeForEscape);
    return () => {
      document.removeEventListener(
        "pointerdown",
        closeForPointer
      );
      document.removeEventListener(
        "keydown",
        closeForEscape
      );
    };
  }, [anchor]);

  const selectRef = (ref: string) => {
    onChange(ref);
    setAnchor(null);
    setQuery("");
    anchor?.focus();
  };
  const renderGroup = (
    heading: string,
    items: BranchDto[]
  ) =>
    items.length ? (
      <>
        {searching && <MenuHeading>{heading}</MenuHeading>}
        {items.map((branch) => (
          <MenuItem
            aria-checked={
              branch.fullName === selectedRef
            }
            className={historyRefOptionClassName(
              branch.fullName === selectedRef
            )}
            key={branch.fullName}
            leading={<Icon name="branch" size={14} />}
            onClick={() => selectRef(branch.fullName)}
            role="menuitemradio"
            title={branch.fullName}
          >
            <span className="history-ref-option-copy">
              <strong>{branch.name}</strong>
              {!branch.remote && branch.upstream && (
                <small>跟踪 {branch.upstream}</small>
              )}
            </span>
          </MenuItem>
        ))}
      </>
    ) : null;

  return (
    <div className="history-ref-picker">
      <span className="history-ref-picker-label">{label}</span>
      <Button
        aria-expanded={Boolean(anchor)}
        aria-haspopup="menu"
        className="history-ref-trigger"
        disabled={loading && branches.length === 0}
        onClick={(event) => {
          const nextAnchor = anchor
            ? null
            : event.currentTarget;
          setAnchor(nextAnchor);
          setQuery("");
          if (nextAnchor) {
            setActiveGroup("local");
            setShowMergedRemote(false);
          }
        }}
        size="small"
        title={
          selected?.remote
            ? `${selected.name} · 本地远程引用快照`
            : selected?.fullName ?? selectedName
        }
        type="button"
      >
        <Icon name={selectedRef === ALL_HISTORY_REF ? "graph" : "branch"} size={13} />
        <span>
          {selected?.name ??
            selectedName ??
            (loading ? "读取分支…" : "选择分支")}
        </span>
        <Icon name="chevron" size={12} />
      </Button>
      {anchor && (
        <MenuPopover
          align="start"
          anchor={anchor}
          autoFocus
          aria-label={`${label}分支`}
          className="history-ref-menu"
          ref={menuRef}
          side="bottom"
        >
          <div className="history-ref-menu-header">
            <Input
              appearance="unstyled"
              aria-label={`搜索${label}分支`}
              data-menu-initial-focus
              className="history-ref-search"
              onChange={(event) =>
                setQuery(event.target.value)
              }
              placeholder="搜索本地或远程分支"
              value={query}
            />
            <div className="history-ref-breadcrumb-row">
              <div
                aria-label="分支类型"
                className="history-ref-breadcrumb"
                role="tablist"
              >
                <button
                  aria-selected={activeGroup === "local"}
                  className={
                    activeGroup === "local"
                      ? "is-active"
                      : undefined
                  }
                  onClick={() => {
                    setActiveGroup("local");
                    setQuery("");
                  }}
                  role="tab"
                  type="button"
                >
                  <span>本地分支</span>
                  <span className="history-ref-count">
                    {localBranchCount}
                  </span>
                </button>
                <span aria-hidden="true">/</span>
                <button
                  aria-selected={activeGroup === "remote"}
                  className={
                    activeGroup === "remote"
                      ? "is-active"
                      : undefined
                  }
                  onClick={() => {
                    setActiveGroup("remote");
                    setQuery("");
                  }}
                  role="tab"
                  type="button"
                >
                  <span>远程分支</span>
                  <span className="history-ref-count">
                    {remoteBranchCount}
                  </span>
                </button>
              </div>
              {activeGroup === "remote" &&
                !searching &&
                mergedRemoteCount > 0 && (
                  <button
                    aria-pressed={showMergedRemote}
                    className="history-ref-merged-toggle"
                    onClick={() =>
                      setShowMergedRemote(
                        (current) => !current
                      )
                    }
                    type="button"
                  >
                    {showMergedRemote
                      ? "隐藏已合并"
                      : `显示已合并 ${mergedRemoteCount}`}
                  </button>
                )}
            </div>
          </div>
          <div className="history-ref-menu-list">
            {!searching && (
              <>
                <MenuItem
                  aria-checked={selectedRef === ALL_HISTORY_REF}
                  className={historyRefOptionClassName(selectedRef === ALL_HISTORY_REF)}
                  leading={<Icon name="graph" size={14} />}
                  onClick={() => selectRef(ALL_HISTORY_REF)}
                  role="menuitemradio"
                  title="显示全部本地、远程分支、标签及暂存历史"
                >
                  <span className="history-ref-option-copy">
                    <strong>Show All</strong>
                    <small>全部分支与 stash</small>
                  </span>
                </MenuItem>
                <MenuSeparator />
              </>
            )}
            {renderGroup("本地分支", localBranches)}
            {searching &&
              localBranches.length > 0 &&
              remoteBranches.length > 0 && <MenuSeparator />}
            {renderGroup("远程分支", remoteBranches)}
            {visibleBranchCount === 0 && (
              <span className="history-ref-empty">
                没有匹配的分支
              </span>
            )}
          </div>
        </MenuPopover>
      )}
    </div>
  );
}
