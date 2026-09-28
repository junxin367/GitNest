import { Button } from "../../shared/ui/Button";

import type {
  RepositoryCommandPreflightDto,
  WorkspaceDetailsDto
} from "@gitnest/contracts";

import { resolveWorkspaceTarget } from "../../entities/workspace/model";
import { Dialog } from "../../shared/ui/Dialog";
import { Icon } from "../../shared/ui/Icon";
import {
  repositoryCommandLabel,
  type RepositoryCommandController
} from "./useRepositoryCommands";

interface RepositoryCommandDialogProps {
  preflight: RepositoryCommandPreflightDto;
  workspace: WorkspaceDetailsDto | null;
  active: RepositoryCommandController["active"];
  onCancel(): void;
  onConfirm(): void;
}

export function RepositoryCommandDialog({
  preflight,
  workspace,
  active,
  onCancel,
  onConfirm
}: RepositoryCommandDialogProps) {
  const dangerous = preflight.warnings.some(
    (warning) => warning.severity === "danger"
  );
  const busy = active !== null;

  return (
    <Dialog
      ariaDescribedBy="command-dialog-description"
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
            {busy ? "重新校验中…" : "确认并执行"}
          </Button>
        </>
      }
      icon={dangerous ? "warning" : "operations"}
      onDismiss={onCancel}
      size="complex"
      title={repositoryCommandLabel(preflight.command.type)}
      tone={dangerous ? "danger" : "default"}
    >
      <div
        className="command-dialog-summary"
        id="command-dialog-description"
      >
        <span>目标</span>
        <strong>{preflight.targetSummary}</strong>
        <small>
          预检有效至 {formatExpiry(preflight.expiresAt)}
        </small>
      </div>

      <section>
        <h3>影响范围</h3>
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
          执行前会再次读取仓库与远程状态；如有变化，本次确认将失效。
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
