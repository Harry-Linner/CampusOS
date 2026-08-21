import type { PluginManifestV2 } from "@campusos/shared";

export const manifest: PluginManifestV2 = {
  id: "org.campusos.daily-brief",
  name: "daily-brief",
  displayName: "早报",
  version: "0.1.0",
  apiVersion: 2,
  kind: "feature",
  description: "按关注领域聚合外部资讯，生成全中文板块化摘要日报。",
  icon: "brief",
  permissions: [],
  sourceScope: ["service:user-configured-ai"],
  releaseStage: "ready",
  provides: [],
  requires: [],
  optionalRequires: [],
  contributes: {
    views: [
      {
        id: "daily-brief-main",
        title: "早报",
        icon: "brief",
        location: "activity",
        activityTarget: "daily-brief",
        order: 30
      }
    ]
  }
};
