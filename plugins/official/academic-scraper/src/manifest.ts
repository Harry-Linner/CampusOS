import { firstWaveSources, type PluginManifestV2 } from "@campusos/shared";

export const manifest: PluginManifestV2 = {
  id: "org.campusos.academic-scraper",
  name: "academic-scraper",
  displayName: "旧版教务抓取",
  version: "0.2.0",
  apiVersion: 2,
  kind: "connector",
  description: "旧版单体入口已停止扩张，将由独立教务与学习平台连接器替代。",
  icon: "Academic",
  permissions: [],
  sourceScope: [...firstWaveSources],
  releaseStage: "placeholder",
  provides: [],
  requires: [],
  optionalRequires: [],
  contributes: {}
};
