import { describe, expect, it } from "vitest";
import {
  getSandboxedRendererExecutionIssue,
  type PluginManifestV2
} from "@campusos/shared";

const eligibleManifest: PluginManifestV2 = {
  id: "dev.example.countdown",
  name: "countdown",
  displayName: "考试倒计时",
  version: "1.0.0",
  apiVersion: 2,
  kind: "feature",
  description: "显示考试倒计时。",
  icon: "Clock",
  permissions: ["storage:local"],
  sourceScope: ["local"],
  releaseStage: "ready",
  provides: [],
  requires: [],
  optionalRequires: [],
  contributes: {
    views: [{
      id: "countdown-main",
      title: "倒计时",
      icon: "Clock",
      location: "activity",
      activityTarget: "mod-dev-example-countdown"
    }]
  }
};

describe("third-party renderer sandbox policy", () => {
  it("admits only the namespaced local-storage view profile", () => {
    expect(getSandboxedRendererExecutionIssue(eligibleManifest)).toBeNull();
    expect(getSandboxedRendererExecutionIssue({
      ...eligibleManifest,
      permissions: ["network:https://example.com"]
    })).toContain("只开放 storage:local");
    expect(getSandboxedRendererExecutionIssue({
      ...eligibleManifest,
      contributes: {
        ...eligibleManifest.contributes,
        commands: ["countdown.open"]
      }
    })).toContain("不支持后台作业");
    expect(getSandboxedRendererExecutionIssue({
      ...eligibleManifest,
      contributes: {
        views: [{
          ...eligibleManifest.contributes.views?.[0] as NonNullable<
            PluginManifestV2["contributes"]["views"]
          >[number],
          activityTarget: "calendar"
        }]
      }
    })).toContain("mod-dev-example-countdown");
  });
});
