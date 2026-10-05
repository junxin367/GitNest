import {
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";

import type {
  ExternalApplicationKindDto,
  ExternalApplicationProfileDto
} from "@gitnest/contracts";

import type { DiffViewerFile } from "../../shared/model/diffViewModel";
import { Icon } from "../../shared/ui/Icon";
import { LayerPortal } from "../../shared/ui/LayerPortal";
import {
  isEventInsideMenu,
  Menu,
  MenuHeading,
  MenuItem,
  MenuPopover
} from "../../shared/ui/Menu";
import { ApplicationIcon } from "../repository-header/OpenInControl";

const CONTEXT_MENU_WIDTH = 222;
const CONTEXT_MENU_HEIGHT = 52;
const VIEWPORT_PADDING = 8;

export interface DiffWorkspaceExternalApplications {
  profiles: readonly ExternalApplicationProfileDto[];
  loading: boolean;
  active: ExternalApplicationKindDto | null;
  openFile(
    kind: ExternalApplicationKindDto,
    path: string
  ): void | boolean | Promise<void | boolean>;
}

export interface DiffFileContextMenuState {
  file: DiffViewerFile;
  x: number;
  y: number;
}

export function createDiffFileContextMenuState(
  file: DiffViewerFile,
  clientX: number,
  clientY: number
): DiffFileContextMenuState {
  const maxX = Math.max(
    VIEWPORT_PADDING,
    window.innerWidth - CONTEXT_MENU_WIDTH - VIEWPORT_PADDING
  );
  const maxY = Math.max(
    VIEWPORT_PADDING,
    window.innerHeight - CONTEXT_MENU_HEIGHT - VIEWPORT_PADDING
  );

  return {
    file,
    x: Math.max(VIEWPORT_PADDING, Math.min(clientX, maxX)),
    y: Math.max(VIEWPORT_PADDING, Math.min(clientY, maxY))
  };
}

export function DiffFileContextMenu({
  applications,
  contextMenu,
  onClose
}: {
  applications: DiffWorkspaceExternalApplications;
  contextMenu: DiffFileContextMenuState | null;
  onClose(): void;
}) {
  const [openInMenuOpen, setOpenInMenuOpen] = useState(false);
  const [focusOpenInMenu, setFocusOpenInMenu] = useState(false);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const openInTriggerRef = useRef<HTMLButtonElement>(null);
  const openInMenuRef = useRef<HTMLDivElement>(null);
  const restoringTriggerFocusRef = useRef(false);
  const openInCloseTimerRef = useRef<number | null>(null);

  const cancelOpenInMenuClose = useCallback(() => {
    if (openInCloseTimerRef.current !== null) {
      window.clearTimeout(openInCloseTimerRef.current);
      openInCloseTimerRef.current = null;
    }
  }, []);

  const closeContextMenu = useCallback(() => {
    cancelOpenInMenuClose();
    setOpenInMenuOpen(false);
    setFocusOpenInMenu(false);
    onClose();
  }, [cancelOpenInMenuClose, onClose]);

  const openOpenInMenu = useCallback(() => {
    cancelOpenInMenuClose();
    setOpenInMenuOpen(true);
  }, [cancelOpenInMenuClose]);

  const enterOpenInMenu = useCallback(() => {
    setFocusOpenInMenu(true);
    openOpenInMenu();
    openInMenuRef.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
      ?.focus();
  }, [openOpenInMenu]);

  const returnToOpenInTrigger = useCallback(() => {
    cancelOpenInMenuClose();
    setOpenInMenuOpen(false);
    setFocusOpenInMenu(false);
    restoringTriggerFocusRef.current = true;
    openInTriggerRef.current?.focus();
    restoringTriggerFocusRef.current = false;
  }, [cancelOpenInMenuClose]);

  const scheduleOpenInMenuClose = useCallback(() => {
    cancelOpenInMenuClose();
    openInCloseTimerRef.current = window.setTimeout(() => {
      openInCloseTimerRef.current = null;
      setOpenInMenuOpen(false);
      setFocusOpenInMenu(false);
    }, 120);
  }, [cancelOpenInMenuClose]);

  useEffect(() => {
    cancelOpenInMenuClose();
    setOpenInMenuOpen(false);
    setFocusOpenInMenu(false);
  }, [
    cancelOpenInMenuClose,
    contextMenu?.file.key,
    contextMenu?.x,
    contextMenu?.y
  ]);

  useEffect(
    () => () => {
      cancelOpenInMenuClose();
    },
    [cancelOpenInMenuClose]
  );

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const closeFromOutside = (event: Event) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (contextMenuRef.current?.contains(target) ||
          openInMenuRef.current?.contains(target))
      ) {
        return;
      }
      closeContextMenu();
    };
    const closeFromKeyboard = (
      event: globalThis.KeyboardEvent
    ) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeContextMenu();
      }
    };
    const closeFromScroll = (event: Event) => {
      if (
        isEventInsideMenu(event, contextMenuRef.current) ||
        isEventInsideMenu(event, openInMenuRef.current)
      ) {
        return;
      }
      closeContextMenu();
    };
    const focusFrame = window.requestAnimationFrame(() => {
      contextMenuRef.current
        ?.querySelector<HTMLButtonElement>("[role='menuitem']")
        ?.focus();
    });

    document.addEventListener(
      "pointerdown",
      closeFromOutside
    );
    document.addEventListener("focusin", closeFromOutside);
    document.addEventListener(
      "keydown",
      closeFromKeyboard
    );
    document.addEventListener(
      "scroll",
      closeFromScroll,
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
      document.removeEventListener("focusin", closeFromOutside);
      document.removeEventListener(
        "keydown",
        closeFromKeyboard
      );
      document.removeEventListener(
        "scroll",
        closeFromScroll,
        true
      );
      window.removeEventListener("blur", closeContextMenu);
      window.removeEventListener(
        "resize",
        closeContextMenu
      );
    };
  }, [closeContextMenu, contextMenu]);

  if (!contextMenu) {
    return null;
  }

  return (
    <LayerPortal>
      <Menu
        aria-label={`${contextMenu.file.path} 文件操作`}
        className="workspace-context-menu change-file-context-menu"
        ref={contextMenuRef}
        style={{
          left: contextMenu.x,
          top: contextMenu.y
        }}
      >
        <div
          className="workspace-context-open-in"
          onBlurCapture={scheduleOpenInMenuClose}
          onFocusCapture={() => {
            if (!restoringTriggerFocusRef.current) {
              openOpenInMenu();
            }
          }}
          onPointerEnter={openOpenInMenu}
          onPointerLeave={scheduleOpenInMenuClose}
        >
          <MenuItem
            aria-expanded={openInMenuOpen}
            aria-haspopup="menu"
            className="workspace-context-open-in-trigger"
            leading={<Icon name="external" size={14} />}
            onClick={enterOpenInMenu}
            onKeyDown={(event) => {
              if (
                event.key === "ArrowRight" &&
                !event.nativeEvent.isComposing &&
                event.keyCode !== 229
              ) {
                event.preventDefault();
                enterOpenInMenu();
              }
            }}
            ref={openInTriggerRef}
            title="选择用于打开此文件的应用"
            trailing={<Icon name="collapse" size={14} />}
          >
            打开方式
          </MenuItem>
          {openInMenuOpen && (
            <MenuPopover
              align="start"
              anchor={contextMenuRef.current}
              aria-label="选择用于打开此文件的应用"
              autoFocus={focusOpenInMenu && !applications.loading}
              className="workspace-context-open-in-submenu"
              onBlurCapture={scheduleOpenInMenuClose}
              onFocusCapture={openOpenInMenu}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.keyCode === 229) {
                  return;
                }
                if (event.key === "Escape" || event.key === "ArrowLeft") {
                  event.preventDefault();
                  event.stopPropagation();
                  returnToOpenInTrigger();
                }
              }}
              onPointerEnter={openOpenInMenu}
              onPointerLeave={scheduleOpenInMenuClose}
              ref={openInMenuRef}
              side="right"
            >
              <MenuHeading>Open in</MenuHeading>
              {applications.profiles.length > 0 ? (
                applications.profiles.map((profile) => (
                  <MenuItem
                    disabled={applications.active !== null}
                    key={profile.kind}
                    leading={
                      <ApplicationIcon profile={profile} />
                    }
                    onClick={() => {
                      const path = contextMenu.file.path;
                      closeContextMenu();
                      void applications.openFile(
                        profile.kind,
                        path
                      );
                    }}
                  >
                    {profile.label}
                  </MenuItem>
                ))
              ) : (
                <span className="workspace-context-open-in-empty">
                  {applications.loading
                    ? "正在检测可用应用…"
                    : "未检测到可用应用"}
                </span>
              )}
            </MenuPopover>
          )}
        </div>
      </Menu>
    </LayerPortal>
  );
}
