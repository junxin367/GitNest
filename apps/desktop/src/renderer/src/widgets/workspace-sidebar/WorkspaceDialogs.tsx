import { Button } from "../../shared/ui/Button";
import {
  useState,
  type FormEvent
} from "react";

import { Dialog } from "../../shared/ui/Dialog";
import { Icon } from "../../shared/ui/Icon";
import { Input } from "../../shared/ui/Input";
import { normalizeTapdKeyword } from "./tapdKeywordPreferences";

interface WorkspaceGroupRenameDialogProps {
  busy: boolean;
  displayName: string;
  onCancel(): void;
  onConfirm(displayName: string): Promise<boolean>;
}

export function WorkspaceGroupRenameDialog({
  busy,
  displayName: initialDisplayName,
  onCancel,
  onConfirm
}: WorkspaceGroupRenameDialogProps) {
  const [displayName, setDisplayName] = useState(
    initialDisplayName
  );

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
    <Dialog
      footer={
        <>
          <Button
            disabled={busy}
            onClick={onCancel}
            size="small"
            type="button"
          >
            取消
          </Button>
          <Button
            disabled={busy || !displayName.trim()}
            form="workspace-group-rename-form"
            icon={
              <Icon name={busy ? "refresh" : "check"} />
            }
            size="small"
            type="submit"
            variant="primary"
          >
            {busy ? "保存中…" : "保存分组名称"}
          </Button>
        </>
      }
      icon="folder"
      size="compact"
      title="重命名分组"
    >
      <form
        id="workspace-group-rename-form"
        onSubmit={submit}
      >
        <div className="workspace-dialog-field">
          <label htmlFor="workspace-group-display-name">
            分组名称
          </label>
          <Input
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
        </div>
      </form>
    </Dialog>
  );
}

interface WorkspaceRenameDialogProps {
  busy: boolean;
  initialName: string;
  path?: string;
  onCancel(): void;
  onConfirm(name: string): Promise<boolean>;
}

export function WorkspaceRenameDialog({
  busy,
  initialName,
  path,
  onCancel,
  onConfirm
}: WorkspaceRenameDialogProps) {
  const [name, setName] = useState(initialName);

  const normalizedName = name.trim();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (
      !normalizedName ||
      normalizedName === initialName ||
      busy
    ) {
      return;
    }
    if (await onConfirm(normalizedName)) {
      onCancel();
    }
  };

  return (
    <Dialog
      footer={
        <>
          <Button
            disabled={busy}
            onClick={onCancel}
            size="small"
            type="button"
          >
            取消
          </Button>
          <Button
            disabled={
              busy ||
              !normalizedName ||
              normalizedName === initialName
            }
            form="workspace-rename-form"
            icon={
              <Icon name={busy ? "refresh" : "check"} />
            }
            size="small"
            type="submit"
            variant="primary"
          >
            {busy ? "保存中…" : "保存名称"}
          </Button>
        </>
      }
      icon="settings"
      size="compact"
      title="修改 Workspace 名称"
    >
      <form id="workspace-rename-form" onSubmit={submit}>
        <div className="workspace-dialog-field">
          <label htmlFor="workspace-name">
            Workspace 名称
          </label>
          <Input
            aria-describedby="workspace-name-help"
            data-modal-initial-focus="true"
            fullWidth
            id="workspace-name"
            maxLength={120}
            onChange={(event) =>
              setName(event.target.value)
            }
            spellCheck={false}
            value={name}
          />
          <small id="workspace-name-help">
            只修改 GitNest 中的显示名称，不会重命名磁盘目录。
          </small>
        </div>
      </form>
      {path && (
        <div className="workspace-dialog-path">
          <span>Workspace 根目录</span>
          <code title={path}>{path}</code>
        </div>
      )}
    </Dialog>
  );
}

interface WorkspaceTapdKeywordDialogProps {
  busy: boolean;
  initialKeyword: string;
  workspaceName: string;
  onCancel(): void;
  onConfirm(keyword: string): Promise<boolean>;
}

