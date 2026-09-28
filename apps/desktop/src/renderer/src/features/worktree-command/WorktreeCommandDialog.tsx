import { Button } from "../../shared/ui/Button";

import type {
  WorkspaceDetailsDto,
  WorktreeCommandDto,
  WorktreeCommandPreflightDto
} from "@gitnest/contracts";

import { resolveWorkspaceTarget } from "../../entities/workspace/model";
import { Dialog } from "../../shared/ui/Dialog";
import { Icon } from "../../shared/ui/Icon";
import { worktreeCommandLabel } from "./useWorktreeCommands";

interface WorktreeCommandDialogProps {
  preflight:
    | WorktreeCommandPreflightDto
    | readonly WorktreeCommandPreflightDto[];
  workspace: WorkspaceDetailsDto | null;
  active: WorktreeCommandDto["type"] | null;
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
  const preflights = Array.isArray(preflight)
    ? preflight
    : [preflight];
  const primaryPreflight = preflights[0];
  if (!primaryPreflight) {
    return null;
  }
  const impacts = preflights.flatMap(
    (candidate) => candidate.impacts
  );
  const warnings = [
    ...new Map(
      preflights
        .flatMap((candidate) => candidate.warnings)
        .map((warning) => [
          `${warning.code}:${warning.severity}:${warning.message}`,
          warning
        ])
    ).values()
  ];
  const dangerous = warnings.some(
    (warning) => warning.severity === "danger"
  );
  const busy = active !== null;
  const batchType = preflights.every(
    (candidate) =>
      candidate.command.type ===
      primaryPreflight.command.type
  )
    ? primaryPreflight.command.type
    : null;
  const targetSummary =
    preflights.length === 1
      ? primaryPreflight.targetSummary
      : batchType === "prune"
        ? `${preflights.length} 个仓库，共 ${impacts.length} 条失效登记`
        : batchType === "remove"
          ? `${preflights.length} 个 Worktree 目录与 Git 登记`
          : `${preflights.length} 个 Worktree 操作`;

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
              ? "正在提交…"
              : batchType === "remove"
                ? preflights.length === 1
                  ? "确认删除 Worktree"
                  : `确认删除 ${preflights.length} 个 Worktree`
                : "确认并执行"}
          </Button>
        </>
      }
      icon={dangerous ? "warning" : "worktree"}
      onDismiss={onCancel}
      size="complex"
      title={worktreeCommandLabel(primaryPreflight.command.type)}
      tone={dangerous ? "danger" : "default"}
    >
      <div
        className="command-dialog-summary"
        id="worktree-command-dialog-description"
      >
        <span>目标</span>
        <strong>{targetSummary}</strong>
        <small>
          预检有效至 {formatExpiry(earliestExpiry(preflights))}
        </small>
      </div>

      <section>
        <h3>精确影响范围</h3>
        <div className="command-impact-list">
          {impacts.map((impact, index) => {
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

      {warnings.length > 0 && (
        <section>
          <h3>提示与风险</h3>
          <div className="command-warning-list">
            {warnings.map((warning, index) => (
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

function earliestExpiry(
  preflights: readonly WorktreeCommandPreflightDto[]
): string {
  return preflights.reduce((earliest, candidate) => {
    const earliestTime = Date.parse(earliest);
    const candidateTime = Date.parse(candidate.expiresAt);
    if (!Number.isFinite(earliestTime)) {
      return candidate.expiresAt;
    }
    return Number.isFinite(candidateTime) &&
      candidateTime < earliestTime
      ? candidate.expiresAt
      : earliest;
  }, preflights[0]?.expiresAt ?? "");
}
