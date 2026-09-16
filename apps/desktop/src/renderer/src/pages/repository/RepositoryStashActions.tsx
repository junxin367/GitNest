import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState
} from "react";

import type { StashSummaryDto } from "@gitnest/contracts";

import type { RepositoryStashMutationAction } from "../../entities/repository/useRepositoryStashes";
import { Button } from "../../shared/ui/Button";
import { Icon } from "../../shared/ui/Icon";
import { LayerPortal } from "../../shared/ui/LayerPortal";
import { Menu, MenuItem } from "../../shared/ui/Menu";
import { useModalFocusTrap } from "../../shared/ui/useModalFocusTrap";

const CONTEXT_MENU_WIDTH = 222;
const CONTEXT_MENU_HEIGHT = 132;
const VIEWPORT_PADDING = 8;

export interface RepositoryStashContextMenuState {
  stash: StashSummaryDto;
  x: number;
  y: number;
}

export function createRepositoryStashContextMenuState(
  stash: StashSummaryDto,
  clientX: number,
  clientY: number
): RepositoryStashContextMenuState {
  const maxX = Math.max(
    VIEWPORT_PADDING,
    window.innerWidth -
      CONTEXT_MENU_WIDTH -
      VIEWPORT_PADDING
  );
  const maxY = Math.max(
    VIEWPORT_PADDING,
    window.innerHeight -
      CONTEXT_MENU_HEIGHT -
      VIEWPORT_PADDING
  );

  return {
    stash,
    x: Math.max(VIEWPORT_PADDING, Math.min(clientX, maxX)),
    y: Math.max(VIEWPORT_PADDING, Math.min(clientY, maxY))
  };
}

export function RepositoryStashContextMenu({
  contextMenu,
  mutationBusy,
  onChoose,
  onClose
}: {
  contextMenu: RepositoryStashContextMenuState | null;
  mutationBusy: boolean;
  onChoose(
    action: RepositoryStashMutationAction,
    stash: StashSummaryDto
  ): void;
  onClose(): void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const closeContextMenu = useCallback(() => {
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const closeFromOutside = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        menuRef.current?.contains(target)
      ) {
        return;
      }
      closeContextMenu();
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeContextMenu();
      }
    };
    const focusFrame = window.requestAnimationFrame(() => {
      menuRef.current
        ?.querySelector<HTMLButtonElement>(
          "[role='menuitem']:not(:disabled)"
        )
        ?.focus();
    });

    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromKeyboard);
    document.addEventListener(
      "scroll",
      closeContextMenu,
      true
    );
    window.addEventListener("blur", closeContextMenu);
    window.addEventListener("resize", closeContextMenu);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener(
        "pointerdown",
        closeFromOutside
      );
      document.removeEventListener(
        "keydown",
        closeFromKeyboard
      );
      document.removeEventListener(
        "scroll",
        closeContextMenu,
        true
      );
      window.removeEventListener("blur", closeContextMenu);
      window.removeEventListener(
        "resize",
        closeContextMenu
      );
    };
  }, [closeContextMenu, contextMenu]);

  useEffect(() => {
    if (mutationBusy) {
      closeContextMenu();
    }
  }, [closeContextMenu, mutationBusy]);

  if (!contextMenu) {
    return null;
  }

  const choose = (action: RepositoryStashMutationAction) => {
    if (mutationBusy) {
      return;
    }
    const { stash } = contextMenu;
    closeContextMenu();
    onChoose(action, stash);
  };

  return (
    <LayerPortal>
      <Menu
        aria-label={`${contextMenu.stash.ref} 储藏操作`}
        className="workspace-context-menu repository-stash-context-menu"
        ref={menuRef}
        style={{
          left: contextMenu.x,
          top: contextMenu.y
        }}
      >
        <MenuItem
          disabled={mutationBusy}
          leading={<Icon name="undo" size={14} />}
          onClick={() => choose("apply")}
        >
          恢复
        </MenuItem>
        <MenuItem
          disabled={mutationBusy}
          leading={<Icon name="warning" size={14} />}
          onClick={() => choose("drop")}
          tone="danger"
        >
          删除
        </MenuItem>
        <MenuItem
          disabled={mutationBusy}
          leading={<Icon name="download" size={14} />}
          onClick={() => choose("pop")}
          tone="danger"
        >
          恢复并删除
        </MenuItem>
      </Menu>
    </LayerPortal>
  );
}

