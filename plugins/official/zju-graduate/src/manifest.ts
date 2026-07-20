import type { PluginManifestV2 } from "@campusos/shared";

export const manifest: PluginManifestV2 = {
  id: "org.campusos.zju-graduate",
  name: "zju-graduate",
  displayName: "浙大研究生教务",
  version: "0.1.0",
  apiVersion: 2,
  kind: "connector",
  description: "通过核心托管的研究生院业务 token 读取课表、考试与成绩，不接触账号密码或 token。",
  icon: "ZJU",
  permissions: [
    "data:account:academic-profile",
    "auth:service:https://yjsy.zju.edu.cn",
    "network:https://yjsy.zju.edu.cn",
    "storage:domain:academic"
  ],
  sourceScope: ["浙大统一身份认证", "浙大研究生院"],
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
    syncJobs: ["zju-graduate"]
  }
};
