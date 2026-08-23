import type { PluginManifestV2 } from "@campusos/shared";

export const manifest: PluginManifestV2 = {
  id: "org.campusos.campus-feed",
  name: "campus-feed",
  displayName: "校园资讯",
  version: "0.1.0",
  apiVersion: 2,
  kind: "feature",
  description: "聚合评奖评优、出国境项目、校园活动与学院通知等分散网站的信息。",
  icon: "feed",
  permissions: [],
  sourceScope: ["campus-websites"],
  releaseStage: "ready",
  provides: [],
  requires: [],
  optionalRequires: [],
  contributes: {
    views: [
      {
        id: "campus-feed-main",
        title: "校园资讯",
        icon: "feed",
        location: "activity",
        activityTarget: "campus-feed",
        order: 40
      }
    ]
  }
};
