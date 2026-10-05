import { Button } from "../../shared/ui/Button";
import type { RuntimeInfo } from "@gitnest/contracts";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { useWindowMaximized } from "../../shared/lib/useWindowMaximized";
import { Icon } from "../../shared/ui/Icon";
import {
  MenuItem,
  MenuPopover,
  MenuSeparator,
} from "../../shared/ui/Menu";

interface AppTitlebarProps {
  searchOpen: boolean;
  runtimeInfo: RuntimeInfo | null;
  onCreateWorkspace(): void;
  onOpenSearch(): void;
  onOpenVersion(): void;
}

type OpenMenu = "file" | "help" | null;

export function AppTitlebar({
  searchOpen,
  runtimeInfo,
  onCreateWorkspace,
  onOpenSearch,
  onOpenVersion,
}: AppTitlebarProps) {
  const [openMenu, setOpenMenu] =
    useState<OpenMenu>(null);
  const { isMaximized, toggleMaximize } =
    useWindowMaximized();
  const fileMenuRef = useRef<HTMLDivElement>(null);
  const helpMenuRef = useRef<HTMLDivElement>(null);
  const fileTriggerRef = useRef<HTMLButtonElement>(null);
  const helpTriggerRef = useRef<HTMLButtonElement>(null);
  const menuSurfaceRef = useRef<HTMLDivElement>(null);
  const appVersion = runtimeInfo?.appVersion ?? "0.0.1";
  const toggleMenu = (menu: Exclude<OpenMenu, null>) =>
    setOpenMenu((current) =>
      current === menu ? null : menu
    );
  const closeMenu = () => {
    // The action can open a dialog. Restore a persistent anchor before the
    // menu item unmounts so the dialog can return focus here when it closes.
    (openMenu === "file" ? fileTriggerRef : helpTriggerRef).current?.focus();
    setOpenMenu(null);
  };
  const openFromKeyboard = (
    event: KeyboardEvent<HTMLButtonElement>,
    menu: Exclude<OpenMenu, null>
  ) => {
    if (event.key === "ArrowDown" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      setOpenMenu(menu);
    }
  };

  useEffect(() => {
    if (!openMenu) {
      return;
    }
    const menuRefs = [fileMenuRef, helpMenuRef];
    const trigger = (openMenu === "file" ? fileTriggerRef : helpTriggerRef).current;
    const closeMenus = () => setOpenMenu(null);
    const closeFromOutside = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (menuRefs.some((menuRef) =>
          menuRef.current?.contains(target)
        ) ||
          menuSurfaceRef.current?.contains(target))
      ) {
        return;
      }
      closeMenus();
    };
    const closeFromKeyboard = (event: globalThis.KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.keyCode === 229 ||
        (document.activeElement !== trigger &&
          !menuSurfaceRef.current?.contains(document.activeElement))
      ) {
        return;
      }
      if (event.key !== "Escape" && event.key !== "Tab") {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
      }
      closeMenus();
      trigger?.focus();
    };

    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromKeyboard);
    window.addEventListener("blur", closeMenus);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeFromKeyboard);
      window.removeEventListener("blur", closeMenus);
    };
  }, [openMenu]);

  return (
    <header className="titlebar">
      <div className="titlebar-brand">
        <span className="brand-mark">
          <Icon name="layers" size={15} />
        </span>
        <span className="brand-name">GitNest</span>
        <span className="build-pill">
          v{runtimeInfo?.appVersion ?? "0.0.1"}
        </span>
      </div>

      <nav className="titlebar-menu" aria-label="应用菜单">
        <div className="titlebar-file-menu" ref={fileMenuRef}>
          <Button variant="unstyled"
            aria-expanded={openMenu === "file"}
            aria-haspopup="menu"
            onClick={() => toggleMenu("file")}
            onKeyDown={(event) => openFromKeyboard(event, "file")}
            ref={fileTriggerRef}
            type="button"
          >
            文件
          </Button>
          {openMenu === "file" && (
            <MenuPopover
              align="start"
              anchor={fileTriggerRef.current}
              autoFocus
              aria-label="文件"
              className="titlebar-file-popover"
              ref={menuSurfaceRef}
              side="bottom"
            >
              <MenuItem
                leading={<Icon name="plus" size={14} />}
                onClick={() => {
                  closeMenu();
                  onCreateWorkspace();
                }}
              >
                新建 Workspace
              </MenuItem>
            </MenuPopover>
          )}
        </div>
        <div className="titlebar-help-menu" ref={helpMenuRef}>
          <Button variant="unstyled"
            aria-expanded={openMenu === "help"}
            aria-haspopup="menu"
            onClick={() => toggleMenu("help")}
            onKeyDown={(event) => openFromKeyboard(event, "help")}
            ref={helpTriggerRef}
            type="button"
          >
            帮助
          </Button>
          {openMenu === "help" && (
            <MenuPopover
              align="start"
              anchor={helpTriggerRef.current}
              autoFocus
              aria-label="帮助"
              className="titlebar-file-popover"
              ref={menuSurfaceRef}
              side="bottom"
            >
              <MenuItem
                leading={<Icon name="search" size={14} />}
                onClick={() => {
                  closeMenu();
                  onOpenSearch();
                }}
              >
                快捷键与命令面板
              </MenuItem>
              <MenuItem
                leading={<Icon name="external" size={14} />}
                onClick={() => {
                  closeMenu();
                  void window.gitnest.system
                    .openIssuesPage()
                    .catch(() => undefined);
                }}
              >
                反馈问题
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                leading={<Icon name="sparkle" size={14} />}
                onClick={() => {
                  closeMenu();
                  onOpenVersion();
                }}
              >
                版本 v{appVersion}
              </MenuItem>
            </MenuPopover>
          )}
        </div>
      </nav>

      <div className="titlebar-drag-region" />

      <div className="titlebar-runtime" aria-label="运行时信息">
        {runtimeInfo
          ? "本地优先 · 数据留在设备"
          : "正在连接本地服务…"}
      </div>

      <Button variant="unstyled"
        aria-controls="global-search-dialog"
        aria-haspopup="dialog"
        aria-pressed={searchOpen}
        className={`titlebar-search${
          searchOpen ? " active" : ""
        }`}
        onClick={onOpenSearch}
        title="全局搜索（Ctrl K）"
        type="button"
      >
        <Icon name="search" size={15} />
        <span>搜索仓库、变更文件、分支或命令</span>
        <kbd>Ctrl K</kbd>
      </Button>

      <div className="titlebar-actions">
        <Button variant="unstyled"
          aria-label="最小化"
          className="window-button"
          onClick={() => void window.gitnest.window.minimize()}
          title="最小化"
          type="button"
        >
          <Icon name="minimize" />
        </Button>
        <Button variant="unstyled"
          aria-label={isMaximized ? "还原" : "最大化"}
          className="window-button"
          onClick={toggleMaximize}
          title={isMaximized ? "还原" : "最大化"}
          type="button"
        >
          <Icon
            name={isMaximized ? "restore" : "maximize"}
            size={14}
          />
        </Button>
        <Button variant="unstyled"
          aria-label="关闭"
          className="window-button window-button-close"
          onClick={() => void window.gitnest.window.close()}
          title="关闭"
          type="button"
        >
          <Icon name="close" />
        </Button>
      </div>
    </header>
  );
}
