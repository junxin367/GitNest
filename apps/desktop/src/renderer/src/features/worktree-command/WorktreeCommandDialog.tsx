import { Button } from "../../shared/ui/Button";

import type {
  WorkspaceDetailsDto,
  WorktreeCommandPreflightDto
} from "@gitnest/contracts";

import { resolveWorkspaceTarget } from "../../entities/workspace/model";
import { Dialog } from "../../shared/ui/Dialog";
import { Icon } from "../../shared/ui/Icon";
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

  return (
    <Dialog
      ariaDescribedBy="worktree-command-dialog-description"
      dismissDisabled={busy}
      footer={
        <>
          <Button
            data-modal-initial-focus={
              dangerous ? "true" : undefined
            }
            disabled={busy}
            onClick={onCancel}
            size="small"
            type="button"
          >
            取消
          </Button>
          <Button
            aria-busy={busy}
            data-modal-initial-focus={
              dangerous ? undefined : "true"
            }
            disabled={busy}
            {...(dangerous
              ? { emphasis: "strong" as const }
              : {})}
            icon={
              <Icon
                name={
                  busy
                    ? "refresh"
                    : dangerous
                      ? "warning"
                      : "check"
                }
              />
            }
            onClick={onConfirm}
            size="small"
            type="button"
            variant={dangerous ? "danger" : "primary"}
          >
            {busy
              ? "重新校验中…"
              : preflight.command.type === "remove"
                ? "确认移除 Worktree"
                : "确认并执行"}
          </Button>
        </>
      }
      icon={dangerous ? "warning" : "worktree"}
      onDismiss={onCancel}
      size="complex"
      title={worktreeCommandLabel(preflight.command.type)}
      tone={dangerous ? "danger" : "default"}
    >
      <div
        className="command-dialog-summary"
        id="worktree-command-dialog-description"
      >
        <span>目标</span>
        <strong>{preflight.targetSummary}</strong>
        <small>
          预检有效至 {formatExpiry(preflight.expiresAt)}
        </small>
      </div>

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

      <div className="command-warning">
        <Icon name="activity" size={14} />
        <span>
          入队前和实际执行前会重新校验 Git
          登记、目录状态与候选集合；任何变化都会使本次确认失效。
        </span>
      </div>
    </Dialog>
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
