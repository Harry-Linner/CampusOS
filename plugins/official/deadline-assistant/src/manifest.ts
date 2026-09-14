import type { PluginManifestV2 } from "@campusos/shared";

export const manifest: PluginManifestV2 = {
  id: "org.campusos.deadline-assistant",
  name: "deadline-assistant",
  displayName: "DDL 日历事件",
  version: "0.1.0",
  apiVersion: 2,
  kind: "feature",
  description: "把具有明确截止时间的学习平台作业转换为统一日历事件。",
  icon: "Deadline",
  permissions: ["storage:domain:calendar"],
  sourceScope: ["capability:learning.assignments", "workspace:calendar"],
  releaseStage: "ready",
  provides: ["calendar.events@1"],
  requires: [
    "learning.assignments@1",
    "core.refresh@1",
    "core.provenance-store@1"
  ],
  optionalRequires: [],
  contributes: {
    syncJobs: ["deadline-events"]
  }
};
