import { describe, expect, it } from "vitest";
import type {
  PluginManifestV2,
  PluginRuntimeSnapshot
} from "@campusos/shared";
import {
  corePluginCapabilities,
  officialRuntimeManifests,
  officialUserPluginManifests,
  toUserPluginSnapshot
} from "../../main/officialPluginCatalog";
import { resolvePluginRuntime } from "../../main/pluginRuntime";
import { loadPlugins } from "./pluginHost";
import { buildActivityItems } from "./pluginNavigation";

const createOfficialUserRuntime = (): PluginRuntimeSnapshot =>
  toUserPluginSnapshot(resolvePluginRuntime({
    registrations: officialRuntimeManifests.map((manifest) => ({
      manifest,
      enabled: manifest.releaseStage === "ready",
      grantedPermissions: [...manifest.permissions]
    })),
    coreCapabilities: corePluginCapabilities
  }));

describe("loadPlugins", () => {
  it("loads exactly the five official user Modules", async () => {
    const plugins = await loadPlugins(createOfficialUserRuntime());

    expect(plugins.map((plugin) => plugin.manifest.id).sort()).toEqual(
      officialUserPluginManifests.map((manifest) => manifest.id).sort()
    );
    expect(plugins.every((plugin) => plugin.Component !== undefined)).toBe(true);
    expect(plugins.every(
      (plugin) => (plugin.manifest.contributes.views?.length ?? 0) === 1
    )).toBe(true);
    expect(buildActivityItems(plugins).map((item) => item.id)).toEqual([
      "dashboard",
      "academic",
      "schedule",
      "ai-assistant",
      "daily-brief",
      "materials",
      "campus-feed",
      "extensions",
      "settings"
    ]);
  });

  it("removes exactly one sidebar entry when an official Module is disabled", async () => {
    const runtime = createOfficialUserRuntime();
    const plugins = await loadPlugins({
      ...runtime,
      plugins: runtime.plugins.map((plugin) =>
        plugin.id === "org.campusos.schedule"
          ? { ...plugin, enabled: false, status: "disabled" as const }
          : plugin
      )
    });

    expect(buildActivityItems(plugins).map((item) => item.id)).toEqual([
      "dashboard",
      "academic",
      "ai-assistant",
      "daily-brief",
      "materials",
      "campus-feed",
      "extensions",
      "settings"
    ]);
  });

  it("lists an installed third-party manifest without importing untrusted renderer code", async () => {
    const manifest: PluginManifestV2 = {
      ...officialUserPluginManifests.find(
        (candidate) => candidate.id === "org.campusos.schedule"
      ) as PluginManifestV2,
      id: "dev.example.countdown",
      name: "countdown",
      displayName: "考试倒计时",
      permissions: ["storage:local"],
      requires: [],
      optionalRequires: []
    };
    const runtime: PluginRuntimeSnapshot = {
      apiVersion: 2,
      generatedAt: "2026-07-19T00:00:00.000Z",
      plugins: [
        {
          id: manifest.id,
          manifest,
          enabled: false,
          grantedPermissions: [],
          status: "disabled",
          bindings: {},
          issues: []
        }
      ]
    };

    const plugins = await loadPlugins(runtime);

    expect(plugins).toEqual([
      expect.objectContaining({
        manifest,
        runtime: expect.objectContaining({ status: "disabled" })
      })
    ]);
    expect(plugins[0]?.Component).toBeUndefined();
  });

  it("maps an eligible active third-party view to a host-owned sandbox iframe", async () => {
    const manifest: PluginManifestV2 = {
      ...officialUserPluginManifests.find(
        (candidate) => candidate.id === "org.campusos.schedule"
      ) as PluginManifestV2,
      id: "dev.example.countdown",
      name: "countdown",
      displayName: "考试倒计时",
      permissions: ["storage:local"],
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
    const runtime: PluginRuntimeSnapshot = {
      apiVersion: 2,
      generatedAt: "2026-07-19T00:00:00.000Z",
      plugins: [{
        id: manifest.id,
        manifest,
        enabled: true,
        grantedPermissions: ["storage:local"],
        status: "active",
        bindings: {},
        issues: []
      }]
    };
    const [plugin] = await loadPlugins(runtime);
    const element = plugin?.Component?.({
      snapshot: null,
      loading: false,
      capabilities: plugin.capabilities,
      onRefresh: async () => undefined
    });

    expect(element?.type).toBe("iframe");
    expect(element?.props).toMatchObject({
      src: "campusmod://dev.example.countdown/",
      sandbox: "allow-scripts allow-same-origin",
      referrerPolicy: "no-referrer"
    });
  });
});
