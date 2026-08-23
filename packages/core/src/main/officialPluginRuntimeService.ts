import { app } from "electron";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  PluginRuntimeConfigurationInput,
  PluginRuntimeSnapshot
} from "@campusos/shared";
import {
  getSandboxedRendererExecutionIssue,
  validateManifestV2
} from "@campusos/shared";
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
import {
  augmentStartupCacheWithOfficialPlugins,
  preparePluginRuntimeStartupCache
} from "./pluginRuntimeCache";
import { createPluginUpdateService, type PluginUpdateCandidate } from "./pluginUpdateService";

export interface PluginPackageMutationResult {
  installedPackage?: InstalledCampusmodPackage;
  registry: CampusmodRegistrySnapshot;
  runtime: PluginRuntimeSnapshot;
}

export interface OfficialPluginRuntimeService {
  load: () => Promise<PluginRuntimeSnapshot>;
  loadCached: () => Promise<PluginRuntimeSnapshot | null>;
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
  checkUpdates: () => Promise<PluginUpdateCandidate[]>;
  updatePackage: (candidate: PluginUpdateCandidate) => Promise<PluginPackageMutationResult>;
  shutdown: () => Promise<void>;
}

let service: OfficialPluginRuntimeService | null = null;

const isMissingFileError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "ENOENT";

const isCachedRuntimeSnapshot = (value: unknown): value is PluginRuntimeSnapshot => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<PluginRuntimeSnapshot>;
  if (candidate.apiVersion !== 2 || typeof candidate.generatedAt !== "string" || !Array.isArray(candidate.plugins)) {
    return false;
  }
  return candidate.plugins.every((plugin) => {
    if (typeof plugin !== "object" || plugin === null) return false;
    const record = plugin as PluginRuntimeSnapshot["plugins"][number];
    return (
      typeof record.id === "string" &&
      (record.status === "active" || record.status === "blocked" || record.status === "disabled" || record.status === "placeholder") &&
      validateManifestV2(record.manifest).ok &&
      typeof record.enabled === "boolean" &&
      Array.isArray(record.grantedPermissions) &&
      Array.isArray(record.issues) &&
      typeof record.bindings === "object" &&
      record.bindings !== null
    );
  });
};

export const getOfficialPluginRuntimeService =
  (): OfficialPluginRuntimeService => {
    if (service) return service;

    const pluginRootPath = join(app.getPath("userData"), "plugins");
    const runtimeCachePath = join(pluginRootPath, "runtime-cache.json");
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
    const pluginUpdateService = createPluginUpdateService({ registry: packageRegistry });
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

    const writeRuntimeCache = async (snapshot: PluginRuntimeSnapshot): Promise<void> => {
      await mkdir(dirname(runtimeCachePath), { recursive: true });
      const temporaryPath = `${runtimeCachePath}.${randomUUID()}.tmp`;
      try {
        const startupSnapshot = preparePluginRuntimeStartupCache(
          snapshot,
          officialRuntimeIds
        );
        await writeFile(temporaryPath, JSON.stringify(startupSnapshot, null, 2), {
          encoding: "utf8",
          flag: "wx"
        });
        await rm(runtimeCachePath, { force: true });
        await rename(temporaryPath, runtimeCachePath);
      } catch (error) {
        await rm(temporaryPath, { force: true });
        throw error;
      }
    };

    const readRuntimeCache = async (): Promise<PluginRuntimeSnapshot | null> => {
      try {
        const parsed = JSON.parse(await readFile(runtimeCachePath, "utf8")) as unknown;
        if (!isCachedRuntimeSnapshot(parsed)) return null;
        // A cache written before an upgrade (which added a new official
        // plugin) must not delay that plugin from appearing in the sidebar:
        // append the missing official plugins with their default config
        // instead of discarding the cache and forcing a slow full load.
        return augmentStartupCacheWithOfficialPlugins(
          parsed,
          officialRuntimeIds,
          officialRuntimeManifests,
          corePluginCapabilities
        );
      } catch (error) {
        if (isMissingFileError(error)) return null;
        return null;
      }
    };

    const loadInternal = async (): Promise<PluginRuntimeSnapshot> =>
      lifecycle.reconcile(await repository.load());
    const loadFresh = async (): Promise<PluginRuntimeSnapshot> => {
      const snapshot = toUserPluginSnapshot(await loadInternal());
      try {
        await writeRuntimeCache(snapshot);
      } catch {
        // Cache failure must never prevent a fresh runtime snapshot from loading.
      }
      return snapshot;
    };
    let refreshPromise: Promise<PluginRuntimeSnapshot> | null = null;
    const load = (): Promise<PluginRuntimeSnapshot> => {
      if (!refreshPromise) {
        refreshPromise = loadFresh().finally(() => {
          refreshPromise = null;
        });
      }
      return refreshPromise;
    };
    service = {
      load,
      loadCached: readRuntimeCache,
      loadInternal,
      configure: async (input) => {
        if (officialCoreModuleIds.has(input.pluginId)) {
          throw new Error("Core modules cannot be configured as plugins.");
        }
        const snapshot = toUserPluginSnapshot(await lifecycle.reconcile(
          await repository.configure(input)
        ));
        try {
          await writeRuntimeCache(snapshot);
        } catch {
          // Cache failure must never prevent a successful plugin configuration.
        }
        return snapshot;
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
      checkUpdates: () => pluginUpdateService.check(),
      updatePackage: async (candidate) => {
        const installedPackage = await pluginUpdateService.update(candidate);
        if (candidate.requiresReapproval) {
          const runtimeBeforeUpdate = await load();
          const current = runtimeBeforeUpdate.plugins.find((plugin) => plugin.id === candidate.pluginId);
          if (current) {
            await repository.configure({ pluginId: candidate.pluginId, enabled: false, grantedPermissions: [] });
          }
        }
        const runtime = await load();
        return {
          installedPackage,
          registry: await packageRegistry.load(),
          runtime
        };
      },
      shutdown: () => lifecycle.shutdown()
    };
    return service;
  };
