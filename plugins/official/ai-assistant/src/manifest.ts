import type { PluginManifestV2 } from "@campusos/shared";

export const manifest: PluginManifestV2 = {
  id: "org.campusos.ai-assistant",
  name: "ai-assistant",
  displayName: "AI 助手",
  version: "0.1.0",
  apiVersion: 2,
  kind: "feature",
  description: "使用用户配置的 AI 服务将主动粘贴的消息解析为可编辑草稿，并确认写入日程。",
  icon: "Assistant",
  permissions: [],
  sourceScope: ["workspace:assistant", "workspace:calendar", "service:user-configured-ai"],
  releaseStage: "ready",
  provides: [],
  requires: ["core.workspace-snapshot@1"],
  optionalRequires: ["tasks.local@1"],
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
