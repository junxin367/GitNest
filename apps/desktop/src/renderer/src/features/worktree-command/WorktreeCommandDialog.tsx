import {
  useEffect,
  useRef
} from "react";

import type {
  WorkspaceDetailsDto,
  WorktreeCommandPreflightDto
} from "@gitnest/contracts";

import { resolveWorkspaceTarget } from "../../entities/workspace/model";
import { Icon } from "../../shared/ui/Icon";
import { LayerPortal } from "../../shared/ui/LayerPortal";
import { useModalFocusTrap } from "../../shared/ui/useModalFocusTrap";
import {
  worktreeCommandLabel,
  type WorktreeCommandController
} from "./useWorktreeCommands";

interface WorktreeCommandDialogProps {
  preflight: WorktreeCommandPreflightDto;
  workspace: WorkspaceDetailsDto | null;
  active: WorktreeCommandController["active"];
  onCancel(): void;
  onConfirm(): void;
}

export function WorktreeCommandDialog({
  preflight,
  workspace,
  active,
  onCancel,
  onConfirm
}: WorktreeCommandDialogProps) {
  const dangerous = preflight.warnings.some(
    (warning) => warning.severity === "danger"
  );
  const busy = active !== null;
  const dialogRef = useRef<HTMLElement>(null);
  useModalFocusTrap(dialogRef);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () =>
      window.removeEventListener("keydown", handleKeyDown);
  }, [busy, onCancel]);

  return (
    <LayerPortal>
      <div className="command-dialog-backdrop">
        <section
        aria-describedby="worktree-command-dialog-description"
        aria-labelledby="worktree-command-dialog-title"
        aria-modal="true"
        className={`command-dialog${dangerous ? " danger" : ""}`}
        ref={dialogRef}
        role="dialog"
      >
        <header className="command-dialog-header">
          <span
            className={`command-dialog-icon${
              dangerous ? " danger" : ""
            }`}
          >
            <Icon
              name={dangerous ? "warning" : "worktree"}
              size={20}
            />
          </span>
          <div>
            <span className="eyebrow">
              Worktree 执行前确认
            </span>
            <h2 id="worktree-command-dialog-title">
              {worktreeCommandLabel(preflight.command.type)}
            </h2>
            <p id="worktree-command-dialog-description">
              {preflight.targetSummary} · 预检有效至{" "}
              {formatExpiry(preflight.expiresAt)}
            </p>
          </div>
        </header>

        <div className="command-dialog-body">
          <section>
            <h3>精确影响范围</h3>
            <div className="command-impact-list">
              {preflight.impacts.map((impact, index) => {
                const resolved =
                  workspace &&
                  resolveWorkspaceTarget(
                    workspace,
                    impact.target
                  );
                const name =
                  resolved?.worktree?.name ??
                  resolved?.repository?.name ??
                  impact.target.repositoryId;
                const path =
                  resolved?.worktree?.path ??
                  impact.target.worktreeId;

                return (
                  <article
                    key={`${impact.target.repositoryId}:${impact.target.worktreeId}:${impact.kind}:${index}`}
                  >
                    <div>
                      <strong>{impact.summary}</strong>
                      <span>{name}</span>
                    </div>
                    <code title={path}>{path}</code>
                    <p>{impact.detail}</p>
                  </article>
                );
              })}
            </div>
          </section>

          {preflight.warnings.length > 0 && (
            <section>
              <h3>提示与风险</h3>
              <div className="command-warning-list">
                {preflight.warnings.map((warning, index) => (
                  <div
                    className={`command-warning ${warning.severity}`}
                    key={`${warning.code}:${index}`}
                  >
                    <Icon
                      name={
                        warning.severity === "info"
                          ? "activity"
                          : "warning"
                      }
                      size={14}
                    />
                    <span>{warning.message}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <footer className="command-dialog-footer">
          <p>
            Main 将在入队前和实际执行前重新校验 Git 登记、目录状态与候选集合；任何变化都会使本次确认失效。
          </p>
          <div>
            <button
              className="button"
              data-modal-initial-focus={
                dangerous ? "true" : undefined
              }
              disabled={busy}
              onClick={onCancel}
              type="button"
            >
              取消
            </button>
            <button
              aria-busy={busy}
              className={`button ${
                dangerous ? "danger" : "primary"
              }`}
              data-modal-initial-focus={
                dangerous ? undefined : "true"
              }
              disabled={busy}
              onClick={onConfirm}
              type="button"
            >
              <Icon
                name={
                  busy
                    ? "refresh"
                    : dangerous
                      ? "warning"
                      : "check"
                }
              />
              {busy
                ? "重新校验中…"
                : preflight.command.type === "remove"
                  ? "确认移除 Worktree"
                  : "确认并执行"}
            </button>
          </div>
        </footer>
        </section>
      </div>
    </LayerPortal>
  );
}

function formatExpiry(value: string): string {
  const expiresAt = new Date(value);
  return Number.isNaN(expiresAt.getTime())
    ? "短期内"
    : expiresAt.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      });
}
