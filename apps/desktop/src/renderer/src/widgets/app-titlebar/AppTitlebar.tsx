import { Button } from "../../shared/ui/Button";
import type { RuntimeInfo } from "@gitnest/contracts";
import { useEffect, useRef, useState } from "react";

import type { AppView } from "../../app/navigation";
import { Icon } from "../../shared/ui/Icon";
import {
  MenuItem,
  MenuPopover,
  MenuSeparator
} from "../../shared/ui/Menu";

interface AppTitlebarProps {
  activeView: AppView;
  hasRepository: boolean;
  inspectorOpen: boolean;
  layoutControlsDisabled: boolean;
  searchOpen: boolean;
  runtimeInfo: RuntimeInfo | null;
  sidebarCollapsed: boolean;
  theme: "dark" | "light";
  onCreateWorkspace(): void;
  onNavigate(view: AppView): void;
  onOpenSearch(): void;
  onResetLayout(): void;
  onToggleInspector(): void;
  onToggleSidebar(): void;
  onToggleTheme(): void;
}

export function AppTitlebar({
  activeView,
  hasRepository,
  inspectorOpen,
  layoutControlsDisabled,
  searchOpen,
  runtimeInfo,
  sidebarCollapsed,
  theme,
  onCreateWorkspace,
  onNavigate,
  onOpenSearch,
  onResetLayout,
  onToggleInspector,
  onToggleSidebar,
  onToggleTheme
}: AppTitlebarProps) {
  const [openMenu, setOpenMenu] = useState<
    "file" | "view" | null
  >(null);
  const fileMenuRef = useRef<HTMLDivElement>(null);
  const fileTriggerRef = useRef<HTMLButtonElement>(null);
  const viewMenuRef = useRef<HTMLDivElement>(null);
  const viewTriggerRef = useRef<HTMLButtonElement>(null);
  const menuSurfaceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const menuRefs = [fileMenuRef, viewMenuRef];
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
            activeView === "repository" ? "page" : undefined
          }
          className={
            activeView === "repository" ? "active" : undefined
          }
          disabled={!hasRepository}
          onClick={() => onNavigate("repository")}
          title={
            hasRepository
              ? "打开当前仓库"
              : "请先从 Workspace 选择一个仓库"
          }
          type="button"
        >
          仓库
        </Button>
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
        <div className="titlebar-view-menu" ref={viewMenuRef}>
          <Button variant="unstyled"
            aria-expanded={openMenu === "view"}
            aria-haspopup="menu"
            onClick={() =>
              setOpenMenu((current) =>
                current === "view" ? null : "view"
              )
            }
            ref={viewTriggerRef}
            type="button"
          >
            视图
          </Button>
          {openMenu === "view" && (
            <MenuPopover
              align="start"
              anchor={viewTriggerRef.current}
              aria-label="视图选项"
              className="titlebar-view-popover"
              ref={menuSurfaceRef}
              side="bottom"
            >
              <MenuItem
                aria-checked={
                  !layoutControlsDisabled && !sidebarCollapsed
                }
                disabled={layoutControlsDisabled}
                leading={
                  <Icon
                    name={
                      sidebarCollapsed
                        ? "sidebarExpand"
                        : "sidebarCollapse"
                    }
                    size={14}
                  />
                }
                onClick={() => {
                  setOpenMenu(null);
                  onToggleSidebar();
                }}
                role="menuitemcheckbox"
              >
                {sidebarCollapsed
                  ? "显示仓库目录"
                  : "隐藏仓库目录"}
              </MenuItem>
              <MenuItem
                aria-checked={
                  !layoutControlsDisabled && inspectorOpen
                }
                disabled={layoutControlsDisabled}
                leading={<Icon name="panel" size={14} />}
                onClick={() => {
                  setOpenMenu(null);
                  onToggleInspector();
                }}
                role="menuitemcheckbox"
              >
                {inspectorOpen
                  ? "隐藏详情面板"
                  : "显示详情面板"}
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                leading={
                  <Icon
                    name={theme === "dark" ? "sun" : "moon"}
                    size={14}
                  />
                }
                onClick={() => {
                  setOpenMenu(null);
                  onToggleTheme();
                }}
              >
                {theme === "dark"
                  ? "切换为浅色主题"
                  : "切换为深色主题"}
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                leading={<Icon name="refresh" size={14} />}
                onClick={() => {
                  setOpenMenu(null);
                  onResetLayout();
                }}
              >
                重置布局
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
