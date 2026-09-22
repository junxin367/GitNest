import {
  useId,
  useState
} from "react";

import type { DiffViewerFile } from "../../shared/model/diffViewModel";
import { Button } from "../../shared/ui/Button";
import { Dialog } from "../../shared/ui/Dialog";
import { Icon } from "../../shared/ui/Icon";

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
      : "放弃文件更改？"
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
    <Dialog
      ariaDescribedBy={warningId}
      dismissDisabled={busy}
      footer={
        <>
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
            icon={
              <Icon
                name={busy ? "refresh" : "warning"}
              />
            }
            onClick={() => void confirm()}
            size="small"
            type="button"
            variant="danger"
          >
            {busy
              ? "处理中…"
              : hasUntracked
                ? "永久删除并放弃"
                : "确认放弃"}
          </Button>
        </>
      }
      icon="warning"
      onDismiss={onCancel}
      role="alertdialog"
      size="target"
      title={title}
      tone="danger"
    >
      <div className="diff-discard-target">
        <span>{singleFile ? "目标文件" : "影响范围"}</span>
        <code title={targetSummary}>{targetSummary}</code>
      </div>
      <div
        className="command-warning danger"
        id={warningId}
      >
        <Icon name="warning" size={15} />
        <span>{warning}</span>
      </div>
    </Dialog>
  );
}
