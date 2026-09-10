import { Button } from "../../shared/ui/Button";
import {
  useRef,
  useState,
  type FormEvent
} from "react";

import type { WorkspaceEntryDto } from "@gitnest/contracts";

import { WORKSPACE_ENTRY_LABELS } from "../../entities/workspace/model";
import { Icon } from "../../shared/ui/Icon";
import { Input } from "../../shared/ui/Input";
import { LayerPortal } from "../../shared/ui/LayerPortal";
import { useModalFocusTrap } from "../../shared/ui/useModalFocusTrap";

interface WorkspaceGroupRenameDialogProps {
  automaticName: string;
  busy: boolean;
  displayName: string;
  onCancel(): void;
  onConfirm(displayName: string): Promise<boolean>;
}

export function WorkspaceGroupRenameDialog({
  automaticName,
  busy,
  displayName: initialDisplayName,
  onCancel,
  onConfirm
}: WorkspaceGroupRenameDialogProps) {
  const [displayName, setDisplayName] = useState(
    initialDisplayName
  );
  const dialogRef = useRef<HTMLElement>(null);
  useModalFocusTrap(dialogRef);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const normalized = displayName.trim();

    if (!normalized || busy) {
      return;
    }

    if (await onConfirm(normalized)) {
      onCancel();
    }
  };

  return (
    <LayerPortal>
      <div className="command-dialog-backdrop workspace-entry-dialog-backdrop">
        <section
        aria-describedby="workspace-group-rename-description"
        aria-labelledby="workspace-group-rename-title"
        aria-modal="true"
        className="command-dialog workspace-entry-dialog"
        ref={dialogRef}
        role="dialog"
      >
        <header className="command-dialog-header">
          <span className="command-dialog-icon">
            <Icon name="folder" size={20} />
          </span>
          <div>
            <span className="eyebrow">仓库分组</span>
            <h2 id="workspace-group-rename-title">
              重命名分组
            </h2>
            <p id="workspace-group-rename-description">
              自动识别名称：{automaticName}
            </p>
          </div>
        </header>

        <div className="command-dialog-body">
          <form
            id="workspace-group-rename-form"
            onSubmit={submit}
          >
            <div className="workspace-entry-dialog-field">
              <label htmlFor="workspace-group-display-name">
                分组名称
              </label>
              <Input
                aria-describedby="workspace-group-display-name-help"
                data-modal-initial-focus="true"
                fullWidth
                id="workspace-group-display-name"
                maxLength={120}
                onChange={(event) =>
                  setDisplayName(event.target.value)
                }
                spellCheck={false}
                value={displayName}
              />
              <small id="workspace-group-display-name-help">
                默认使用包含多个仓库的目录名，也可以修改为更易读的名称。
              </small>
            </div>
          </form>
        </div>

        <footer className="command-dialog-footer">
          <p>只修改当前 Workspace 中的分组显示名称。</p>
          <div>
            <Button size="small"
              disabled={busy}
              onClick={onCancel}
              type="button"
            >
              取消
            </Button>
            <Button size="small" variant="primary"
              disabled={busy || !displayName.trim()}
              form="workspace-group-rename-form"
              type="submit"
            >
              <Icon name={busy ? "refresh" : "check"} />
              {busy ? "保存中…" : "保存分组名称"}
            </Button>
          </div>
        </footer>
        </section>
      </div>
    </LayerPortal>
  );
}

interface WorkspaceEntryRenameDialogProps {
  entry: WorkspaceEntryDto;
  busy: boolean;
  onCancel(): void;
  onConfirm(displayName: string): Promise<boolean>;
}

