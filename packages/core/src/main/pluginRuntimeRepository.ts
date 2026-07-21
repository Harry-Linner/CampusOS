import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  CampusPermission,
  PluginCapability,
  PluginManifestV2,
  PluginRegistration,
  PluginRuntimeConfigurationInput,
  PluginRuntimeSnapshot
} from "@campusos/shared";
import { resolvePluginRuntime } from "./pluginRuntime";

const PLUGIN_RUNTIME_DATA_VERSION = 1;

interface StoredPluginConfiguration {
  enabled: boolean;
  grantedPermissions: CampusPermission[];
  updatedAt: string;
}

interface StoredPluginRuntimePayload {
  dataVersion: number;
  plugins: Record<string, StoredPluginConfiguration>;
}

export interface PluginRuntimeRepository {
  load: () => Promise<PluginRuntimeSnapshot>;
  configure: (
    input: PluginRuntimeConfigurationInput
  ) => Promise<PluginRuntimeSnapshot>;
}

export interface CreatePluginRuntimeRepositoryOptions {
  storagePath: string;
  manifests?: PluginManifestV2[];
  loadManifests?: () => Promise<PluginManifestV2[]>;
  coreCapabilities: PluginCapability[];
  isEnabledByDefault?: (manifest: PluginManifestV2) => boolean;
  defaultGrantedPermissions?: (
    manifest: PluginManifestV2
  ) => CampusPermission[];
  canEnable?: (manifest: PluginManifestV2) => string | null;
}

const createDefaultConfiguration = (
  manifest: PluginManifestV2,
  isEnabledByDefault: (manifest: PluginManifestV2) => boolean,
  defaultGrantedPermissions: (manifest: PluginManifestV2) => CampusPermission[]
): StoredPluginConfiguration => ({
  enabled: manifest.releaseStage === "ready" && isEnabledByDefault(manifest),
  grantedPermissions: defaultGrantedPermissions(manifest),
  updatedAt: new Date(0).toISOString()
});

const isMissingFileError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "ENOENT";

