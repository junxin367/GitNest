import {
  useCallback,
  useEffect,
  useRef
} from "react";

import type {
  ExternalApplicationKindDto,
  ExternalApplicationProfileDto,
  RepositoryIgnoreScopeDto
} from "@gitnest/contracts";

import type { DiffViewerFile } from "../../shared/model/diffViewModel";
import { Icon } from "../../shared/ui/Icon";
import { LayerPortal } from "../../shared/ui/LayerPortal";
import {
  isEventInsideMenu,
  Menu,
  MenuItem
} from "../../shared/ui/Menu";
import { OpenInSubmenu } from "../repository-header/OpenInSubmenu";

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
  clientY: number,
  menuHeight = CONTEXT_MENU_HEIGHT
): DiffFileContextMenuState {
  const maxX = Math.max(
    VIEWPORT_PADDING,
    window.innerWidth - CONTEXT_MENU_WIDTH - VIEWPORT_PADDING
  );
  const maxY = Math.max(
    VIEWPORT_PADDING,
    window.innerHeight - menuHeight - VIEWPORT_PADDING
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
  onFileHistory,
  onIgnoreFile,
  mutationBusy,
  onClose
}: {
  applications: DiffWorkspaceExternalApplications;
  contextMenu: DiffFileContextMenuState | null;
  onFileHistory?: ((file: DiffViewerFile) => void) | undefined;
  onIgnoreFile?: ((file: DiffViewerFile, scope: RepositoryIgnoreScopeDto) => void) | undefined;
  mutationBusy?: boolean | undefined;
  onClose(): void;
}) {
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const openInMenuRef = useRef<HTMLDivElement>(null);
  const closeContextMenu = useCallback(() => { onClose(); }, [onClose]);

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
          top: contextMenu.y,
          maxHeight: "calc(100vh - 16px)",
          overflowY: "auto"
        }}
      >
        {onFileHistory && <MenuItem leading={<Icon name="history" size={14} />} onClick={() => {
          const file = contextMenu.file;
          closeContextMenu();
          onFileHistory(file);
        }}>文件历史</MenuItem>}
        {onIgnoreFile && contextMenu.file.mode === "untracked" && <>
          {([
            ["file", "忽略此文件"],
            ["directory", "忽略所在目录"],
            ["extension", "忽略同扩展名文件"]
          ] as const).map(([scope, label]) => {
            const file = contextMenu.file;
            const name = file.path.split("/").at(-1) ?? "";
            const unavailable = scope === "directory" ? !file.path.includes("/")
              : scope === "extension" ? name.lastIndexOf(".") <= 0 || name.endsWith(".") : false;
            return <MenuItem key={scope} disabled={mutationBusy || unavailable}
              title={unavailable ? scope === "directory" ? "根目录文件没有可忽略的父目录" : "此文件没有扩展名" : undefined}
              onClick={() => { closeContextMenu(); onIgnoreFile(file, scope); }}>{label}</MenuItem>;
          })}
        </>}
        <OpenInSubmenu
          profiles={applications.profiles}
          loading={applications.loading}
          active={applications.active}
          label="选择用于打开此文件的应用"
          resetKey={contextMenu}
          menuRef={openInMenuRef}
          onOpen={kind => {
            const path = contextMenu.file.path;
            closeContextMenu();
            void applications.openFile(kind, path);
          }}
        />
      </Menu>
    </LayerPortal>
  );
}