export function WorkspaceEntryRenameDialog({
  entry,
  busy,
  onCancel,
  onConfirm
}: WorkspaceEntryRenameDialogProps) {
  const [displayName, setDisplayName] = useState(
    entry.displayName
  );
  const dialogRef = useRef<HTMLElement>(null);
  useModalFocusTrap(dialogRef);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const normalized = displayName.trim();

    if (!normalized || busy) {
      return;
    }

    if (await onConfirm(normalized)) {
      onCancel();
    }
  };

  return (
    <LayerPortal>
      <div className="command-dialog-backdrop workspace-entry-dialog-backdrop">
        <section
        aria-describedby="workspace-entry-rename-description"
        aria-labelledby="workspace-entry-rename-title"
        aria-modal="true"
        className="command-dialog workspace-entry-dialog"
        ref={dialogRef}
        role="dialog"
      >
        <header className="command-dialog-header">
          <span className="command-dialog-icon">
            <Icon name="settings" size={20} />
          </span>
          <div>
            <span className="eyebrow">Workspace 条目</span>
            <h2 id="workspace-entry-rename-title">
              修改显示名称
            </h2>
            <p id="workspace-entry-rename-description">
              {WORKSPACE_ENTRY_LABELS[entry.kind]} ·{" "}
              {entry.path}
            </p>
          </div>
        </header>

        <div className="command-dialog-body">
          <form
            id="workspace-entry-rename-form"
            onSubmit={submit}
          >
            <div className="workspace-entry-dialog-field">
              <label htmlFor="workspace-entry-display-name">
                显示名称
              </label>
              <Input
                aria-describedby="workspace-entry-display-name-help"
                data-modal-initial-focus="true"
                fullWidth
                id="workspace-entry-display-name"
                maxLength={120}
                onChange={(event) =>
                  setDisplayName(event.target.value)
                }
                spellCheck={false}
                value={displayName}
              />
              <small id="workspace-entry-display-name-help">
                仅修改 Workspace 中的显示名称，不会改动磁盘路径或仓库内容。
              </small>
            </div>
          </form>
        </div>

        <footer className="command-dialog-footer">
          <p>名称长度限制为 1 到 120 个字符。</p>
          <div>
            <Button size="small"
              disabled={busy}
              onClick={onCancel}
              type="button"
            >
              取消
            </Button>
            <Button size="small" variant="primary"
              disabled={busy || !displayName.trim()}
              form="workspace-entry-rename-form"
              type="submit"
            >
              <Icon name={busy ? "refresh" : "check"} />
              {busy ? "保存中…" : "保存名称"}
            </Button>
          </div>
        </footer>
        </section>
      </div>
    </LayerPortal>
  );
}

interface WorkspaceEntryRemoveDialogProps {
  entry: WorkspaceEntryDto;
  busy: boolean;
  targetName?: string | undefined;
  targetPath?: string | undefined;
  onCancel(): void;
  onConfirm(): Promise<boolean>;
}

export function WorkspaceEntryRemoveDialog({
  entry,
  busy,
  targetName,
  targetPath,
  onCancel,
  onConfirm
}: WorkspaceEntryRemoveDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  useModalFocusTrap(dialogRef);

  const confirm = async () => {
    if (!busy && (await onConfirm())) {
      onCancel();
    }
  };

  return (
    <LayerPortal>
      <div className="command-dialog-backdrop workspace-entry-dialog-backdrop">
        <section
        aria-describedby="workspace-entry-remove-description"
        aria-labelledby="workspace-entry-remove-title"
        aria-modal="true"
        className="command-dialog workspace-entry-dialog danger"
        ref={dialogRef}
        role="alertdialog"
      >
        <header className="command-dialog-header">
          <span className="command-dialog-icon danger">
            <Icon name="warning" size={20} />
          </span>
          <div>
            <span className="eyebrow">危险操作</span>
            <h2 id="workspace-entry-remove-title">
              移出 Workspace？
            </h2>
            <p id="workspace-entry-remove-description">
              {targetName ?? entry.displayName}
            </p>
          </div>
        </header>

        <div className="command-dialog-body">
          <div className="command-warning danger">
            <Icon name="warning" size={15} />
            <span>
              将从当前 Workspace 配置中移除该条目，但不会删除磁盘上的目录、仓库或提交。
            </span>
          </div>
          <div className="workspace-entry-dialog-path">
            <span>路径</span>
            <code title={targetPath ?? entry.path}>
              {targetPath ?? entry.path}
            </code>
          </div>
        </div>

        <footer className="command-dialog-footer">
          <p>之后仍可通过“添加目录”重新加入。</p>
          <div>
            <Button size="small"
              data-modal-initial-focus="true"
              disabled={busy}
              onClick={onCancel}
              type="button"
            >
              取消
            </Button>
            <Button size="small" emphasis="strong" variant="danger"
              aria-busy={busy}
              disabled={busy}
              onClick={() => void confirm()}
              type="button"
            >
              <Icon name={busy ? "refresh" : "warning"} />
              {busy ? "移除中…" : "确认移出"}
            </Button>
          </div>
        </footer>
        </section>
      </div>
    </LayerPortal>
  );
}
