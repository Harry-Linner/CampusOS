import type {
  PluginCapability,
  PluginManifestV2,
  PluginRuntimeSnapshot
} from "@campusos/shared";
import { manifest as academicManifest } from "@campusos/plugin-academic/manifest";
import { manifest as scheduleManifest } from "@campusos/plugin-schedule/manifest";
import { manifest as materialsManifest } from "@campusos/plugin-materials/manifest";
import { manifest as zjuUndergraduateManifest } from "@campusos/plugin-zju-undergraduate/manifest";
import { manifest as zjuCalendarConfigManifest } from "@campusos/plugin-zju-calendar-config/manifest";
import { manifest as zjuLearningManifest } from "@campusos/plugin-zju-learning/manifest";
import { manifest as zjuGraduateManifest } from "@campusos/plugin-zju-graduate/manifest";
import { manifest as academicExamsManifest } from "@campusos/plugin-academic-exams/manifest";
import { manifest as deadlineAssistantManifest } from "@campusos/plugin-deadline-assistant/manifest";
import { manifest as academicTimetableEventsManifest } from "@campusos/plugin-academic-timetable-events/manifest";
import { manifest as assistantManifest } from "@campusos/plugin-ai-assistant/manifest";
import { manifest as campusFeedManifest } from "@campusos/plugin-campus-feed/manifest";

/**
 * User-selectable Modules. Each contributes exactly one activity entry.
 *
 * daily-brief（早报）已于 2026-08-25 用户决议移出官方名单并暂停开发
 * （功能边界未厘清、设计过重），故不再出现在本列表；其代码与 IPC 保留，
 * 未从仓库删除，后续如需恢复开发再重新接入。
 */
export const officialUserPluginManifests: PluginManifestV2[] = [
  academicManifest,
  scheduleManifest,
  assistantManifest,
  campusFeedManifest,
  materialsManifest
];

/**
 * Core-owned Adapters and event projections.
 *
 * Their stable IDs remain unchanged because capability provenance and cached
 * records use those IDs. They participate in the internal dependency graph,
 * but are never exposed through the user plugin Interface.
 */
export const officialCoreModuleManifests: PluginManifestV2[] = [
  zjuCalendarConfigManifest,
  zjuUndergraduateManifest,
  zjuGraduateManifest,
  zjuLearningManifest,
  academicExamsManifest,
  deadlineAssistantManifest,
  academicTimetableEventsManifest
];

export const officialRuntimeManifests: PluginManifestV2[] = [
  ...officialUserPluginManifests,
  ...officialCoreModuleManifests
];

const officialCoreModuleIds = new Set(
  officialCoreModuleManifests.map((manifest) => manifest.id)
);

export const toUserPluginSnapshot = (
  snapshot: PluginRuntimeSnapshot
): PluginRuntimeSnapshot => ({
  ...snapshot,
  plugins: snapshot.plugins.filter(
    (plugin) => !officialCoreModuleIds.has(plugin.id)
  )
});

export const corePluginCapabilities: PluginCapability[] = [
  "core.workspace-snapshot@1",
  "core.auth.zju-verification@1",
  "core.auth.zju-service-session@1",
  "core.refresh@1",
  "core.provenance-store@1"
];
