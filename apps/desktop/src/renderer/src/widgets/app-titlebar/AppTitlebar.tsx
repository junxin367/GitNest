import type { RuntimeInfo } from "@gitnest/contracts";

import { Icon } from "../../shared/ui/Icon";

interface AppTitlebarProps {
  runtimeInfo: RuntimeInfo | null;
  theme: "dark" | "light";
  onToggleTheme(): void;
}

export function AppTitlebar({
  runtimeInfo,
  theme,
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
          1.0 · Release candidate
        </span>
      </div>

      <nav className="titlebar-menu" aria-label="应用菜单">
        <button type="button">Workspace</button>
        <button type="button">仓库</button>
        <button type="button">帮助</button>
      </nav>

      <div className="titlebar-drag-region" />

      <div className="titlebar-runtime" aria-label="运行时信息">
        {runtimeInfo
          ? `Electron ${runtimeInfo.electronVersion}`
          : "正在连接 Main…"}
      </div>

      <div className="titlebar-actions">
        <button
          aria-label={theme === "dark" ? "切换浅色主题" : "切换深色主题"}
          className="titlebar-icon-button"
          onClick={onToggleTheme}
          type="button"
        >
          <Icon name={theme === "dark" ? "sun" : "moon"} />
        </button>
        <button
          aria-label="最小化"
          className="window-button"
          onClick={() => void window.gitnest.window.minimize()}
          type="button"
        >
          <Icon name="minimize" />
        </button>
        <button
          aria-label="最大化或还原"
          className="window-button"
          onClick={() => void window.gitnest.window.toggleMaximize()}
          type="button"
        >
          <Icon name="maximize" size={14} />
        </button>
        <button
          aria-label="关闭"
          className="window-button window-button-close"
          onClick={() => void window.gitnest.window.close()}
          type="button"
        >
          <Icon name="close" />
        </button>
      </div>
    </header>
  );
}
