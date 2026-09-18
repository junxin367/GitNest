import { Button } from "../../shared/ui/Button";
import type { IconName } from "../../shared/ui/Icon";
import { Icon } from "../../shared/ui/Icon";
import type { AppView } from "../../app/navigation";

const primaryItems: Array<{
  id: "workspace" | "analysis" | "operations";
  label: string;
  icon: IconName;
}> = [
  { id: "workspace", label: "Workspace 总览", icon: "grid" },
  { id: "analysis", label: "代码分析", icon: "graph" },
  { id: "operations", label: "操作中心", icon: "operations" }
];

interface ActivityRailProps {
  activeView: AppView;
  operationAttentionCount: number;
  searchOpen: boolean;
  sidebarCollapsed: boolean;
  terminalDisabled: boolean;
  terminalTitle: string;
  theme: "dark" | "light";
  onNavigate(view: AppView): void;
  onOpenSearch(): void;
  onOpenTerminal(): void;
  onToggleSidebar(): void;
  onToggleTheme(): void;
}

export function ActivityRail({
  activeView,
  operationAttentionCount,
  searchOpen,
  sidebarCollapsed,
  terminalDisabled,
  terminalTitle,
  theme,
  onNavigate,
  onOpenSearch,
  onOpenTerminal,
  onToggleSidebar,
  onToggleTheme
}: ActivityRailProps) {
  return (
    <nav className="activity-rail" aria-label="主导航">
      <Button variant="unstyled"
        aria-label={
          sidebarCollapsed ? "展开仓库目录" : "折叠仓库目录"
        }
        aria-pressed={sidebarCollapsed}
        className="rail-button"
        onClick={onToggleSidebar}
        title={
          sidebarCollapsed ? "展开仓库目录" : "折叠仓库目录"
        }
        type="button"
      >
        <Icon
          name={
            sidebarCollapsed ? "sidebarExpand" : "sidebarCollapse"
          }
          size={20}
        />
      </Button>
      <div className="rail-divider" aria-hidden="true" />
      {primaryItems.map((item) => (
        <Button variant="unstyled"
          aria-current={item.id === activeView ? "page" : undefined}
          aria-label={item.label}
          className={`rail-button${
            item.id === activeView ? " active" : ""
          }`}
          key={item.id}
          onClick={() => onNavigate(item.id)}
          title={item.label}
          type="button"
        >
          <Icon name={item.icon} size={20} />
          {item.id === "operations" && operationAttentionCount > 0 ? (
            <span className="rail-badge">
              {operationAttentionCount > 99
                ? "99+"
                : operationAttentionCount}
            </span>
          ) : null}
        </Button>
      ))}
      <Button variant="unstyled"
        aria-label="全局搜索"
        aria-pressed={searchOpen}
        className={`rail-button${searchOpen ? " active" : ""}`}
        onClick={onOpenSearch}
        title="全局搜索"
        type="button"
      >
        <Icon name="search" size={20} />
      </Button>
      <div className="rail-spacer" />
      <Button variant="unstyled"
        aria-label="打开终端"
        className="rail-button"
        disabled={terminalDisabled}
        onClick={onOpenTerminal}
        title={terminalTitle}
        type="button"
      >
        <Icon name="terminal" size={20} />
      </Button>
      <Button variant="unstyled"
        aria-label={
          theme === "dark" ? "切换浅色主题" : "切换深色主题"
        }
        className="rail-button"
        onClick={onToggleTheme}
        title={
          theme === "dark" ? "切换浅色主题" : "切换深色主题"
        }
        type="button"
      >
        <Icon name={theme === "dark" ? "sun" : "moon"} size={20} />
      </Button>
      <Button variant="unstyled"
        aria-label="设置"
        aria-current={activeView === "settings" ? "page" : undefined}
        className={`rail-button${
          activeView === "settings" ? " active" : ""
        }`}
        onClick={() => onNavigate("settings")}
        title="设置"
        type="button"
      >
        <Icon name="settings" size={20} />
      </Button>
    </nav>
  );
}
