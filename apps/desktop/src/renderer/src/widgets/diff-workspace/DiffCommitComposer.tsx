import {
  DEFAULT_DIFF_COMMIT_PANEL_HEIGHT,
  MAX_DIFF_COMMIT_PANEL_HEIGHT,
  MIN_DIFF_COMMIT_PANEL_HEIGHT
} from "@gitnest/contracts";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent
} from "react";

import { Button } from "../../shared/ui/Button";
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
  commitPanelHeight?: number | undefined;
  onMessageChange(value: string): void;
  onPushChange(value: boolean): void;
  onCommitPanelHeightChange?(
    value: number
  ): void | Promise<void>;
  onSubmit(
    message: string,
    push: boolean
  ): void | Promise<void>;
  ai?: {
    enabled: boolean;
    busy: boolean;
    disabled?: boolean | undefined;
    title?: string | undefined;
    onGenerate(): void | Promise<void>;
  };
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
  ai,
  showPush,
  commitPanelHeight,
  onCommitPanelHeightChange
}: DiffCommitComposerProps) {
  const pushId = useId();
  const hasChanges = staged + unstaged + untracked > 0;
  const hasCommitScope =
    staged > 0 || unstaged + untracked > 0;
  const canCommit =
    hasChanges &&
    conflicted === 0 &&
    Boolean(parseCommitMessage(message).subject) &&
    !busy;
  const [panelHeight, setPanelHeight] = useState(() =>
    clampCommitPanelHeight(commitPanelHeight)
  );
  const panelHeightRef = useRef(panelHeight);
  const resizeDragRef = useRef<{
    pointerId: number;
    startY: number;
    startHeight: number;
  } | null>(null);
  const [resizing, setResizing] = useState(false);

  useEffect(() => {
    if (resizeDragRef.current) {
      return;
    }
    const nextHeight = clampCommitPanelHeight(
      commitPanelHeight
    );
    panelHeightRef.current = nextHeight;
    setPanelHeight((current) =>
      current === nextHeight ? current : nextHeight
    );
  }, [commitPanelHeight]);

  const persistPanelHeight = useCallback(
    (nextHeight: number) => {
      const normalizedHeight =
        clampCommitPanelHeight(nextHeight);
      panelHeightRef.current = normalizedHeight;
      setPanelHeight(normalizedHeight);
      void onCommitPanelHeightChange?.(normalizedHeight);
    },
    [onCommitPanelHeightChange]
  );

  const onResizePointerDown = (
    event: PointerEvent<HTMLDivElement>
  ) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    resizeDragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: panelHeightRef.current
    };
    setResizing(true);
  };

  const onResizePointerMove = (
    event: PointerEvent<HTMLDivElement>
  ) => {
    const drag = resizeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    const nextHeight = clampCommitPanelHeight(
      drag.startHeight + drag.startY - event.clientY
    );
    if (nextHeight !== panelHeightRef.current) {
      panelHeightRef.current = nextHeight;
      setPanelHeight(nextHeight);
    }
  };

  const finishResize = (
    event?: PointerEvent<HTMLDivElement>
  ) => {
    const drag = resizeDragRef.current;
    if (!drag) {
      return;
    }
    if (
      event &&
      typeof event.currentTarget.releasePointerCapture ===
        "function" &&
      event.currentTarget.hasPointerCapture?.(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    resizeDragRef.current = null;
    setResizing(false);
    if (panelHeightRef.current !== drag.startHeight) {
      void onCommitPanelHeightChange?.(panelHeightRef.current);
    }
  };

  const onResizeKeyDown = (
    event: KeyboardEvent<HTMLDivElement>
  ) => {
    const increment =
      event.key === "ArrowUp"
        ? 8
        : event.key === "ArrowDown"
          ? -8
          : event.key === "PageUp"
            ? 40
            : event.key === "PageDown"
              ? -40
              : 0;
    if (increment === 0) {
      if (event.key === "Home") {
        event.preventDefault();
        persistPanelHeight(MIN_DIFF_COMMIT_PANEL_HEIGHT);
      } else if (event.key === "End") {
        event.preventDefault();
        persistPanelHeight(MAX_DIFF_COMMIT_PANEL_HEIGHT);
      }
      return;
    }
    event.preventDefault();
    persistPanelHeight(panelHeightRef.current + increment);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (canCommit) {
      void onSubmit(message, push);
    }
  };

  return (
    <article
      className={[
        "diff-workspace-commit",
        resizing ? "is-resizing" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ height: panelHeight }}
    >
      <div
        aria-label="调整提交区域高度"
        aria-orientation="horizontal"
        aria-valuemax={MAX_DIFF_COMMIT_PANEL_HEIGHT}
        aria-valuemin={MIN_DIFF_COMMIT_PANEL_HEIGHT}
        aria-valuenow={panelHeight}
        className="diff-workspace-commit-resizer"
        onKeyDown={onResizeKeyDown}
        onPointerCancel={finishResize}
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={finishResize}
        role="separator"
        tabIndex={0}
        title="拖动调整提交区域高度"
      >
        <span aria-hidden="true" />
      </div>
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
        <div className="diff-workspace-commit-form-actions">
          {ai ? (
            <Button
              aria-label="使用 AI 生成提交信息"
              aria-busy={ai.busy}
              className="diff-workspace-commit-ai"
              disabled={
                !ai.enabled ||
                ai.busy ||
                ai.disabled ||
                !hasCommitScope ||
                busy
              }
              icon={
                <Icon
                  name={ai.busy ? "refresh" : "sparkle"}
                />
              }
              iconOnly
              onClick={() => void ai.onGenerate()}
              size="small"
              title={
                !ai.enabled
                  ? "请先在设置中启用 AI 提交信息"
                  : !hasCommitScope
                    ? "没有可提交的变更"
                    : ai.title ??
                      "根据当前提交范围生成提交信息"
                }
              type="button"
            />
          ) : null}
          <Button
            aria-busy={submitting}
            className="diff-workspace-commit-submit"
            disabled={!canCommit}
            fullWidth
            size="small"
            type="submit"
            variant="primary"
          >
            <Icon name={submitting ? "refresh" : "check"} />
            {submitting
              ? "提交中…"
              : staged > 0
                ? "提交已暂存变更"
                : "提交全部变更"}
          </Button>
        </div>
      </form>
    </article>
  );
}

function clampCommitPanelHeight(
  value: number | undefined
): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_DIFF_COMMIT_PANEL_HEIGHT;
  }
  return Math.min(
    MAX_DIFF_COMMIT_PANEL_HEIGHT,
    Math.max(
      MIN_DIFF_COMMIT_PANEL_HEIGHT,
      Math.round(value as number)
    )
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
