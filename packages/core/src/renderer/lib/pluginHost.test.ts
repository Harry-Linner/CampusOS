import { createElement } from "react";
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
import { isPluginModuleUpdate, loadPlugins, type LoadedPlugin } from "./pluginHost";
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
  it("loads exactly the official user Modules without the retired daily-brief", async () => {
    const plugins = await loadPlugins(createOfficialUserRuntime());

    expect(plugins.map((plugin) => plugin.manifest.id).sort()).toEqual(
      officialUserPluginManifests.map((manifest) => manifest.id).sort()
    );
    expect(plugins.some((plugin) => plugin.manifest.id === "org.campusos.daily-brief")).toBe(false);
    expect(plugins.every((plugin) => plugin.Component !== undefined)).toBe(true);
    expect(plugins.every(
      (plugin) => (plugin.manifest.contributes.views?.length ?? 0) === 1
    )).toBe(true);
    expect(buildActivityItems(plugins).map((item) => item.id)).toEqual([
      "dashboard",
      "academic",
      "schedule",
      "ai-assistant",
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

describe("isPluginModuleUpdate（开发期插件 HMR 判定）", () => {
  it("命中官方插件包路径", () => {
    expect(
      isPluginModuleUpdate([
        { type: "js-update", path: "/@fs/.../plugins/official/plugin-academic/src/index.tsx" }
      ])
    ).toBe(true);
    expect(
      isPluginModuleUpdate([
        { type: "js-update", path: "/@fs/.../node_modules/@campusos/plugin-schedule/src/ScheduleView.tsx" }
      ])
    ).toBe(true);
  });

  it("非插件模块更新不命中", () => {
    expect(
      isPluginModuleUpdate([
        { type: "js-update", path: "/src/renderer/views/DashboardView.tsx" }
      ])
    ).toBe(false);
    expect(
      isPluginModuleUpdate([
        { type: "css-update", path: "/src/renderer/styles.css" }
      ])
    ).toBe(false);
  });

  it("空更新列表不命中", () => {
    expect(isPluginModuleUpdate([])).toBe(false);
  });
});

describe("buildActivityItems（侧栏子 Tab 分组）", () => {
  const makePlugin = (
    id: string,
    views: Array<{
      id: string;
      title: string;
      activityTarget: string;
      parentActivityTarget?: string;
      order?: number;
    }>
  ): LoadedPlugin => ({
    manifest: {
      id,
      name: id.replace(/\./g, "-"),
      displayName: id,
      version: "1.0.0",
      apiVersion: 2,
      kind: "feature",
      description: "test",
      icon: "计",
      permissions: ["storage:local"],
      sourceScope: ["local"],
      releaseStage: "ready",
      provides: [],
      requires: [],
      optionalRequires: [],
      contributes: {
        views: views.map((view) => ({
          id: view.id,
          title: view.title,
          icon: "Clock",
          location: "activity" as const,
          activityTarget: view.activityTarget,
          ...(view.parentActivityTarget
            ? { parentActivityTarget: view.parentActivityTarget }
            : {}),
          ...(view.order !== undefined ? { order: view.order } : {})
        }))
      }
    },
    runtime: {
      id,
      manifest: {} as LoadedPlugin["manifest"],
      enabled: true,
      grantedPermissions: ["storage:local"],
      status: "active",
      bindings: {},
      issues: []
    },
    capabilities: { read: async () => [] }
  });

  it("子 Tab 视图归入父入口且不产生独立导航项", () => {
    const plugin = makePlugin("dev.example.suite", [
      { id: "main", title: "套件主页", activityTarget: "suite" },
      { id: "stats", title: "统计", activityTarget: "suite-stats", parentActivityTarget: "suite" }
    ]);
    const items = buildActivityItems([
      {
        ...plugin,
        manifest: { ...plugin.manifest },
        runtime: { ...plugin.runtime, manifest: plugin.manifest },
        Component: () => createElement("div")
      }
    ]);

    const suite = items.find((item) => item.id === "suite");
    expect(suite).toBeDefined();
    expect(suite?.subTabs?.map((tab) => tab.label)).toEqual([
      "套件主页",
      "统计"
    ]);
    // 子视图不产生独立导航项
    expect(items.some((item) => item.id === "suite-stats")).toBe(false);
  });

  it("父项无独立视图时由子 Tab 承担入口", () => {
    const plugin = makePlugin("dev.example.grouped", [
      { id: "only-child", title: "唯一子视图", activityTarget: "grouped-child", parentActivityTarget: "grouped" }
    ]);
    const items = buildActivityItems([
      {
        ...plugin,
        manifest: { ...plugin.manifest },
        runtime: { ...plugin.runtime, manifest: plugin.manifest },
        Component: () => createElement("div")
      }
    ]);

    const grouped = items.find((item) => item.id === "grouped");
    expect(grouped?.label).toBe("唯一子视图");
    expect(grouped?.subTabs).toEqual([
      { id: "dev.example.grouped:only-child", label: "唯一子视图", viewId: "dev.example.grouped:only-child" }
    ]);
  });

  it("无 parent 的既有行为不变", () => {
    const plugin = makePlugin("dev.example.single", [
      { id: "main", title: "单一视图", activityTarget: "single" }
    ]);
    const items = buildActivityItems([
      {
        ...plugin,
        manifest: { ...plugin.manifest },
        runtime: { ...plugin.runtime, manifest: plugin.manifest },
        Component: () => createElement("div")
      }
    ]);
    const single = items.find((item) => item.id === "single");
    expect(single?.subTabs).toBeUndefined();
  });
});
