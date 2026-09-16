import {
  useEffect,
  useId,
  useRef,
  useState
} from "react";

import type { DiffViewerFile } from "../../shared/model/diffViewModel";
import { Button } from "../../shared/ui/Button";
import { Icon } from "../../shared/ui/Icon";
import { LayerPortal } from "../../shared/ui/LayerPortal";
import { useModalFocusTrap } from "../../shared/ui/useModalFocusTrap";

interface DiffDiscardConfirmationDialogProps {
  files: readonly DiffViewerFile[];
  mutationBusy?: boolean | undefined;
  scope: "file" | "group";
  onCancel(): void;
  onConfirm(): void | boolean | Promise<void | boolean>;
}

export function DiffDiscardConfirmationDialog({
  files,
  mutationBusy = false,
  scope,
  onCancel,
  onConfirm
}: DiffDiscardConfirmationDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const warningId = useId();
  const busy = mutationBusy || submitting;
  const singleFile =
    scope === "file" ? files[0] : undefined;
  const untrackedCount = files.filter(
    (file) =>
      file.kind === "untracked" || file.mode === "untracked"
  ).length;
  const hasUntracked = untrackedCount > 0;
  const trackedCount = files.length - untrackedCount;
  const title = singleFile
    ? hasUntracked
      ? "永久删除未跟踪文件？"
      : `放弃对“${singleFile.path}”的更改？`
    : `放弃 ${files.length} 个文件的更改？`;
  const targetSummary = singleFile
    ? singleFile.path
    : `${files.length} 个文件${
        hasUntracked
          ? ` · ${untrackedCount} 个未跟踪文件`
          : ""
      }`;
  const warning = hasUntracked
    ? `其中 ${untrackedCount} 个未跟踪文件将从磁盘永久删除，不会移入回收站，且无法撤销。${
        trackedCount > 0
          ? " 其余文件的工作区修改也会被还原。"
          : ""
      }`
    : "工作区中的修改将被还原，此操作无法撤销。";

  useModalFocusTrap(dialogRef);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () =>
      window.removeEventListener("keydown", handleKeyDown);
  }, [busy, onCancel]);

  const confirm = async () => {
    if (busy) {
      return;
    }

    setSubmitting(true);
    try {
      const result = await onConfirm();
      if (result !== false) {
        onCancel();
        return;
      }
    } catch {
      // The mutation owner keeps its existing error feedback.
    }
    setSubmitting(false);
  };

  return (
    <LayerPortal>
      <div className="command-dialog-backdrop">
        <section
          aria-describedby={`${descriptionId} ${warningId}`}
          aria-labelledby={titleId}
          aria-modal="true"
          className="command-dialog diff-discard-dialog danger"
          ref={dialogRef}
          role="alertdialog"
        >
          <header className="command-dialog-header">
            <span className="command-dialog-icon danger">
              <Icon name="warning" size={20} />
            </span>
            <div>
              <span className="eyebrow">危险操作</span>
              <h2 id={titleId}>{title}</h2>
              <p id={descriptionId}>
                确认后将立即处理当前工作区内容。
              </p>
            </div>
          </header>

          <div className="command-dialog-body">
            <div
              className="command-warning danger"
              id={warningId}
            >
              <Icon name="warning" size={15} />
              <span>{warning}</span>
            </div>
            <div className="diff-discard-target">
              <span>
                {singleFile ? "目标文件" : "影响范围"}
              </span>
              <code title={targetSummary}>
                {targetSummary}
              </code>
            </div>
          </div>

          <footer className="command-dialog-footer">
            <p>
              {hasUntracked
                ? "未跟踪文件不会进入回收站。"
                : "请确认这些本地修改不再需要。"}
            </p>
            <div>
              <Button
                data-modal-initial-focus="true"
                disabled={busy}
                onClick={onCancel}
                size="small"
                type="button"
              >
                取消
              </Button>
              <Button
                aria-busy={busy}
                disabled={busy}
                emphasis="strong"
                onClick={() => void confirm()}
                size="small"
                type="button"
                variant="danger"
              >
                <Icon name={busy ? "refresh" : "warning"} />
                {busy
                  ? "处理中…"
                  : hasUntracked
                    ? "永久删除并放弃"
                    : "确认放弃"}
              </Button>
            </div>
          </footer>
        </section>
      </div>
    </LayerPortal>
  );
}
