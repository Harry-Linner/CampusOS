import type { ActivityItemId } from "@campusos/shared";
import { AppIcon, type AppIconName } from "./AppIcon";

interface ActivityBarProps {
  activeView: ActivityItemId;
  items: Array<{
    id: ActivityItemId;
    label: string;
    icon: AppIconName;
  }>;
  onSelect: (id: ActivityItemId) => void;
}

export const ActivityBar = ({
  activeView,
  items,
  onSelect
}: ActivityBarProps): JSX.Element => {
  const primaryItems = items.filter((item) => item.id !== "settings");
  const settingsItem = items.find((item) => item.id === "settings");

  const renderItem = (item: ActivityBarProps["items"][number]): JSX.Element => (
    <button
      key={item.id}
      className={item.id === activeView ? "nav-item is-active" : "nav-item"}
      aria-current={item.id === activeView ? "page" : undefined}
      type="button"
      onClick={() => onSelect(item.id)}
    >
      <AppIcon name={item.icon} size={19} />
      <span>{item.label}</span>
    </button>
  );

  return (
    <aside className="navigation-rail">
      <div className="brand-lockup" aria-label="CampusOS">
        <span className="brand-symbol" aria-hidden="true">
          C
        </span>
        <strong>CampusOS</strong>
      </div>

      <nav className="primary-navigation" aria-label="主导航">
        {primaryItems.map(renderItem)}
      </nav>

      {settingsItem ? (
        <nav className="utility-navigation" aria-label="应用设置">
          {renderItem(settingsItem)}
        </nav>
      ) : null}
    </aside>
  );
};
