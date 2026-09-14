import { describe, expect, it } from "vitest";
import type { PluginRuntimeRecord, PluginRuntimeSnapshot } from "@campusos/shared";
import {
  corePluginCapabilities,
  officialRuntimeManifests
} from "./officialPluginCatalog";
import { resolvePluginRuntime } from "./pluginRuntime";
import {
  augmentStartupCacheWithOfficialPlugins,
  preparePluginRuntimeStartupCache
} from "./pluginRuntimeCache";

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

const officialTrustedIds = new Set(
  officialRuntimeManifests.map((manifest) => manifest.id)
);

const buildCacheSnapshot = (manifestIds: readonly string[]): PluginRuntimeSnapshot =>
  resolvePluginRuntime({
    coreCapabilities: corePluginCapabilities,
    registrations: officialRuntimeManifests
      .filter((manifest) => manifestIds.includes(manifest.id))
      .map((manifest) => ({
        manifest,
        enabled: true,
        grantedPermissions: [...manifest.permissions]
      }))
  });

describe("augmentStartupCacheWithOfficialPlugins", () => {
  it("passes a complete cache through unchanged (third-party pending-validation marking intact)", () => {
    const cache = buildCacheSnapshot(
      officialRuntimeManifests.map((manifest) => manifest.id)
    );
    const thirdPartyRecord: PluginRuntimeRecord = {
      ...createPlugin("dev.example.thirdparty"),
      id: "dev.example.thirdparty"
    };
    const withThirdParty: PluginRuntimeSnapshot = {
      ...cache,
      plugins: [...cache.plugins, thirdPartyRecord]
    };
    const augmented = augmentStartupCacheWithOfficialPlugins(
      withThirdParty,
      officialTrustedIds,
      officialRuntimeManifests,
      corePluginCapabilities
    );
    expect(augmented.plugins.map((plugin) => plugin.id)).toEqual(
      withThirdParty.plugins.map((plugin) => plugin.id)
    );
    const third = augmented.plugins.find(
      (plugin) => plugin.id === "dev.example.thirdparty"
    );
    expect(third?.status).toBe("blocked");
    expect(third?.issues.some((issue) => issue.includes("后台重新校验"))).toBe(true);
  });

  it("appends a newly added official plugin enabled by default so it appears immediately", () => {
    const beforeIds = officialRuntimeManifests
      .map((manifest) => manifest.id)
      .filter((id) => id !== "org.campusos.campus-feed");
    const cache = buildCacheSnapshot(beforeIds);
    const augmented = augmentStartupCacheWithOfficialPlugins(
      cache,
      officialTrustedIds,
      officialRuntimeManifests,
      corePluginCapabilities
    );

    const ids = augmented.plugins.map((plugin) => plugin.id);
    expect(ids).toContain("org.campusos.campus-feed");
    const campusFeed = augmented.plugins.find(
      (plugin) => plugin.id === "org.campusos.campus-feed"
    );
    expect(campusFeed?.enabled).toBe(true);
    expect(campusFeed?.status).toBe("active");
    const schedule = augmented.plugins.find(
      (plugin) => plugin.id === "org.campusos.schedule"
    );
    expect(schedule?.enabled).toBe(true);
    expect(ids).toHaveLength(officialRuntimeManifests.length);
  });

  it("keeps a cached plugin that the user disabled disabled after augmentation", () => {
    const beforeIds = officialRuntimeManifests
      .map((manifest) => manifest.id)
      .filter((id) => id !== "org.campusos.campus-feed");
    const cache = buildCacheSnapshot(beforeIds);
    cache.plugins = cache.plugins.map((plugin) =>
      plugin.id === "org.campusos.materials"
        ? { ...plugin, enabled: false, status: "disabled" as const, bindings: {}, issues: [] }
        : plugin
    );
    const augmented = augmentStartupCacheWithOfficialPlugins(
      cache,
      officialTrustedIds,
      officialRuntimeManifests,
      corePluginCapabilities
    );
    const materials = augmented.plugins.find(
      (plugin) => plugin.id === "org.campusos.materials"
    );
    expect(materials?.enabled).toBe(false);
    expect(materials?.status).toBe("disabled");
  });
});
