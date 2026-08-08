import { describe, expect, it } from "vitest";
import type { PluginRuntimeRecord, PluginRuntimeSnapshot } from "@campusos/shared";
import { preparePluginRuntimeStartupCache } from "./pluginRuntimeCache";

const createPlugin = (id: string): PluginRuntimeRecord => ({
  id,
  manifest: {
    id,
    name: id,
    displayName: id,
    version: "1.0.0",
    apiVersion: 2,
    kind: "feature",
    description: "fixture",
    icon: "Puzzle",
    permissions: ["storage:local"],
    sourceScope: ["fixture"],
    releaseStage: "ready",
    provides: [],
    requires: [],
    optionalRequires: [],
    contributes: { views: [] }
  },
  enabled: true,
  grantedPermissions: ["storage:local"],
  status: "active",
  bindings: {},
  issues: []
});

describe("plugin runtime startup cache", () => {
  it("restores trusted plugins but blocks third-party execution until fresh validation", () => {
    const snapshot: PluginRuntimeSnapshot = {
      apiVersion: 2,
      generatedAt: "2026-08-08T00:00:00.000Z",
      plugins: [createPlugin("org.campusos.schedule"), createPlugin("dev.example.mod")]
    };

    const cached = preparePluginRuntimeStartupCache(
      snapshot,
      new Set(["org.campusos.schedule"])
    );

    expect(cached.plugins[0]).toEqual(snapshot.plugins[0]);
    expect(cached.plugins[1]).toMatchObject({
      id: "dev.example.mod",
      enabled: true,
      status: "blocked",
      issues: ["第三方插件正在后台重新校验。"]
    });
    expect(snapshot.plugins[1]?.status).toBe("active");
  });
});
