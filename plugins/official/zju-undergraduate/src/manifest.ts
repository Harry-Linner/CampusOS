import type { PluginManifestV2 } from "@campusos/shared";

export const manifest: PluginManifestV2 = {
  id: "org.campusos.zju-undergraduate",
  name: "zju-undergraduate",
  displayName: "浙大本科教务",
  version: "0.4.0",
  apiVersion: 2,
  kind: "connector",
  description: "通过核心托管的教务业务会话读取本科课表、考试与成绩，不接触账号密码或 Cookie。",
  icon: "ZJU",
  permissions: [
    "data:account:academic-profile",
    "auth:service:https://zdbk.zju.edu.cn",
    "network:https://zdbk.zju.edu.cn",
    "storage:domain:academic"
  ],
  sourceScope: ["浙大统一身份认证", "浙大本科教务网"],
  releaseStage: "ready",
  provides: [
    "academic.profile@1",
    "academic.timetable@1",
    "academic.exams@1",
    "academic.grades@1"
  ],
  requires: [
    "core.auth.zju-verification@1",
    "core.auth.zju-service-session@1",
    "core.refresh@1",
    "core.provenance-store@1"
  ],
  optionalRequires: [],
  contributes: {
    syncJobs: ["zju-undergraduate"]
  }
};
