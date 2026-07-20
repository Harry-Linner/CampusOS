import type {
  CampusPermission,
  PluginCapability,
  PluginCapabilityBinding,
  PluginManifestV2,
  PluginRuntimeRecord,
  PluginRuntimeSnapshot
} from "@campusos/shared";

export interface PluginActivationContext {
  pluginId: string;
  grantedPermissions: readonly CampusPermission[];
  bindings: Readonly<Partial<Record<PluginCapability, PluginCapabilityBinding>>>;
}

export interface PluginActivation {
  deactivate: () => Promise<void> | void;
}

export interface HeadlessPluginModule {
  manifest: PluginManifestV2;
  activate: (context: PluginActivationContext) => Promise<PluginActivation>;
}

export type HeadlessPluginLoader = () => Promise<HeadlessPluginModule>;

export interface PluginLifecycleCoordinator {
  reconcile: (
    snapshot: PluginRuntimeSnapshot
  ) => Promise<PluginRuntimeSnapshot>;
  shutdown: () => Promise<void>;
}

interface ActiveHeadlessPlugin {
  version: string;
  activation: PluginActivation;
}

const blockRecord = (
  record: PluginRuntimeRecord,
  issue: string
): PluginRuntimeRecord => ({
  ...record,
  status: "blocked",
  bindings: {},
  issues: [issue]
});

export const createPluginLifecycleCoordinator = ({
  loaders
}: {
  loaders: Record<string, HeadlessPluginLoader>;
}): PluginLifecycleCoordinator => {
  const activeHeadlessPlugins = new Map<string, ActiveHeadlessPlugin>();
  let reconciliationQueue: Promise<void> = Promise.resolve();

  const reconcileSnapshot = async (
    snapshot: PluginRuntimeSnapshot
  ): Promise<PluginRuntimeSnapshot> => {
    const records = snapshot.plugins.map((record) => ({ ...record }));
    const recordById = new Map(records.map((record) => [record.id, record]));
    const desiredHeadlessPlugins = new Map(
      records
        .filter(
          (record) =>
            record.status === "active" &&
            (record.manifest.contributes.syncJobs?.length ?? 0) > 0
        )
        .map((record) => [record.id, record])
    );

    for (const [pluginId, active] of activeHeadlessPlugins) {
      const desired = desiredHeadlessPlugins.get(pluginId);
      if (desired && desired.manifest.version === active.version) continue;

      await active.activation.deactivate();
      activeHeadlessPlugins.delete(pluginId);
    }

    const pending = new Map(
      [...desiredHeadlessPlugins].filter(([pluginId, record]) => {
        const active = activeHeadlessPlugins.get(pluginId);
        return !active || active.version !== record.manifest.version;
      })
    );
    const failedHeadlessPlugins = new Set<string>();
    let progressed = true;

    while (pending.size > 0 && progressed) {
      progressed = false;

      for (const [pluginId, record] of [...pending]) {
        const headlessDependencies = Object.values(record.bindings)
          .flatMap((binding) =>
            binding === undefined
              ? []
              : typeof binding === "string"
                ? [binding]
                : [...binding]
          )
          .filter(
            (providerId) =>
              providerId !== "core" &&
              (recordById.get(providerId)?.manifest.contributes.syncJobs
                ?.length ?? 0) > 0
          );

        if (headlessDependencies.some((providerId) => failedHeadlessPlugins.has(providerId))) {
          recordById.set(
            pluginId,
            blockRecord(record, "无头依赖未完成激活")
          );
          failedHeadlessPlugins.add(pluginId);
          pending.delete(pluginId);
          progressed = true;
          continue;
        }

        if (
          headlessDependencies.some(
            (providerId) => !activeHeadlessPlugins.has(providerId)
          )
        ) {
          continue;
        }

        const loader = loaders[pluginId];
        if (!loader) {
          recordById.set(
            pluginId,
            blockRecord(record, "缺少主进程无头实现")
          );
          failedHeadlessPlugins.add(pluginId);
          pending.delete(pluginId);
          progressed = true;
          continue;
        }

        try {
          const module = await loader();
          if (
            module.manifest.id !== record.manifest.id ||
            module.manifest.version !== record.manifest.version ||
            module.manifest.kind !== record.manifest.kind
          ) {
            throw new Error("无头插件模块与运行时 manifest 不匹配");
          }

          const activation = await module.activate(
            Object.freeze({
              pluginId,
              grantedPermissions: Object.freeze([
                ...record.grantedPermissions
              ]),
              bindings: Object.freeze({ ...record.bindings })
            })
          );
          activeHeadlessPlugins.set(pluginId, {
            version: record.manifest.version,
            activation
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "未知激活错误";
          recordById.set(
            pluginId,
            blockRecord(record, `无头插件激活失败：${message}`)
          );
          failedHeadlessPlugins.add(pluginId);
        }

        pending.delete(pluginId);
        progressed = true;
      }
    }

    for (const [pluginId, record] of pending) {
      recordById.set(
        pluginId,
        blockRecord(record, "无头依赖未完成激活")
      );
      failedHeadlessPlugins.add(pluginId);
    }

    let propagated = true;
    while (propagated) {
      propagated = false;

      for (const record of recordById.values()) {
        if (record.status !== "active") continue;

        const unavailableCapability = Object.entries(record.bindings).find(
          ([, binding]) => {
            if (binding === undefined) return false;
            const providerIds =
              typeof binding === "string" ? [binding] : [...binding];
            return !providerIds.some(
              (providerId) =>
                providerId === "core" ||
                recordById.get(providerId)?.status === "active"
            );
          }
        )?.[0] as PluginCapability | undefined;

        if (!unavailableCapability) continue;

        recordById.set(
          record.id,
          blockRecord(
            record,
            `依赖提供者未激活：${unavailableCapability}`
          )
        );
        propagated = true;
      }
    }

    return {
      ...snapshot,
      generatedAt: new Date().toISOString(),
      plugins: snapshot.plugins.map(
        (record) => recordById.get(record.id) as PluginRuntimeRecord
      )
    };
  };

  return {
    reconcile: async (snapshot) => {
      let result: PluginRuntimeSnapshot | undefined;
      const operation = reconciliationQueue.then(async () => {
        result = await reconcileSnapshot(snapshot);
      });
      reconciliationQueue = operation.then(
        () => undefined,
        () => undefined
      );
      await operation;
      return result as PluginRuntimeSnapshot;
    },
    shutdown: async () => {
      await reconciliationQueue;
      const active = [...activeHeadlessPlugins.values()];
      activeHeadlessPlugins.clear();
      await Promise.all(active.map((connector) => connector.activation.deactivate()));
    }
  };
};
