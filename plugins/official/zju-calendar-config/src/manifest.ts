import type { PluginManifestV2 } from "@campusos/shared";

export const manifest: PluginManifestV2 = {
  id: "org.campusos.zju-calendar-config",
  name: "zju-calendar-config",
  displayName: "浙大官方校历",
  version: "0.1.0",
  apiVersion: 2,
  kind: "connector",
  description: "从浙江大学官网读取四学季边界与开课日期，不使用第三方明文校历源。",
  icon: "CalendarRange",
  permissions: [
    "network:https://www.zju.edu.cn",
    "storage:domain:academic"
  ],
  sourceScope: ["浙江大学官网学术日历"],
  releaseStage: "ready",
  provides: ["academic.calendar-config@1"],
  requires: ["core.refresh@1", "core.provenance-store@1"],
  optionalRequires: [],
  contributes: {
    syncJobs: ["zju-calendar-config"]
  }
};
