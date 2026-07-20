import type { PluginManifestV2 } from "@campusos/shared";

export const manifest: PluginManifestV2 = {
  id: "org.campusos.exam-countdown",
  name: "exam-countdown",
  displayName: "考试倒计时",
  version: "0.1.0",
  apiVersion: 2,
  kind: "feature",
  description: "显示下一场考试的倒计时（距离开考的天数与小时数）。",
  icon: "Grades",
  permissions: ["storage:domain:calendar"],
  sourceScope: ["capability:calendar.events", "workspace:calendar"],
  releaseStage: "ready",
  provides: [],
  requires: ["calendar.events@1", "core.workspace-snapshot@1"],
  optionalRequires: [],
  contributes: {
    views: [
      {
        id: "exam-countdown-main",
        title: "考试倒计时",
        icon: "Grades",
        location: "activity",
        activityTarget: "exam-countdown",
        order: 25
      }
    ]
  }
};
