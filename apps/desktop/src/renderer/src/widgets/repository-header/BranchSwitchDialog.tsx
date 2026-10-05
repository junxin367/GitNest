import { Button } from "../../shared/ui/Button";
import type { KeyboardEvent } from "react";

import type { BranchDto } from "@gitnest/contracts";

import { Dialog } from "../../shared/ui/Dialog";
import { Icon } from "../../shared/ui/Icon";
import {
  Skeleton,
  SkeletonBoundary
} from "../../shared/ui/Skeleton";

interface BranchSwitchDialogProps {
  branches: BranchDto[];
  currentBranch: string;
  errorMessage: string | null;
  loading: boolean;
  hasLoaded: boolean;
  isDisabled(branch: BranchDto): boolean;
  onCancel(): void;
  onRetry(): void;
  onSelect(branch: string): void;
}

export function BranchSwitchDialog({
  branches,
  currentBranch,
  errorMessage,
  loading,
  hasLoaded,
  isDisabled,
  onCancel,
  onRetry,
  onSelect
}: BranchSwitchDialogProps) {
  const firstSelectable = branches.find(
    (branch) =>
      branch.name !== currentBranch && !isDisabled(branch)
  );

  return (
    <Dialog
      bodyClassName="branch-switch-dialog-body"
      closeLabel="关闭切换分支弹窗"
      footer={
        <Button
          data-modal-initial-focus={
            firstSelectable ? undefined : "true"
          }
          onClick={onCancel}
          size="small"
          type="button"
        >
          取消
        </Button>
      }
      icon="branch"
      onDismiss={onCancel}
      showCloseButton
      size="compact"
      title="切换分支"
    >
      <div className="branch-switch-dialog-heading">
        <h3>本地分支</h3>
        <span>{branches.length} 条</span>
      </div>

      <SkeletonBoundary
        fallback={<BranchSwitchListSkeleton />}
        hasContent={hasLoaded}
        label="正在读取分支"
        loading={loading}
        surfaceClassName="branch-switch-list-skeleton"
      >
        {errorMessage && branches.length > 0 ? (
          <div className="branch-switch-refresh-error" role="alert">
            <Icon name="warning" size={16} />
            <span>{errorMessage}</span>
            <Button onClick={onRetry} size="small" type="button">
              重试
            </Button>
          </div>
        ) : null}
        {errorMessage && branches.length === 0 ? (
          <div className="branch-switch-dialog-state error">
            <Icon name="warning" size={18} />
            <span>{errorMessage}</span>
            <Button
              onClick={onRetry}
              size="small"
              type="button"
            >
              重试
            </Button>
          </div>
        ) : branches.length === 0 ? (
          <div className="branch-switch-dialog-state">
            <Icon name="branch" size={18} />
            <span>暂无可切换的本地分支。</span>
          </div>
        ) : (
          <div
            aria-label="本地分支列表"
            className="branch-switch-list"
            onKeyDown={navigateBranchOptions}
            role="listbox"
          >
            {branches.map((branch) => {
              const occupiedElsewhere = isDisabled(branch);
              const current =
                branch.name === currentBranch ||
                branch.current;
              const disabled = current || occupiedElsewhere;

              return (
                <Button
                  aria-selected={current}
                  className={`branch-switch-option${
                    current ? " current" : ""
                  }`}
                  data-modal-initial-focus={
                    branch === firstSelectable
                      ? "true"
                      : undefined
                  }
                  disabled={disabled}
                  key={branch.fullName}
                  onClick={() => onSelect(branch.name)}
                  role="option"
                  title={
                    occupiedElsewhere
                      ? "该分支已被其他 Worktree 检出"
                      : current
                        ? "当前分支"
                        : "切换前会执行安全预检"
                  }
                  type="button"
                  variant="unstyled"
                >
                  <span className="branch-switch-option-main">
                    <Icon
                      name={current ? "check" : "branch"}
                      size={16}
                    />
                    <span>
                      <strong>{branch.name}</strong>
                      <small>
                        {branch.upstream
                          ? `跟踪 ${branch.upstream}`
                          : "未配置上游"}
                      </small>
                    </span>
                  </span>
                  <span
                    className={`branch-switch-option-status${
                      occupiedElsewhere ? " warning" : ""
                    }`}
                  >
                    {current
                      ? "当前"
                      : occupiedElsewhere
                        ? "被占用"
                        : "切换"}
                  </span>
                </Button>
              );
            })}
          </div>
        )}
      </SkeletonBoundary>
    </Dialog>
  );
}

function navigateBranchOptions(event: KeyboardEvent<HTMLDivElement>) {
  if (
    !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) ||
    event.nativeEvent.isComposing
  ) {
    return;
  }
  const options = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>(
      'button[role="option"]:not(:disabled)'
    )
  );
  if (options.length === 0) {
    return;
  }
  event.preventDefault();
  const current = options.indexOf(
    event.currentTarget.ownerDocument.activeElement as HTMLButtonElement
  );
  const next = event.key === "Home"
    ? 0
    : event.key === "End"
      ? options.length - 1
      : event.key === "ArrowDown"
        ? Math.min(current + 1, options.length - 1)
        : Math.max(current - 1, 0);
  options[next]?.focus();
}

function BranchSwitchListSkeleton() {
  return (
    <div className="branch-switch-list-skeleton-rows">
      {Array.from({ length: 4 }, (_, index) => (
        <div className="branch-switch-list-skeleton-row" key={index}>
          <Skeleton height={18} variant="circle" width={18} />
          <div className="gn-skeleton-row-copy">
            <Skeleton height={10} />
            <Skeleton height={8} variant="text" />
          </div>
          <Skeleton height={18} width={52} />
        </div>
      ))}
    </div>
  );
}
