import type { IconName } from "../../shared/ui/Icon";
import { Icon } from "../../shared/ui/Icon";
import type { AppView } from "../../app/navigation";

const primaryItems: Array<{
  id: Exclude<AppView, "settings">;
  label: string;
  icon: IconName;
}> = [
  { id: "workspace", label: "Workspace 总览", icon: "grid" },
  { id: "repository", label: "当前仓库", icon: "repository" },
  { id: "operations", label: "操作中心", icon: "operations" }
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
              item.id === "repository" && !hasRepository
            }
            key={item.label}
            onClick={() => onNavigate(item.id)}
            title={
              item.id === "repository" && !hasRepository
                ? "请先从 Workspace 选择一个仓库"
                : item.label
            }
            type="button"
          >
            <Icon name={item.icon} size={18} />
          </button>
        ))}
      </div>

      <div className="rail-group rail-group-bottom">
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
