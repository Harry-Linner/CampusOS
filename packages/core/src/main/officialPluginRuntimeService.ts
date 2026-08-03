import { app } from "electron";
import { join } from "node:path";
import type {
  PluginRuntimeConfigurationInput,
  PluginRuntimeSnapshot
} from "@campusos/shared";
import { getSandboxedRendererExecutionIssue } from "@campusos/shared";
import {
  corePluginCapabilities,
  officialCoreModuleManifests,
  officialRuntimeManifests,
  officialUserPluginManifests,
  toUserPluginSnapshot
} from "./officialPluginCatalog";
import { createOfficialHeadlessPluginLoaders } from "./officialHeadlessPluginLoaders";
import { getOfficialCapabilityRepository } from "./officialCapabilityRepository";
import { createPluginLifecycleCoordinator } from "./pluginLifecycle";
import { createPluginRuntimeRepository } from "./pluginRuntimeRepository";
import {
  createCampusmodPackageRegistry,
  type CampusmodPackageInspection,
  type CampusmodRegistrySnapshot,
  type InstalledCampusmodPackage
} from "./campusmodPackageRegistry";

export interface PluginPackageMutationResult {
  installedPackage?: InstalledCampusmodPackage;
  registry: CampusmodRegistrySnapshot;
  runtime: PluginRuntimeSnapshot;
}

export interface OfficialPluginRuntimeService {
  load: () => Promise<PluginRuntimeSnapshot>;
  loadInternal: () => Promise<PluginRuntimeSnapshot>;
  configure: (
    input: PluginRuntimeConfigurationInput
  ) => Promise<PluginRuntimeSnapshot>;
  inspectPackage: (sourcePath: string) => Promise<CampusmodPackageInspection>;
  discardPackageInspection: (token: string) => void;
  installPackage: (token: string) => Promise<PluginPackageMutationResult>;
  loadPackages: () => Promise<CampusmodRegistrySnapshot>;
  readPackageFile: (
    pluginId: string,
    relativePath: string
  ) => Promise<Uint8Array>;
  uninstallPackage: (pluginId: string) => Promise<PluginPackageMutationResult>;
  shutdown: () => Promise<void>;
}

let service: OfficialPluginRuntimeService | null = null;

export const getOfficialPluginRuntimeService =
  (): OfficialPluginRuntimeService => {
    if (service) return service;

    const pluginRootPath = join(app.getPath("userData"), "plugins");
    const officialRuntimeIds = new Set(
      officialRuntimeManifests.map((manifest) => manifest.id)
    );
    const officialUserPluginIds = new Set(
      officialUserPluginManifests.map((manifest) => manifest.id)
    );
    const officialCoreModuleIds = new Set(
      officialCoreModuleManifests.map((manifest) => manifest.id)
    );
    const packageRegistry = createCampusmodPackageRegistry({
      rootPath: join(pluginRootPath, "installed")
    });
    const repository = createPluginRuntimeRepository({
      storagePath: join(pluginRootPath, "runtime-state.json"),
      loadManifests: async () => [
        ...officialRuntimeManifests,
        ...(await packageRegistry.load()).packages.map(
          (installedPackage) => installedPackage.manifest
        )
      ],
      coreCapabilities: corePluginCapabilities,
      isEnabledByDefault: (manifest) => officialRuntimeIds.has(manifest.id),
      defaultGrantedPermissions: (manifest) =>
        officialRuntimeIds.has(manifest.id) ? [...manifest.permissions] : [],
      canEnable: (manifest) => officialRuntimeIds.has(manifest.id)
        ? null
        : getSandboxedRendererExecutionIssue(manifest),
      isAlwaysEnabled: (manifest) => officialCoreModuleIds.has(manifest.id),
      legacyPluginIds: {
        "org.campusos.academic": [
          "org.campusos.academic-grades",
          "org.campusos.exam-countdown"
        ],
        "org.campusos.schedule": ["org.campusos.calendar-workspace"]
      }
    });
    const lifecycle = createPluginLifecycleCoordinator({
      loaders: createOfficialHeadlessPluginLoaders({
        capabilityRepository: getOfficialCapabilityRepository()
      })
    });

    const loadInternal = async (): Promise<PluginRuntimeSnapshot> =>
      lifecycle.reconcile(await repository.load());
    const load = async (): Promise<PluginRuntimeSnapshot> =>
      toUserPluginSnapshot(await loadInternal());
    service = {
      load,
      loadInternal,
      configure: async (input) => {
        if (officialCoreModuleIds.has(input.pluginId)) {
          throw new Error("Core modules cannot be configured as plugins.");
        }
        const snapshot = await lifecycle.reconcile(
          await repository.configure(input)
        );
        return toUserPluginSnapshot(snapshot);
      },
      inspectPackage: (sourcePath) => packageRegistry.inspect(sourcePath),
      discardPackageInspection: (token) => packageRegistry.discard(token),
      installPackage: async (token) => {
        const installedPackage = await packageRegistry.install(token);
        return {
          installedPackage,
          registry: await packageRegistry.load(),
          runtime: await load()
        };
      },
      loadPackages: () => packageRegistry.load(),
      readPackageFile: (pluginId, relativePath) =>
        packageRegistry.readFile(pluginId, relativePath),
      uninstallPackage: async (pluginId) => {
        if (officialUserPluginIds.has(pluginId)) {
          throw new Error("内置官方插件不能通过第三方包管理器卸载。");
        }
        const current = await load();
        const record = current.plugins.find((plugin) => plugin.id === pluginId);
        if (!record) throw new Error("第三方插件尚未安装。");
        if (record.enabled) throw new Error("请先停用插件，再执行卸载。");
        const registry = await packageRegistry.uninstall(pluginId);
        return {
          registry,
          runtime: await load()
        };
      },
      shutdown: () => lifecycle.shutdown()
    };
    return service;
  };
