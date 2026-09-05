import type { RuntimeInfo } from "@gitnest/contracts";

import type { AppView } from "../../app/navigation";
import { Icon } from "../../shared/ui/Icon";

interface AppTitlebarProps {
  activeView: AppView;
  hasRepository: boolean;
  runtimeInfo: RuntimeInfo | null;
  theme: "dark" | "light";
  onNavigate(view: AppView): void;
  onToggleTheme(): void;
}

export function AppTitlebar({
  activeView,
  hasRepository,
  runtimeInfo,
  theme,
  onNavigate,
  onToggleTheme
}: AppTitlebarProps) {
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
        <button
          aria-current={
            activeView === "workspace" ? "page" : undefined
          }
          className={
            activeView === "workspace" ? "active" : undefined
          }
          onClick={() => onNavigate("workspace")}
          type="button"
        >
          Workspace
        </button>
        <button
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
        </button>
        <button
          aria-current={
            activeView === "operations" ? "page" : undefined
          }
          className={
            activeView === "operations" ? "active" : undefined
          }
          onClick={() => onNavigate("operations")}
          type="button"
        >
          操作
        </button>
      </nav>

      <div className="titlebar-drag-region" />

      <div className="titlebar-runtime" aria-label="运行时信息">
        {runtimeInfo
          ? "本地优先 · 数据留在设备"
          : "正在连接本地服务…"}
      </div>

      <div className="titlebar-actions">
        <button
          aria-label={theme === "dark" ? "切换浅色主题" : "切换深色主题"}
          className="titlebar-icon-button"
          onClick={onToggleTheme}
          title={
            theme === "dark" ? "切换浅色主题" : "切换深色主题"
          }
          type="button"
        >
          <Icon name={theme === "dark" ? "sun" : "moon"} />
        </button>
        <button
          aria-label="最小化"
          className="window-button"
          onClick={() => void window.gitnest.window.minimize()}
          title="最小化"
          type="button"
        >
          <Icon name="minimize" />
        </button>
        <button
          aria-label="最大化或还原"
          className="window-button"
          onClick={() => void window.gitnest.window.toggleMaximize()}
          title="最大化或还原"
          type="button"
        >
          <Icon name="maximize" size={14} />
        </button>
        <button
          aria-label="关闭"
          className="window-button window-button-close"
          onClick={() => void window.gitnest.window.close()}
          title="关闭"
          type="button"
        >
          <Icon name="close" />
        </button>
      </div>
    </header>
  );
}
