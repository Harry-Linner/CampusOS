import { describe, expect, it } from "vitest";
import {
  firstWaveSources,
  type PluginManifestV2,
  type PluginRuntimeSnapshot
} from "@campusos/shared";
import { officialPluginManifests, corePluginCapabilities } from "../../main/officialPluginCatalog";
import { resolvePluginRuntime } from "../../main/pluginRuntime";
import { loadPlugins } from "./pluginHost";
import { buildActivityItems } from "./pluginNavigation";

describe("loadPlugins", () => {
  it("loads official modules only with their main-process runtime records", async () => {
    const runtime = resolvePluginRuntime({
      registrations: officialPluginManifests.map((manifest) => ({
        manifest,
        enabled: manifest.releaseStage === "ready",
        grantedPermissions: [...manifest.permissions]
      })),
      coreCapabilities: corePluginCapabilities
    });
    const plugins = await loadPlugins(runtime);

    expect(plugins.map((plugin) => plugin.manifest.id).sort()).toEqual(
      officialPluginManifests.map((manifest) => manifest.id).sort()
    );

    const academicPlugin = plugins.find(
      (plugin) => plugin.manifest.id === "org.campusos.academic-scraper"
    );
    const dingtalkPlugin = plugins.find(
      (plugin) => plugin.manifest.id === "org.campusos.dingtalk-entry"
    );
    const calendarPlugin = plugins.find(
      (plugin) => plugin.manifest.id === "org.campusos.calendar-workspace"
    );
    const headlessPlugins = plugins.filter(
      (plugin) => (plugin.manifest.contributes.syncJobs?.length ?? 0) > 0
    );

    expect(academicPlugin?.manifest.sourceScope).toEqual([...firstWaveSources]);
    expect(dingtalkPlugin?.runtime.status).toBe("placeholder");
    expect(dingtalkPlugin?.manifest.permissions).toEqual([]);
    expect(calendarPlugin?.runtime.status).toBe("active");
    expect(headlessPlugins).toHaveLength(7);
    expect(headlessPlugins.every((plugin) => plugin.Component === undefined)).toBe(
      true
    );
    expect(headlessPlugins.every((plugin) => plugin.runtime.status === "active"))
      .toBe(true);
    expect(buildActivityItems(plugins).map((item) => item.id)).toEqual([
      "dashboard",
      "calendar",
      "materials",
      "grades",
      "exam-countdown",
      "extensions",
      "settings"
    ]);
  });

  it("lists an installed third-party manifest without importing untrusted renderer code", async () => {
    const manifest: PluginManifestV2 = {
      ...officialPluginManifests.find(
        (candidate) => candidate.id === "org.campusos.calendar-workspace"
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
      ...officialPluginManifests.find(
        (candidate) => candidate.id === "org.campusos.calendar-workspace"
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
