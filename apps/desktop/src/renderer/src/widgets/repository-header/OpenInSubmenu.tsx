import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type {
  ExternalApplicationKindDto,
  ExternalApplicationProfileDto
} from "@gitnest/contracts";
import { Icon } from "../../shared/ui/Icon";
import { MenuHeading, MenuItem, MenuPopover } from "../../shared/ui/Menu";
import { ApplicationIcon } from "./OpenInControl";

export function OpenInSubmenu({
  profiles, loading, active, label, resetKey, menuRef, onOpen, onTab
}: {
  profiles: readonly ExternalApplicationProfileDto[];
  loading: boolean;
  active: ExternalApplicationKindDto | null;
  label: string;
  resetKey: unknown;
  menuRef: RefObject<HTMLDivElement | null>;
  onOpen(kind: ExternalApplicationKindDto): void | Promise<void>;
  onTab?(): void;
}) {
  const [open, setOpen] = useState(false);
  const [focusRequested, setFocusRequested] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoringFocusRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);
  const cancelClose = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);
  const reveal = useCallback(() => {
    cancelClose();
    setOpen(true);
  }, [cancelClose]);
  const enter = () => {
    setFocusRequested(true);
    reveal();
    menuRef.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
      ?.focus();
  };
  const returnToTrigger = () => {
    cancelClose();
    setOpen(false);
    setFocusRequested(false);
    restoringFocusRef.current = true;
    triggerRef.current?.focus();
    restoringFocusRef.current = false;
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setOpen(false);
      setFocusRequested(false);
    }, 120);
  };
  useEffect(() => {
    cancelClose();
    setOpen(false);
    setFocusRequested(false);
    return cancelClose;
  }, [cancelClose, resetKey]);

  // Keep cached choices available during refresh. Initial discovery must not
  // produce a transient loading-only submenu; preserve hover/keyboard intent.
  const visible = open && (profiles.length > 0 || !loading);
  return (
    <div
      className="workspace-context-open-in"
      onBlurCapture={scheduleClose}
      onFocusCapture={() => {
        if (!restoringFocusRef.current) reveal();
      }}
      onPointerEnter={reveal}
      onPointerLeave={scheduleClose}
    >
      <MenuItem
        aria-expanded={visible}
        aria-haspopup="menu"
        className="workspace-context-open-in-trigger"
        leading={<Icon name="external" size={14} />}
        onClick={enter}
        onKeyDown={event => {
          if (event.key === "ArrowRight" &&
            !event.nativeEvent.isComposing && event.keyCode !== 229) {
            event.preventDefault();
            enter();
          }
        }}
        ref={triggerRef}
        title={label}
        trailing={<Icon name="collapse" size={14} />}
      >
        打开方式
      </MenuItem>
      {visible && (
        <MenuPopover
          align="start"
          anchor={triggerRef.current}
          aria-label={label}
          autoFocus={focusRequested}
          className="workspace-context-open-in-submenu"
          onBlurCapture={scheduleClose}
          onFocusCapture={reveal}
          onKeyDown={event => {
            if (event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === "Escape" || event.key === "ArrowLeft") {
              event.preventDefault();
              event.stopPropagation();
              returnToTrigger();
            } else if (event.key === "Tab" && onTab) {
              event.stopPropagation();
              onTab();
            }
          }}
          onPointerEnter={reveal}
          onPointerLeave={scheduleClose}
          ref={menuRef}
          side="right"
        >
          <MenuHeading>打开方式</MenuHeading>
          {profiles.length > 0 ? profiles.map(profile => (
            <MenuItem
              disabled={active !== null}
              key={profile.kind}
              leading={<ApplicationIcon profile={profile} />}
              onClick={() => void onOpen(profile.kind)}
            >
              {profile.label}
            </MenuItem>
          )) : (
            <span className="workspace-context-open-in-empty">未检测到可用应用</span>
          )}
        </MenuPopover>
      )}
    </div>
  );
}
