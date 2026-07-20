import type { PluginManifestV2 } from "@campusos/shared";

export const manifest: PluginManifestV2 = {
  id: "org.campusos.dingtalk-entry",
  name: "dingtalk-entry",
  displayName: "钉钉入口",
  version: "0.2.0",
  apiVersion: 2,
  kind: "connector",
  description: "仅保留未来登录与消息导入方向，不参与当前运行时激活。",
  icon: "Dingtalk",
  permissions: [],
  sourceScope: ["钉钉登录入口", "消息导入入口"],
  releaseStage: "placeholder",
  provides: [],
  requires: [],
  optionalRequires: [],
  contributes: {}
};
