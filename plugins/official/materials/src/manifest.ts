import type { PluginManifestV2 } from "@campusos/shared";

export const manifest: PluginManifestV2 = {
  id: "org.campusos.materials",
  name: "materials",
  displayName: "资料",
  version: "0.2.0",
  apiVersion: 2,
  kind: "feature",
  description: "按课程浏览资料，并通过 Core 下载队列安全保存文件。",
  icon: "Materials",
  permissions: ["storage:domain:materials"],
  sourceScope: ["workspace:materials", "workspace:downloads"],
  releaseStage: "ready",
  provides: [],
  requires: ["core.workspace-snapshot@1"],
  optionalRequires: ["academic.course-catalog@1"],
  contributes: {
    views: [
      {
        id: "materials-main",
        title: "资料",
        icon: "Materials",
        location: "activity",
        activityTarget: "materials",
        order: 30
      }
    ]
  }
};
