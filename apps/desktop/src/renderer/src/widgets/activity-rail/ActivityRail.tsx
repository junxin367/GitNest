import type { IconName } from "../../shared/ui/Icon";
import { Icon } from "../../shared/ui/Icon";
import type { AppView } from "../../app/navigation";

const primaryItems: Array<{
  id: Exclude<AppView, "settings"> | "search";
  label: string;
  icon: IconName;
}> = [
  { id: "workspace", label: "Workspace 总览", icon: "grid" },
  { id: "repository", label: "当前仓库", icon: "repository" },
  { id: "operations", label: "操作中心", icon: "operations" },
  { id: "search", label: "搜索", icon: "search" }
];

interface ActivityRailProps {
  activeView: AppView;
  hasRepository: boolean;
  onNavigate(view: AppView): void;
}

export function ActivityRail({
  activeView,
  hasRepository,
  onNavigate
}: ActivityRailProps) {
  return (
    <nav className="activity-rail" aria-label="主导航">
      <div className="rail-brand" aria-hidden="true">
        <Icon name="layers" size={19} />
      </div>

      <div className="rail-group">
        {primaryItems.map((item) => (
          <button
            aria-current={
              item.id === activeView ? "page" : undefined
            }
            aria-label={item.label}
            className={`rail-button${
              item.id === activeView ? " active" : ""
            }`}
            disabled={
              (item.id === "repository" && !hasRepository) ||
              item.id === "search"
            }
            key={item.label}
            onClick={() => {
              if (
                item.id === "workspace" ||
                item.id === "repository" ||
                item.id === "operations"
              ) {
                onNavigate(item.id);
              }
            }}
            title={item.label}
            type="button"
          >
            <Icon name={item.icon} size={18} />
          </button>
        ))}
      </div>

      <div className="rail-group rail-group-bottom">
        <button
          aria-label="外部终端"
          className="rail-button"
          disabled
          title="外部终端位于仓库顶部工具栏"
          type="button"
        >
          <Icon name="terminal" size={18} />
        </button>
        <button
          aria-label="设置"
          aria-current={
            activeView === "settings" ? "page" : undefined
          }
          className={`rail-button${
            activeView === "settings" ? " active" : ""
          }`}
          onClick={() => onNavigate("settings")}
          title="设置"
          type="button"
        >
          <Icon name="settings" size={18} />
        </button>
      </div>
    </nav>
  );
}