export const createPluginRuntimeRepository = ({
  storagePath,
  manifests,
  loadManifests,
  coreCapabilities,
  isEnabledByDefault = (manifest) => manifest.releaseStage === "ready",
  defaultGrantedPermissions = () => [],
  canEnable = () => null
}: CreatePluginRuntimeRepositoryOptions): PluginRuntimeRepository => {
  if (!manifests && !loadManifests) {
    throw new Error("Plugin runtime repository requires a manifest source.");
  }
  const readManifests = async (): Promise<PluginManifestV2[]> =>
    loadManifests ? loadManifests() : [...manifests as PluginManifestV2[]];
  let updateQueue: Promise<void> = Promise.resolve();

  const readPayload = async (
    currentManifests: readonly PluginManifestV2[]
  ): Promise<StoredPluginRuntimePayload> => {
    try {
      const raw = await readFile(storagePath, "utf8");
      const payload = JSON.parse(raw) as Partial<StoredPluginRuntimePayload>;

      if (
        payload.dataVersion !== PLUGIN_RUNTIME_DATA_VERSION ||
        typeof payload.plugins !== "object" ||
        payload.plugins === null
      ) {
        throw new Error("Plugin runtime state has an unsupported schema.");
      }

      const plugins: Record<string, StoredPluginConfiguration> = {};
      for (const manifest of currentManifests) {
        const stored = payload.plugins[manifest.id];
        const defaults = createDefaultConfiguration(
          manifest,
          isEnabledByDefault,
          defaultGrantedPermissions
        );
        const storedPermissions = Array.isArray(stored?.grantedPermissions)
          ? stored.grantedPermissions.filter((permission) =>
              manifest.permissions.includes(permission)
            )
          : defaults.grantedPermissions;
        const requestedEnabled =
          typeof stored?.enabled === "boolean"
            ? stored.enabled
            : defaults.enabled;
        const grantedPermissions =
          requestedEnabled && defaultGrantedPermissions(manifest).length > 0
            ? [
                ...new Set([
                  ...storedPermissions,
                  ...defaultGrantedPermissions(manifest)
                ])
              ]
            : storedPermissions;

        plugins[manifest.id] = {
          enabled:
            requestedEnabled &&
            manifest.releaseStage === "ready" &&
            canEnable(manifest) === null,
          grantedPermissions,
          updatedAt:
            typeof stored?.updatedAt === "string"
              ? stored.updatedAt
              : defaults.updatedAt
        };
      }

      return {
        dataVersion: PLUGIN_RUNTIME_DATA_VERSION,
        plugins
      };
    } catch (error) {
      if (!isMissingFileError(error)) throw error;

      return {
        dataVersion: PLUGIN_RUNTIME_DATA_VERSION,
        plugins: Object.fromEntries(
          currentManifests.map((manifest) => [
            manifest.id,
            createDefaultConfiguration(
              manifest,
              isEnabledByDefault,
              defaultGrantedPermissions
            )
          ])
        )
      };
    }
  };

  const resolvePayload = (
    payload: StoredPluginRuntimePayload,
    currentManifests: readonly PluginManifestV2[]
  ): PluginRuntimeSnapshot => {
    const registrations: PluginRegistration[] = currentManifests.map((manifest) => {
      const configuration =
        payload.plugins[manifest.id] ?? createDefaultConfiguration(
          manifest,
          isEnabledByDefault,
          defaultGrantedPermissions
        );

      return {
        manifest,
        enabled: configuration.enabled,
        grantedPermissions: configuration.grantedPermissions
      };
    });

    return resolvePluginRuntime({
      registrations,
      coreCapabilities
    });
  };

  const writePayload = async (
    payload: StoredPluginRuntimePayload
  ): Promise<void> => {
    await mkdir(dirname(storagePath), { recursive: true });
    const operationId = randomUUID();
    const temporaryPath = `${storagePath}.${operationId}.tmp`;
    const backupPath = `${storagePath}.${operationId}.backup`;
    let hasBackup = false;

    try {
      await writeFile(temporaryPath, JSON.stringify(payload, null, 2), {
        encoding: "utf8",
        flag: "wx"
      });
      try {
        await rename(storagePath, backupPath);
        hasBackup = true;
      } catch (error) {
        if (!isMissingFileError(error)) throw error;
      }
      await rename(temporaryPath, storagePath);
      if (hasBackup) await rm(backupPath, { force: true });
    } catch (error) {
      const recoveryErrors: unknown[] = [error];
      await rm(temporaryPath, { force: true }).catch((cleanupError) => {
        recoveryErrors.push(cleanupError);
      });
      if (hasBackup) {
        await rename(backupPath, storagePath).catch((recoveryError) => {
          recoveryErrors.push(recoveryError);
        });
      }
      if (recoveryErrors.length > 1) {
        throw new AggregateError(
          recoveryErrors,
          "Plugin runtime state write and recovery both failed."
        );
      }
      throw error;
    }
  };

  return {
    load: async () => {
      await updateQueue;
      const currentManifests = await readManifests();
      return resolvePayload(
        await readPayload(currentManifests),
        currentManifests
      );
    },
    configure: async (input) => {
      const operation = updateQueue.then(async () => {
        const currentManifests = await readManifests();
        const manifestsById = new Map(
          currentManifests.map((manifest) => [manifest.id, manifest])
        );
        const manifest = manifestsById.get(input.pluginId);
        if (!manifest) {
          throw new Error(`Unknown plugin: ${input.pluginId}`);
        }

        if (manifest.releaseStage === "placeholder" && input.enabled) {
          throw new Error(`Placeholder plugin cannot be enabled: ${input.pluginId}`);
        }
        const enableIssue = input.enabled ? canEnable(manifest) : null;
        if (enableIssue) throw new Error(enableIssue);

        const undeclaredPermissions = input.grantedPermissions.filter(
          (permission) => !manifest.permissions.includes(permission)
        );
        if (undeclaredPermissions.length > 0) {
          throw new Error(
            `Plugin permission was not declared: ${undeclaredPermissions.join(", ")}`
          );
        }

        const payload = await readPayload(currentManifests);
        payload.plugins[input.pluginId] = {
          enabled: input.enabled,
          grantedPermissions: [...input.grantedPermissions],
          updatedAt: new Date().toISOString()
        };
        await writePayload(payload);
      });

      updateQueue = operation.then(
        () => undefined,
        () => undefined
      );
      await operation;
      const currentManifests = await readManifests();
      return resolvePayload(
        await readPayload(currentManifests),
        currentManifests
      );
    }
  };
};
