import type { PluginManifestV2 } from "@campusos/shared";

export const manifest: PluginManifestV2 = {
  id: "org.campusos.calendar-workspace",
  name: "calendar-workspace",
  displayName: "日历工作台",
  version: "0.3.0",
  apiVersion: 2,
  kind: "feature",
  description: "消费统一事件能力，展示课程、考试、截止事项、提醒与后续自动规划结果。",
  icon: "Calendar",
  permissions: ["storage:domain:calendar", "notification"],
  sourceScope: ["capability:calendar.events", "workspace:reminders"],
  releaseStage: "ready",
  provides: [],
  requires: ["core.workspace-snapshot@1", "calendar.events@1"],
  optionalRequires: ["planner.schedule@1"],
  contributes: {
    views: [
      {
        id: "calendar-main",
        title: "日历",
        icon: "Calendar",
        location: "activity",
        activityTarget: "calendar",
        order: 1
      }
    ]
  }
};
