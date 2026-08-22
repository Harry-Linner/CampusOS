import type { PluginManifestV2 } from "@campusos/shared";

export const manifest: PluginManifestV2 = {
  id: "org.campusos.schedule",
  name: "schedule",
  displayName: "日程",
  version: "0.1.0",
  apiVersion: 2,
  kind: "feature",
  description: "统一查看课程、考试、截止事项与个人安排。",
  icon: "Calendar",
  permissions: [],
  sourceScope: ["capability:calendar.events", "workspace:calendar"],
  releaseStage: "ready",
  provides: [],
  requires: ["core.workspace-snapshot@1"],
  optionalRequires: ["calendar.events@1", "tasks.local@1"],
  contributes: {
    views: [
      {
        id: "schedule-main",
        title: "日程",
        icon: "Calendar",
        location: "activity",
        activityTarget: "schedule",
        order: 20
      }
    ]
  }
};
