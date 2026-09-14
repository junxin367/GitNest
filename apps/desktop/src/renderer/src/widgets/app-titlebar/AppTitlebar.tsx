import { Button } from "../../shared/ui/Button";
import type { RuntimeInfo } from "@gitnest/contracts";
import { useEffect, useRef, useState } from "react";

import type { AppView } from "../../app/navigation";
import { Icon } from "../../shared/ui/Icon";
import {
  MenuItem,
  MenuPopover,
} from "../../shared/ui/Menu";

interface AppTitlebarProps {
  activeView: AppView;
  searchOpen: boolean;
  runtimeInfo: RuntimeInfo | null;
  onCreateWorkspace(): void;
  onNavigate(view: AppView): void;
  onOpenSearch(): void;
}

export function AppTitlebar({
  activeView,
  searchOpen,
  runtimeInfo,
  onCreateWorkspace,
  onNavigate,
  onOpenSearch,
}: AppTitlebarProps) {
  const [openMenu, setOpenMenu] = useState<
"file" | null
  >(null);
  const fileMenuRef = useRef<HTMLDivElement>(null);
  const fileTriggerRef = useRef<HTMLButtonElement>(null);
  const menuSurfaceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const menuRefs = [fileMenuRef];
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
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenus();
      }
    };

    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeFromKeyboard);
    };
  }, []);

  return (
    <header className="titlebar">
      <div className="titlebar-brand">
        <span className="brand-mark">
          <Icon name="layers" size={15} />
        </span>
        <span className="brand-name">GitNest</span>
        <span className="build-pill">
          v{runtimeInfo?.appVersion ?? "1.0.0"}
        </span>
      </div>

      <nav className="titlebar-menu" aria-label="应用菜单">
        <div className="titlebar-file-menu" ref={fileMenuRef}>
          <Button variant="unstyled"
            aria-expanded={openMenu === "file"}
            aria-haspopup="menu"
            onClick={() =>
              setOpenMenu((current) =>
                current === "file" ? null : "file"
              )
            }
            ref={fileTriggerRef}
            type="button"
          >
            文件
          </Button>
          {openMenu === "file" && (
            <MenuPopover
              align="start"
              anchor={fileTriggerRef.current}
              aria-label="文件"
              className="titlebar-file-popover"
              ref={menuSurfaceRef}
              side="bottom"
            >
              <MenuItem
                leading={<Icon name="plus" size={14} />}
                onClick={() => {
                  setOpenMenu(null);
                  onCreateWorkspace();
                }}
              >
                新建 Workspace
              </MenuItem>
            </MenuPopover>
          )}
        </div>
        <Button variant="unstyled"
          aria-current={
            activeView === "operations" ? "page" : undefined
          }
          className={
            activeView === "operations" ? "active" : undefined
          }
          onClick={() => onNavigate("operations")}
          type="button"
        >
          操作中心
        </Button>
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
        <span>搜索仓库、分支或命令</span>
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
          aria-label="最大化或还原"
          className="window-button"
          onClick={() => void window.gitnest.window.toggleMaximize()}
          title="最大化或还原"
          type="button"
        >
          <Icon name="maximize" size={14} />
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
