import type { PluginManifestV2 } from "@campusos/shared";

export const manifest: PluginManifestV2 = {
  id: "org.campusos.zju-learning",
  name: "zju-learning",
  displayName: "学在浙大作业",
  version: "0.1.0",
  apiVersion: 2,
  kind: "connector",
  description: "通过核心托管的学在浙大会话读取作业和截止时间，不接触账号密码或 Cookie。",
  icon: "DDL",
  permissions: [
    "data:account:academic-profile",
    "auth:service:https://courses.zju.edu.cn",
    "network:https://courses.zju.edu.cn",
    "storage:domain:academic"
  ],
  sourceScope: ["浙大统一身份认证", "学在浙大"],
  releaseStage: "ready",
  provides: ["learning.assignments@1"],
  requires: [
    "core.auth.zju-verification@1",
    "core.auth.zju-service-session@1",
    "core.refresh@1",
    "core.provenance-store@1"
  ],
  optionalRequires: [],
  contributes: {
    syncJobs: ["zju-learning"]
  }
};