export function WorkspaceTapdKeywordDialog({
  busy,
  initialKeyword,
  workspaceName,
  onCancel,
  onConfirm
}: WorkspaceTapdKeywordDialogProps) {
  const [keyword, setKeyword] = useState(initialKeyword);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) {
      return;
    }
    if (await onConfirm(normalizeTapdKeyword(keyword))) {
      onCancel();
    }
  };

  return (
    <Dialog
      footer={
        <>
          <Button
            disabled={busy}
            onClick={onCancel}
            size="small"
            type="button"
          >
            取消
          </Button>
          <Button
            disabled={busy}
            form="workspace-tapd-keyword-form"
            icon={
              <Icon name={busy ? "refresh" : "check"} />
            }
            size="small"
            type="submit"
            variant="primary"
          >
            {busy ? "保存中…" : "保存关键字"}
          </Button>
        </>
      }
      icon="tag"
      size="compact"
      title="设置 TAPD 关键字"
    >
      <form
        id="workspace-tapd-keyword-form"
        onSubmit={submit}
      >
        <div className="workspace-dialog-field">
          <label htmlFor="workspace-tapd-keyword">
            TAPD 关键字
          </label>
          <Input
            aria-describedby="workspace-tapd-keyword-help"
            data-modal-initial-focus="true"
            fullWidth
            id="workspace-tapd-keyword"
            maxLength={120}
            onChange={(event) =>
              setKeyword(event.target.value)
            }
            placeholder="例如：TAPD-12345"
            spellCheck={false}
            value={keyword}
          />
          <small id="workspace-tapd-keyword-help">
            用于 {workspaceName}。留空可清除设置；生成 AI
            提交信息时会自动插入第二行。
          </small>
        </div>
      </form>
    </Dialog>
  );
}

interface WorkspaceRepositoryRemoveDialogProps {
  busy: boolean;
  name: string;
  path?: string;
  onCancel(): void;
  onConfirm(): Promise<boolean>;
}

export function WorkspaceRepositoryRemoveDialog({
  busy,
  name,
  path,
  onCancel,
  onConfirm
}: WorkspaceRepositoryRemoveDialogProps) {
  const confirm = async () => {
    if (!busy && (await onConfirm())) {
      onCancel();
    }
  };

  return (
    <Dialog
      ariaDescribedBy="workspace-repository-remove-description"
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
            {busy ? "移除中…" : "确认移出"}
          </Button>
        </>
      }
      icon="warning"
      role="alertdialog"
      size="compact"
      title="移出 Workspace？"
      tone="danger"
    >
      <div className="workspace-dialog-path">
        <span>目标仓库</span>
        <strong>{name}</strong>
        {path && <code title={path}>{path}</code>}
      </div>
      <div
        className="command-warning danger"
        id="workspace-repository-remove-description"
      >
        <Icon name="warning" size={15} />
        <span>
          将把该仓库加入当前 Workspace
          的排除列表，后续扫描仍会排除；不会删除磁盘目录、仓库或提交。
        </span>
      </div>
    </Dialog>
  );
}

interface WorkspaceDeleteDialogProps {
  name: string;
  busy: boolean;
  onCancel(): void;
  onConfirm(): Promise<boolean>;
}

export function WorkspaceDeleteDialog({
  name,
  busy,
  onCancel,
  onConfirm
}: WorkspaceDeleteDialogProps) {
  const confirm = async () => {
    if (!busy && (await onConfirm())) {
      onCancel();
    }
  };

  return (
    <Dialog
      ariaDescribedBy="workspace-delete-description"
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
            {busy ? "删除中…" : "确认删除"}
          </Button>
        </>
      }
      icon="warning"
      role="alertdialog"
      size="compact"
      title="删除 Workspace？"
      tone="danger"
    >
      <div className="workspace-dialog-path">
        <span>目标 Workspace</span>
        <strong>{name}</strong>
      </div>
      <div
        className="command-warning danger"
        id="workspace-delete-description"
      >
        <Icon name="warning" size={15} />
        <span>
          将删除此 Workspace 的 GitNest
          配置、快照缓存与操作历史，但不会删除磁盘目录、仓库或提交。应用必须至少保留一个
          Workspace。
        </span>
      </div>
    </Dialog>
  );
}
