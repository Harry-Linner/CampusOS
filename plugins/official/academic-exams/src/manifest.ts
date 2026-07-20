import type { PluginManifestV2 } from "@campusos/shared";

export const manifest: PluginManifestV2 = {
  id: "org.campusos.academic-exams",
  name: "academic-exams",
  displayName: "考试日历事件",
  version: "0.1.0",
  apiVersion: 2,
  kind: "feature",
  description: "把具有明确绝对时间的教务考试转换为统一日历事件。",
  icon: "Exam",
  permissions: ["storage:domain:calendar"],
  sourceScope: ["capability:academic.exams", "workspace:calendar"],
  releaseStage: "ready",
  provides: ["calendar.events@1"],
  requires: [
    "academic.exams@1",
    "core.refresh@1",
    "core.provenance-store@1"
  ],
  optionalRequires: [],
  contributes: {
    syncJobs: ["academic-exams-events"]
  }
};