export function RepositoryStashActionDialog({
  action,
  mutationBusy,
  stash,
  onCancel,
  onConfirm
}: {
  action: RepositoryStashMutationAction;
  mutationBusy: boolean;
  stash: StashSummaryDto;
  onCancel(): void;
  onConfirm(
    action: RepositoryStashMutationAction,
    stash: StashSummaryDto
  ): void | boolean | Promise<void | boolean>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const warningId = useId();
  const busy = mutationBusy || submitting;
  const copy = stashActionCopy(action, stash.ref);

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
      const result = await onConfirm(action, stash);
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
          className={`command-dialog repository-stash-action-dialog${
            copy.danger ? " danger" : ""
          }`}
          ref={dialogRef}
          role="alertdialog"
        >
          <header className="command-dialog-header">
            <span
              className={`command-dialog-icon${
                copy.danger ? " danger" : ""
              }`}
            >
              <Icon
                name={copy.danger ? "warning" : "undo"}
                size={20}
              />
            </span>
            <div>
              <span className="eyebrow">
                {copy.danger ? "危险操作" : "储藏操作"}
              </span>
              <h2 id={titleId}>{copy.title}</h2>
              <p id={descriptionId}>{copy.description}</p>
            </div>
          </header>

          <div className="command-dialog-body">
            <div
              className={`command-warning${
                copy.danger ? " danger" : ""
              }`}
              id={warningId}
            >
              <Icon
                name={copy.danger ? "warning" : "operations"}
                size={15}
              />
              <span>{copy.warning}</span>
            </div>
            <div className="repository-stash-action-target">
              <span>目标储藏</span>
              <code title={`${stash.ref} ${stash.subject}`}>
                {stash.ref}
                <small>{stash.hash.slice(0, 8)}</small>
              </code>
              <strong>{stash.subject}</strong>
            </div>
          </div>

          <footer className="command-dialog-footer">
            <p>{copy.footer}</p>
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
                variant={copy.danger ? "danger" : "primary"}
              >
                <Icon
                  name={
                    busy
                      ? "refresh"
                      : copy.danger
                        ? "warning"
                        : "undo"
                  }
                />
                {busy ? "处理中…" : copy.confirmLabel}
              </Button>
            </div>
          </footer>
        </section>
      </div>
    </LayerPortal>
  );
}

function stashActionCopy(
  action: RepositoryStashMutationAction,
  stashRef: string
): {
  title: string;
  description: string;
  warning: string;
  footer: string;
  confirmLabel: string;
  danger: boolean;
} {
  if (action === "apply") {
    return {
      title: `恢复 ${stashRef}？`,
      description:
        "储藏中的变更会应用到当前工作区，储藏记录仍然保留。",
      warning:
        "当前工作区的未提交修改可能与储藏内容冲突。发生冲突时，请在工作区中解决冲突。",
      footer: "该操作不会删除这条储藏记录。",
      confirmLabel: "确认恢复",
      danger: false
    };
  }
  if (action === "drop") {
    return {
      title: `删除 ${stashRef}？`,
      description:
        "这条储藏记录会从储藏列表中永久删除。",
      warning:
        "删除后无法通过 GitNest 撤销；储藏中的变更不会恢复到当前工作区。",
      footer: "请确认这条储藏记录不再需要。",
      confirmLabel: "永久删除",
      danger: true
    };
  }
  return {
    title: `恢复并删除 ${stashRef}？`,
    description:
      "Git 会先把储藏中的变更应用到当前工作区。",
    warning:
      "仅在恢复成功后才会删除储藏记录；若发生冲突，Git 会保留这条储藏记录。",
    footer: "成功后删除储藏记录的操作无法撤销。",
    confirmLabel: "恢复并删除",
    danger: true
  };
}
