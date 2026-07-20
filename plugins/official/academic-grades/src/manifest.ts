import type { PluginManifestV2 } from "@campusos/shared";

export const manifest: PluginManifestV2 = {
  id: "org.campusos.academic-grades",
  name: "academic-grades",
  displayName: "学业成绩",
  version: "0.1.0",
  apiVersion: 2,
  kind: "feature",
  description: "通过受控能力绑定展示教务成绩，并基于教务返回的绩点计算加权概览。",
  icon: "Grades",
  permissions: [],
  sourceScope: ["capability:academic.grades"],
  releaseStage: "ready",
  provides: [],
  requires: ["academic.grades@1"],
  optionalRequires: [],
  contributes: {
    views: [
      {
        id: "academic-grades-main",
        title: "成绩",
        icon: "Grades",
        location: "activity",
        activityTarget: "grades",
        order: 20
      }
    ]
  }
};
