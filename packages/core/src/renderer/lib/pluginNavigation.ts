import type { ActivityItemId } from "@campusos/shared";
import type { AppIconName } from "../components/AppIcon";
import type { LoadedPlugin } from "./pluginHost";

export interface ActivitySubTab {
  id: string;
  label: string;
  viewId: string;
}

export interface ActivityNavigationItem {
  id: ActivityItemId;
  label: string;
  icon: AppIconName;
  /** 侧栏子 Tab：parent 视图下的子视图（含 parent 自身作为默认项）。 */
  subTabs?: ActivitySubTab[];
}

const leadingItems: ActivityNavigationItem[] = [
  { id: "dashboard", label: "总览", icon: "overview" }
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
    case "assistant":
    case "aiassistant":
      return "assistant";
    case "brief":
    case "dailybrief":
      return "brief";
    case "feed":
    case "campusfeed":
      return "feed";
    case "overview":
      return "overview";
    case "settings":
      return "settings";
    default:
      return "extensions";
  }
};

interface CandidateView {
  pluginId: string;
  view: {
    id: string;
    title: string;
    icon: string;
    order?: number;
    activityTarget?: string;
    parentActivityTarget?: string;
  };
}

const collectCandidates = (plugins: readonly LoadedPlugin[]): CandidateView[] =>
  plugins
    .flatMap((plugin) => {
      if (plugin.runtime.status !== "active" || !plugin.Component) return [];

      return (plugin.manifest.contributes.views ?? [])
        .filter((view) => view.location === "activity" && view.activityTarget)
        .map((view) => ({ pluginId: plugin.manifest.id, view }));
    })
    .sort(
      (left, right) =>
        (left.view.order ?? 100) - (right.view.order ?? 100) ||
        left.view.title.localeCompare(right.view.title) ||
        left.pluginId.localeCompare(right.pluginId)
    );

export const buildActivityItems = (
  plugins: readonly LoadedPlugin[]
): ActivityNavigationItem[] => {
  const reservedTargets = new Set(
    [...leadingItems, ...trailingItems].map((item) => item.id)
  );
  const candidates = collectCandidates(plugins);
  const byTarget = new Map<string, CandidateView[]>();
  const childrenByParent = new Map<string, CandidateView[]>();

  for (const candidate of candidates) {
    const target = candidate.view.activityTarget as string;
    const parent = candidate.view.parentActivityTarget;
    if (parent !== undefined && parent !== "") {
      const list = childrenByParent.get(parent) ?? [];
      list.push(candidate);
      childrenByParent.set(parent, list);
      continue;
    }
    const list = byTarget.get(target) ?? [];
    list.push(candidate);
    byTarget.set(target, list);
  }

  const dynamicItems: ActivityNavigationItem[] = [];
  for (const [target, views] of byTarget) {
    if (reservedTargets.has(target)) continue;
    reservedTargets.add(target);

    const primary = views[0];
    const children = childrenByParent.get(target) ?? [];
    const subTabs: ActivitySubTab[] = [
      ...views.map((view) => ({
        id: `${view.pluginId}:${view.view.id}`,
        label: view.view.title,
        viewId: `${view.pluginId}:${view.view.id}`
      })),
      ...children.map((view) => ({
        id: `${view.pluginId}:${view.view.id}`,
        label: view.view.title,
        viewId: `${view.pluginId}:${view.view.id}`
      }))
    ];

    const label = primary?.view.title ?? children[0]?.view.title ?? target;
    const icon = primary?.view.icon ?? children[0]?.view.icon ?? "extensions";
    dynamicItems.push({
      id: target,
      label,
      icon: resolveActivityIcon(icon),
      ...(subTabs.length > 1 ? { subTabs } : {})
    });
  }

  // 父项自身无独立视图、只有子 Tab 时，也要生成一级入口。
  for (const [parent, children] of childrenByParent) {
    if (reservedTargets.has(parent) || byTarget.has(parent)) continue;
    reservedTargets.add(parent);
    dynamicItems.push({
      id: parent,
      label: children[0]?.view.title ?? parent,
      icon: resolveActivityIcon(children[0]?.view.icon ?? "extensions"),
      subTabs: children.map((view) => ({
        id: `${view.pluginId}:${view.view.id}`,
        label: view.view.title,
        viewId: `${view.pluginId}:${view.view.id}`
      }))
    });
  }

  return [...leadingItems, ...dynamicItems, ...trailingItems];
};
