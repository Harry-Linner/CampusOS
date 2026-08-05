import type { PluginManifestV2 } from "@campusos/shared";

export const manifest: PluginManifestV2 = {
  id: "org.campusos.ai-assistant",
  name: "ai-assistant",
  displayName: "AI 助手",
  version: "0.1.0",
  apiVersion: 2,
  kind: "feature",
  description: "将主动粘贴的任务消息解析为可编辑草稿，并确认写入日程。",
  icon: "Assistant",
  permissions: [],
  sourceScope: ["workspace:assistant", "workspace:calendar"],
  releaseStage: "ready",
  provides: [],
  requires: ["core.workspace-snapshot@1"],
  optionalRequires: ["tasks.local@1", "planner.schedule@1"],
  contributes: {
    views: [
      {
        id: "ai-assistant-main",
        title: "AI 助手",
        icon: "Assistant",
        location: "activity",
        activityTarget: "ai-assistant",
        order: 25
      }
    ]
  }
};
