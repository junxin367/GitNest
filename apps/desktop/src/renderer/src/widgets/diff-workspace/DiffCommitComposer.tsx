import { Button } from "../../shared/ui/Button";
import {
  useId,
  type FormEvent
} from "react";

import { Icon } from "../../shared/ui/Icon";
import { Textarea } from "../../shared/ui/Textarea";

export interface DiffWorkspaceCommit {
  message: string;
  push: boolean;
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
  busy: boolean;
  submitting: boolean;
  onMessageChange(value: string): void;
  onPushChange(value: boolean): void;
  onSubmit(
    message: string,
    push: boolean
  ): void | Promise<void>;
}

interface DiffCommitComposerProps extends DiffWorkspaceCommit {
  showPush: boolean;
}

export function DiffCommitComposer({
  message,
  push,
  staged,
  unstaged,
  untracked,
  conflicted,
  busy,
  submitting,
  onMessageChange,
  onPushChange,
  onSubmit,
  showPush
}: DiffCommitComposerProps) {
  const pushId = useId();
  const hasChanges = staged + unstaged + untracked > 0;
  const canCommit =
    hasChanges &&
    conflicted === 0 &&
    Boolean(parseCommitMessage(message).subject) &&
    !busy;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (canCommit) {
      void onSubmit(message, push);
    }
  };

  return (
    <article className="diff-workspace-commit">
      <header className="diff-workspace-commit-header">
        {showPush ? (
          <label
            className="diff-workspace-commit-push"
            htmlFor={pushId}
          >
            <input
              checked={push}
              disabled={busy}
              id={pushId}
              name="push-after-commit"
              onChange={(event) =>
                onPushChange(event.target.checked)
              }
              type="checkbox"
            />
            <span>推送到远程</span>
          </label>
        ) : null}
        <span
          className={`status-pill ${
            conflicted > 0
              ? "red"
              : staged > 0
                ? "green"
                : "neutral"
          }`}
        >
          {conflicted > 0
            ? `${conflicted} 个冲突`
            : `${staged} 个已暂存`}
        </span>
      </header>
      <form className="diff-workspace-commit-form" onSubmit={submit}>
        <Textarea
          aria-label="提交信息"
          autoComplete="off"
          disabled={busy}
          fullWidth
          maxLength={100_000}
          name="commit-message"
          onChange={(event) =>
            onMessageChange(event.target.value)
          }
          placeholder="输入提交信息…"
          rows={3}
          size="small"
          textareaClassName="diff-workspace-commit-message"
          value={message}
        />
        <Button size="small" variant="primary"
          aria-busy={submitting}
          disabled={!canCommit}
          type="submit"
        >
          <Icon name={submitting ? "refresh" : "check"} />
          {submitting
            ? "提交中…"
            : staged > 0
              ? "提交已暂存变更"
              : "提交全部变更"}
        </Button>
      </form>
    </article>
  );
}

export function parseCommitMessage(message: string): {
  subject: string;
  body: string;
} {
  const [subject = "", ...bodyLines] = message
    .replace(/\r\n/g, "\n")
    .split("\n");
  return {
    subject: subject.trim(),
    body: bodyLines.join("\n").trim()
  };
}
