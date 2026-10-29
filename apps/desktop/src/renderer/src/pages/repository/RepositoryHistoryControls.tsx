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
  const selectedRefs =
    scope?.kind === "all"
      ? []
      : scope?.kind === "ref"
        ? [scope.ref]
        : scope?.kind === "refs"
          ? scope.refs
          : currentBranch?.fullName
            ? [currentBranch.fullName]
            : [];
  const selectedBranches = branches.filter((candidate) =>
    selectedRefs.includes(candidate.fullName)
  );
  const selectedName =
    scope?.kind === "all"
      ? "Show All"
      : selectedBranches.length === 1
        ? selectedBranches[0]!.name
        : selectedRefs.length > 1
          ? `已选 ${selectedRefs.length} 个分支`
          : currentBranchName ?? "当前分支";
  return (
    <div
      className="history-scope-controls"
      aria-label="选择提交历史范围"
    >
      <HistoryRefPicker
        branches={branches}
        label="查看"
        loading={loading}
        onChange={(refs) => {
          if (refs.length === 0) {
            onChange({ kind: "all" });
          } else if (refs.length === 1) {
            onChange({ kind: "ref", ref: refs[0]! });
          } else {
            onChange({ kind: "refs", refs });
          }
        }}
        selectedRefs={selectedRefs}
        allSelected={scope?.kind === "all"}
        selectedName={selectedName}
      />
    </div>
  );
}

interface HistoryRefPickerProps {
  branches: BranchDto[];
  label: string;
  loading: boolean;
  selectedRefs: string[];
  allSelected: boolean;
  selectedName?: string;
  onChange(refs: string[]): void;
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
  selectedRefs?: readonly string[];
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
    selectedRefs = selectedRef ? [selectedRef] : [],
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
      !selectedRefs.includes(branch.fullName)
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
              selectedRefs.includes(branch.fullName)
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
  selectedRefs,
  allSelected,
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
  const [pendingRefs, setPendingRefs] = useState<string[]>(selectedRefs);
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
      selectedRefs,
      showMergedRemote
    }
  );
  const visibleBranchCount =
    localBranches.length + remoteBranches.length;
  const selected = branches.find(
    (branch) => selectedRefs.includes(branch.fullName)
  );
  const isAllSelected = allSelected;
  const selectedRefsKey = selectedRefs.join("\0");
  const selectedNames = selectedRefs.map(
    (ref) =>
      branches.find((branch) => branch.fullName === ref)?.name ??
      ref
        .replace(/^refs\/heads\//, "")
        .replace(/^refs\/remotes\//, "")
  );
  const selectionDescription = isAllSelected
    ? "显示全部本地、远程分支、标签及 stash"
    : selectedNames.length > 0
      ? `已选分支：${selectedNames.join("、")}`
      : selectedName ?? "选择分支";

  useEffect(() => {
    if (!anchor) {
      setPendingRefs(selectedRefs);
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
      setPendingRefs(selectedRefs);
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
  }, [anchor, selectedRefsKey]);

  const selectRef = (ref: string) => {
    setPendingRefs((current) =>
      current.includes(ref)
        ? current.filter((value) => value !== ref)
        : [...current, ref]
    );
  };
  const applyRefs = () => {
    onChange(pendingRefs);
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
              pendingRefs.includes(branch.fullName)
            }
            className={historyRefOptionClassName(
              pendingRefs.includes(branch.fullName)
            )}
            key={branch.fullName}
            leading={<Icon name="branch" size={14} />}
            onClick={() => selectRef(branch.fullName)}
            role="menuitemcheckbox"
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
        aria-label={`查看提交历史范围：${selectionDescription}`}
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
          selected?.remote && selectedNames.length === 1
            ? `${selectedNames[0]} · 本地远程引用快照`
            : selectionDescription
        }
        type="button"
      >
        <Icon name={isAllSelected ? "graph" : "branch"} size={13} />
        <span>
          {selectedRefs.length === 1 && selected?.name
            ? selected.name
            : selectedName ??
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
                  aria-checked={isAllSelected}
                  className={historyRefOptionClassName(isAllSelected)}
                  leading={<Icon name="graph" size={14} />}
                  onClick={() => {
                    onChange([]);
                    setAnchor(null);
                    setQuery("");
                    anchor?.focus();
                  }}
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
          <div className="history-ref-menu-footer">
            <span className="history-ref-selection-count">
              {pendingRefs.length > 1
                ? `已选择 ${pendingRefs.length} 个分支`
                : pendingRefs.length === 1
                  ? "已选择 1 个分支"
                  : "查看全部引用"}
            </span>
            <Button
              disabled={pendingRefs.length === 0}
              onClick={applyRefs}
              size="small"
              type="button"
            >
              应用
            </Button>
          </div>
        </MenuPopover>
      )}
    </div>
  );
}
