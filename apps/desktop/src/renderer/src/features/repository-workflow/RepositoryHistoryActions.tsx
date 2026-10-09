import { useEffect, useRef, useState } from "react";

import { Button } from "../../shared/ui/Button";
import { Icon } from "../../shared/ui/Icon";
import { MenuHeading, MenuItem, MenuPopover } from "../../shared/ui/Menu";
import type { RepositoryWorkflowController } from "./useRepositoryWorkflow";

export function RepositoryHistoryActions({
  controller,
  repositoryKey,
  busy = false
}: {
  controller: RepositoryWorkflowController;
  repositoryKey: string;
  busy?: boolean;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [openFor, setOpenFor] = useState<string | null>(null);
  const disabled = busy || controller.busy || Boolean(controller.preflight || controller.draft);
  const open = openFor === repositoryKey && !disabled;

  useEffect(() => {
    setOpenFor(null);
  }, [repositoryKey, disabled]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (event.target instanceof Node &&
        (triggerRef.current?.contains(event.target) || menuRef.current?.contains(event.target))) return;
      setOpenFor(null);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      setOpenFor(null);
      triggerRef.current?.focus();
    };
    const blur = () => setOpenFor(null);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", keydown);
    window.addEventListener("blur", blur);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", keydown);
      window.removeEventListener("blur", blur);
    };
  }, [open]);

  const choose = (type: "amend" | "undo-commit") => {
    if (disabled) return;
    setOpenFor(null);
    triggerRef.current?.focus();
    controller.openDraft(type);
  };

  return (
    <>
      <Button
        aria-expanded={open}
        aria-haspopup="menu"
        className="panel-header-action"
        disabled={disabled}
        onClick={() => setOpenFor(open ? null : repositoryKey)}
        onKeyDown={event => {
          if ((event.key === "ArrowDown" || event.key === "ArrowUp") &&
            !event.nativeEvent.isComposing && !disabled) {
            event.preventDefault();
            setOpenFor(repositoryKey);
          }
        }}
        ref={triggerRef}
        size="small"
        title="操作当前工作区的最近提交（HEAD）"
        type="button"
      >
        提交操作
        <Icon name="chevron" size={12} />
      </Button>
      {open && (
        <MenuPopover
          align="end"
          anchor={triggerRef.current}
          aria-label="当前工作区提交操作"
          autoFocus
          onKeyDown={event => {
            if (event.key === "Tab") {
              setOpenFor(null);
              triggerRef.current?.focus();
            }
          }}
          ref={menuRef}
          side="bottom"
        >
          <MenuHeading>当前工作区 · 最近提交 HEAD</MenuHeading>
          <MenuItem disabled={disabled} onClick={() => choose("amend")}>
            修正最近提交
          </MenuItem>
          <MenuItem disabled={disabled} onClick={() => choose("undo-commit")}>
            撤销最近提交
          </MenuItem>
        </MenuPopover>
      )}
    </>
  );
}
