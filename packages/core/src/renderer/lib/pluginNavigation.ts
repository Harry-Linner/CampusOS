import type { ActivityItemId } from "@campusos/shared";
import type { AppIconName } from "../components/AppIcon";
import type { LoadedPlugin } from "./pluginHost";

export interface ActivityNavigationItem {
  id: ActivityItemId;
  label: string;
  icon: AppIconName;
}

const leadingItems: ActivityNavigationItem[] = [
  { id: "dashboard", label: "总览", icon: "overview" },
  { id: "calendar", label: "日历", icon: "calendar" }
];

const trailingItems: ActivityNavigationItem[] = [
  { id: "extensions", label: "扩展", icon: "extensions" },
  { id: "settings", label: "设置", icon: "settings" }
];

const resolveActivityIcon = (icon: string): AppIconName => {
  switch (icon.trim().toLowerCase()) {
    case "calendar":
      return "calendar";
    case "grades":
    case "academicgrades":
      return "grades";
    case "materials":
      return "materials";
    case "overview":
      return "overview";
    case "settings":
      return "settings";
    default:
      return "extensions";
  }
};

export const buildActivityItems = (
  plugins: readonly LoadedPlugin[]
): ActivityNavigationItem[] => {
  const reservedTargets = new Set(
    [...leadingItems, ...trailingItems].map((item) => item.id)
  );
  const dynamicItems: ActivityNavigationItem[] = [];
  const views = plugins
    .flatMap((plugin) => {
      if (plugin.runtime.status !== "active" || !plugin.Component) return [];

      return (plugin.manifest.contributes.views ?? [])
        .filter(
          (view) => view.location === "activity" && view.activityTarget
        )
        .map((view) => ({ pluginId: plugin.manifest.id, view }));
    })
    .sort((left, right) =>
      (left.view.order ?? 100) - (right.view.order ?? 100) ||
      left.view.title.localeCompare(right.view.title) ||
      left.pluginId.localeCompare(right.pluginId)
    );

  for (const { view } of views) {
    const target = view.activityTarget as string;
    if (reservedTargets.has(target)) continue;

    reservedTargets.add(target);
    dynamicItems.push({
      id: target,
      label: view.title,
      icon: resolveActivityIcon(view.icon)
    });
  }

  return [...leadingItems, ...dynamicItems, ...trailingItems];
};
