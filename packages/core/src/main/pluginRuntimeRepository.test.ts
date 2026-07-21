import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PluginManifestV2 } from "@campusos/shared";
import { createPluginRuntimeRepository } from "./pluginRuntimeRepository";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

const provider: PluginManifestV2 = {
  id: "org.campusos.workspace-compat",
  name: "workspace-compat",
  displayName: "工作台兼容连接器",
  version: "1.0.0",
  apiVersion: 2,
  kind: "connector",
  description: "向插件运行时提供现有工作台快照能力。",
  icon: "Workspace",
  permissions: [],
  sourceScope: ["workspace:snapshot"],
  releaseStage: "ready",
  provides: ["core.workspace-snapshot@1"],
  requires: [],
  optionalRequires: [],
  contributes: {
    syncJobs: ["workspace-refresh"]
  }
};

const calendar: PluginManifestV2 = {
  id: "org.campusos.calendar-workspace",
  name: "calendar-workspace",
  displayName: "日历工作台",
  version: "1.0.0",
  apiVersion: 2,
  kind: "feature",
  description: "统一展示课程、考试、截止事项和用户日程。",
  icon: "Calendar",
  permissions: ["storage:domain:calendar"],
  sourceScope: ["workspace:calendar"],
  releaseStage: "ready",
  provides: [],
  requires: ["core.workspace-snapshot@1"],
  optionalRequires: ["planner.schedule@1"],
  contributes: {
    views: []
  }
};

describe("plugin runtime repository", () => {
  it("persists an explicit permission grant across repository instances", async () => {
    const directory = await mkdtemp(join(tmpdir(), "campusos-plugin-runtime-"));
    temporaryDirectories.push(directory);
    const storagePath = join(directory, "runtime-state.json");
    const createRepository = () =>
      createPluginRuntimeRepository({
        storagePath,
        manifests: [provider, calendar],
        coreCapabilities: []
      });

    const initial = await createRepository().load();
    expect(initial.plugins.find((plugin) => plugin.id === calendar.id)).toEqual(
      expect.objectContaining({
        enabled: true,
        grantedPermissions: [],
        status: "blocked",
        issues: ["权限未授权：storage:domain:calendar"]
      })
    );

    const configured = await createRepository().configure({
      pluginId: calendar.id,
      enabled: true,
      grantedPermissions: ["storage:domain:calendar"]
    });
    expect(configured.plugins.find((plugin) => plugin.id === calendar.id)?.status).toBe(
      "active"
    );

    const reloaded = await createRepository().load();
    expect(reloaded.plugins.find((plugin) => plugin.id === calendar.id)).toEqual(
      expect.objectContaining({
        grantedPermissions: ["storage:domain:calendar"],
        status: "active"
      })
    );
  });

  it("activates bundled plugins with their declared default grants", async () => {
    const directory = await mkdtemp(join(tmpdir(), "campusos-plugin-runtime-"));
    temporaryDirectories.push(directory);
    const repository = createPluginRuntimeRepository({
      storagePath: join(directory, "runtime-state.json"),
      manifests: [provider, calendar],
      coreCapabilities: [],
      defaultGrantedPermissions: (manifest) => [...manifest.permissions]
    });

    const calendarRecord = (await repository.load()).plugins.find(
      (plugin) => plugin.id === calendar.id
    );

    expect(calendarRecord).toMatchObject({
      id: calendar.id,
      enabled: true,
      grantedPermissions: ["storage:domain:calendar"],
      status: "active"
    });

    await writeFile(
      join(directory, "runtime-state.json"),
      JSON.stringify({
        dataVersion: 1,
        plugins: {
          [calendar.id]: {
            enabled: true,
            grantedPermissions: [],
            updatedAt: "2026-07-19T00:00:00.000Z"
          }
        }
      }),
      "utf8"
    );
    const migratedCalendar = (await repository.load()).plugins.find(
      (plugin) => plugin.id === calendar.id
    );

    expect(migratedCalendar).toMatchObject({
      grantedPermissions: ["storage:domain:calendar"],
      status: "active"
    });
  });

  it("discovers installed manifests dynamically and fails closed before sandbox execution", async () => {
    const directory = await mkdtemp(join(tmpdir(), "campusos-plugin-runtime-"));
    temporaryDirectories.push(directory);
    const installed: PluginManifestV2[] = [];
    const storagePath = join(directory, "runtime-state.json");
    const thirdParty: PluginManifestV2 = {
      ...calendar,
      id: "dev.example.countdown",
      name: "countdown",
      displayName: "考试倒计时",
      permissions: [],
      requires: [],
      optionalRequires: [],
      contributes: { commands: ["countdown.open"] }
    };
    const repository = createPluginRuntimeRepository({
      storagePath,
      loadManifests: async () => [provider, ...installed],
      coreCapabilities: [],
      isEnabledByDefault: (manifest) => manifest.id.startsWith("org.campusos."),
      canEnable: (manifest) => manifest.id.startsWith("org.campusos.")
        ? null
        : "第三方插件沙箱尚未就绪，不能启用此插件。"
    });

    expect((await repository.load()).plugins.map((plugin) => plugin.id)).toEqual([
      provider.id
    ]);
    installed.push(thirdParty);
    await writeFile(storagePath, JSON.stringify({
      dataVersion: 1,
      plugins: {
        [thirdParty.id]: {
          enabled: true,
          grantedPermissions: [],
          updatedAt: "2026-07-19T00:00:00.000Z"
        }
      }
    }), "utf8");

    await expect(repository.load()).resolves.toMatchObject({
      plugins: [
        { id: provider.id },
        {
          id: thirdParty.id,
          enabled: false,
          status: "disabled",
          grantedPermissions: []
        }
      ]
    });
    await expect(repository.configure({
      pluginId: thirdParty.id,
      enabled: true,
      grantedPermissions: []
    })).rejects.toThrow("第三方插件沙箱尚未就绪");
  });
});
