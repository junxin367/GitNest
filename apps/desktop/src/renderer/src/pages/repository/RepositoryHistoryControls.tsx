import {
  useEffect,
  useRef,
  useState
} from "react";

import type {
  BranchDto,
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

interface HistoryScopeControlsProps {
  branches: BranchDto[];
  currentBranchName: string | undefined;
  loading: boolean;
  scope: RepositoryHistoryScopeDto | null;
  onChange(scope: RepositoryHistoryScopeDto | null): void;
}

type HistoryCompareDraft = {
  leftRef: string;
  rightRef: string;
};

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
    scope?.kind === "ref"
      ? scope.ref
      : currentBranch?.fullName ?? "";
  const selectedSingleBranch = branches.find(
    (branch) => branch.fullName === selectedSingleRef
  );
  const lastSingleScopeRef =
    useRef<RepositoryHistoryScopeDto | null>(null);
  const [compareDraft, setCompareDraft] =
    useState<HistoryCompareDraft | null>(null);

  useEffect(() => {
    if (scope?.kind !== "compare" && !compareDraft) {
      lastSingleScopeRef.current = scope;
    }
  }, [compareDraft, scope]);

  useEffect(() => {
    if (scope?.kind === "compare") {
      setCompareDraft(null);
    }
  }, [scope]);

  const comparison =
    scope?.kind === "compare" ? scope : compareDraft;
  const beginComparison = () => {
    if (!selectedSingleRef) {
      return;
    }
    lastSingleScopeRef.current =
      scope?.kind === "ref" ? scope : null;
    const upstream = selectedSingleBranch?.upstream
      ? branches.find(
          (branch) =>
            branch.name === selectedSingleBranch.upstream
        )
      : undefined;

    if (
      upstream &&
      upstream.fullName !== selectedSingleRef
    ) {
      onChange({
        kind: "compare",
        leftRef: upstream.fullName,
        rightRef: selectedSingleRef
      });
      return;
    }
    setCompareDraft({
      leftRef: "",
      rightRef: selectedSingleRef
    });
  };
  const updateComparison = (
    side: "left" | "right",
    ref: string
  ) => {
    const current = comparison ?? {
      leftRef: "",
      rightRef: selectedSingleRef
    };
    const next = {
      ...current,
      [side === "left" ? "leftRef" : "rightRef"]: ref
    };

    if (
      next.leftRef &&
      next.rightRef &&
      next.leftRef !== next.rightRef
    ) {
      setCompareDraft(null);
      onChange({
        kind: "compare",
        leftRef: next.leftRef,
        rightRef: next.rightRef
      });
      return;
    }
    setCompareDraft(next);
  };
  const leaveComparison = () => {
    setCompareDraft(null);
    onChange(lastSingleScopeRef.current);
  };

  if (comparison) {
    return (
      <div
        className="history-scope-controls comparison"
        aria-label="比较分支提交历史"
      >
        <HistoryRefPicker
          branches={branches}
          disabledRef={comparison.rightRef}
          label="基准"
          loading={loading}
          onChange={(ref) =>
            updateComparison("left", ref)
          }
          selectedRef={comparison.leftRef}
        />
        <HistoryRefPicker
          branches={branches}
          disabledRef={comparison.leftRef}
          label="目标"
          loading={loading}
          onChange={(ref) =>
            updateComparison("right", ref)
          }
          selectedRef={comparison.rightRef}
        />
        <Button
          className="history-compare-exit"
          onClick={leaveComparison}
          size="small"
          type="button"
        >
          退出比较
        </Button>
      </div>
    );
  }

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
          onChange({ kind: "ref", ref })
        }
        selectedRef={selectedSingleRef}
        selectedName={
          selectedSingleBranch?.name ??
          currentBranchName ??
          "当前分支"
        }
      />
      <Button
        disabled={loading || branches.length < 2}
        onClick={beginComparison}
        size="small"
        title="比较两个本地或远程跟踪分支的差异提交"
        type="button"
      >
        <Icon name="diff" size={13} />
        比较
      </Button>
    </div>
  );
}

interface HistoryRefPickerProps {
  branches: BranchDto[];
  disabledRef?: string;
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
  disabledRef,
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
      if (event.key !== "Escape") {
        return;
      }
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
            disabled={branch.fullName === disabledRef}
            key={branch.fullName}
            leading={<Icon name="branch" size={14} />}
            onClick={() => selectRef(branch.fullName)}
            role="menuitemradio"
            title={
              branch.fullName === disabledRef
                ? "比较范围不能选择同一个分支"
                : branch.fullName
            }
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
        <Icon name="branch" size={13} />
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
          aria-label={`${label}分支`}
          className="history-ref-menu"
          ref={menuRef}
          side="bottom"
        >
          <div className="history-ref-menu-header">
            <Input
              appearance="unstyled"
              aria-label={`搜索${label}分支`}
              autoFocus
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
        </MenuPopover>
      )}
    </div>
  );
}
