import type { PluginManifestV2 } from "@campusos/shared";

export const manifest: PluginManifestV2 = {
  id: "org.campusos.academic-timetable-events",
  name: "academic-timetable-events",
  displayName: "课程日历事件",
  version: "0.1.0",
  apiVersion: 2,
  kind: "feature",
  description: "把具有可信节次时间的课表展开为统一日历课程事件。",
  icon: "Calendar",
  permissions: ["storage:domain:calendar"],
  sourceScope: ["capability:academic.timetable", "capability:academic.calendar-config", "workspace:calendar"],
  releaseStage: "ready",
  provides: ["calendar.events@1"],
  requires: [
    "academic.timetable@1",
    "academic.calendar-config@1",
    "core.refresh@1",
    "core.provenance-store@1"
  ],
  optionalRequires: [],
  contributes: {
    syncJobs: ["timetable-events"]
  }
};
