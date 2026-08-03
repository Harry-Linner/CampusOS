import type { PluginManifestV2 } from "@campusos/shared";

export const manifest: PluginManifestV2 = {
  id: "org.campusos.academic",
  name: "academic",
  displayName: "学业",
  version: "0.1.0",
  apiVersion: 2,
  kind: "feature",
  description: "统一查看课表、课程、考试、成绩与实践数据。",
  icon: "Grades",
  permissions: [],
  sourceScope: [
    "capability:academic.timetable",
    "capability:academic.exams",
    "capability:academic.grades"
  ],
  releaseStage: "ready",
  provides: [],
  requires: ["academic.grades@1"],
  optionalRequires: [
    "academic.timetable@1",
    "academic.exams@1",
    "calendar.events@1",
    "practice.records@1"
  ],
  contributes: {
    views: [
      {
        id: "academic-main",
        title: "学业",
        icon: "Grades",
        location: "activity",
        activityTarget: "academic",
        order: 10
      }
    ]
  }
};
