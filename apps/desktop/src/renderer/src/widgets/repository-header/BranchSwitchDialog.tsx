import { useEffect, useRef } from "react";

import type { BranchDto } from "@gitnest/contracts";

import { Icon } from "../../shared/ui/Icon";
import { LayerPortal } from "../../shared/ui/LayerPortal";
import { useModalFocusTrap } from "../../shared/ui/useModalFocusTrap";

interface BranchSwitchDialogProps {
  branches: BranchDto[];
  currentBranch: string;
  errorMessage: string | null;
  loading: boolean;
  repositoryName: string;
  repositoryPath: string;
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
  repositoryName,
  repositoryPath,
  isDisabled,
  onCancel,
  onRetry,
  onSelect
}: BranchSwitchDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  useModalFocusTrap(dialogRef);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () =>
      window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  const firstSelectable = branches.find(
    (branch) =>
      branch.name !== currentBranch && !isDisabled(branch)
  );

  return (
    <LayerPortal>
      <div className="command-dialog-backdrop">
        <section
        aria-describedby="branch-switch-dialog-description"
        aria-labelledby="branch-switch-dialog-title"
        aria-modal="true"
        className="command-dialog branch-switch-dialog"
        ref={dialogRef}
        role="dialog"
      >
        <header className="command-dialog-header">
          <span className="command-dialog-icon">
            <Icon name="branch" size={20} />
          </span>
          <div>
            <span className="eyebrow">当前仓库</span>
            <h2 id="branch-switch-dialog-title">
              切换分支
            </h2>
            <p
              id="branch-switch-dialog-description"
              title={repositoryPath}
            >
              {repositoryName} · {repositoryPath}
            </p>
          </div>
          <button
            aria-label="关闭切换分支弹窗"
            className="toolbar-icon-button branch-switch-dialog-close"
            onClick={onCancel}
            type="button"
          >
            <Icon name="close" />
          </button>
        </header>

        <div className="command-dialog-body branch-switch-dialog-body">
          <div className="branch-switch-dialog-heading">
            <h3>本地分支</h3>
            <span>{branches.length} 条</span>
          </div>

          {loading && branches.length === 0 ? (
            <div className="branch-switch-dialog-state">
              <Icon name="refresh" size={18} />
              <span>正在读取分支…</span>
            </div>
          ) : errorMessage && branches.length === 0 ? (
            <div className="branch-switch-dialog-state error">
              <Icon name="warning" size={18} />
              <span>{errorMessage}</span>
              <button
                className="button small"
                onClick={onRetry}
                type="button"
              >
                重试
              </button>
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
              role="listbox"
            >
              {branches.map((branch) => {
                const occupiedElsewhere = isDisabled(branch);
                const current =
                  branch.name === currentBranch ||
                  branch.current;
                const disabled = current || occupiedElsewhere;

                return (
                  <button
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
                  >
                    <span className="branch-switch-option-main">
                      <Icon name={current ? "check" : "branch"} size={16} />
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
                  </button>
                );
              })}
            </div>
          )}

          <p className="branch-switch-dialog-note">
            切换前会检查工作区脏状态和 Worktree
            占用情况，确认后才会执行 Git 操作。
          </p>
        </div>

        <footer className="command-dialog-footer">
          <p>当前分支不会重复执行切换操作。</p>
          <div>
            <button
              className="button"
              data-modal-initial-focus={
                firstSelectable ? undefined : "true"
              }
              onClick={onCancel}
              type="button"
            >
              取消
            </button>
          </div>
        </footer>
        </section>
      </div>
    </LayerPortal>
  );
}
