import { app } from "electron";
import { join } from "node:path";
import type {
  PluginRuntimeConfigurationInput,
  PluginRuntimeSnapshot
} from "@campusos/shared";
import { getSandboxedRendererExecutionIssue } from "@campusos/shared";
import {
  corePluginCapabilities,
  officialPluginManifests
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
    const officialPluginIds = new Set(
      officialPluginManifests.map((manifest) => manifest.id)
    );
    const packageRegistry = createCampusmodPackageRegistry({
      rootPath: join(pluginRootPath, "installed")
    });
    const repository = createPluginRuntimeRepository({
      storagePath: join(pluginRootPath, "runtime-state.json"),
      loadManifests: async () => [
        ...officialPluginManifests,
        ...(await packageRegistry.load()).packages.map(
          (installedPackage) => installedPackage.manifest
        )
      ],
      coreCapabilities: corePluginCapabilities,
      isEnabledByDefault: (manifest) => officialPluginIds.has(manifest.id),
      defaultGrantedPermissions: (manifest) =>
        officialPluginIds.has(manifest.id) ? [...manifest.permissions] : [],
      canEnable: (manifest) => officialPluginIds.has(manifest.id)
        ? null
        : getSandboxedRendererExecutionIssue(manifest)
    });
    const lifecycle = createPluginLifecycleCoordinator({
      loaders: createOfficialHeadlessPluginLoaders({
        capabilityRepository: getOfficialCapabilityRepository()
      })
    });

    const load = async (): Promise<PluginRuntimeSnapshot> =>
      lifecycle.reconcile(await repository.load());
    service = {
      load,
      configure: async (input) =>
        lifecycle.reconcile(await repository.configure(input)),
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
        if (officialPluginIds.has(pluginId)) {
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
