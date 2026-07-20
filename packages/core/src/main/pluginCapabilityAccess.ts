import type {
  CapabilityRecord,
  PluginCapability,
  PluginRuntimeSnapshot
} from "@campusos/shared";
import type { PluginCapabilityReadInput } from "../shared/pluginBridge";

export interface PluginCapabilityAccess {
  read: <T>(input: PluginCapabilityReadInput) => Promise<CapabilityRecord<T>[]>;
}

interface PluginCapabilityAccessDependencies {
  loadRuntime: () => Promise<PluginRuntimeSnapshot>;
  readRecords: <T>(capability: PluginCapability) => Promise<CapabilityRecord<T>[]>;
  readVerifiedAccountId: () => Promise<string | null>;
}

const normalizeProviderIds = (
  binding: string | readonly string[]
): string[] => typeof binding === "string" ? [binding] : [...binding];

const selectVisibleRecords = <T>(
  records: CapabilityRecord<T>[],
  providerIds: readonly string[],
  accountId: string | null
): CapabilityRecord<T>[] => providerIds.flatMap((providerId) => {
  const providerRecords = records.filter(
    (record) => record.providerId === providerId
  );
  const accountRecord = accountId === null
    ? null
    : providerRecords.find((record) => record.accountId === accountId) ?? null;
  const accountlessRecord = providerRecords.find(
    (record) => record.accountId === null
  ) ?? null;
  const selected = accountRecord ?? accountlessRecord;

  return selected ? [selected] : [];
});

export const createPluginCapabilityAccess = ({
  loadRuntime,
  readRecords,
  readVerifiedAccountId
}: PluginCapabilityAccessDependencies): PluginCapabilityAccess => ({
  read: async <T>(input: PluginCapabilityReadInput) => {
    const runtime = await loadRuntime();
    const plugin = runtime.plugins.find((record) => record.id === input.pluginId);

    if (!plugin || plugin.status !== "active") {
      throw new Error("插件未激活，不能读取能力数据。");
    }
    if (
      !plugin.manifest.requires.includes(input.capability) &&
      !plugin.manifest.optionalRequires.includes(input.capability)
    ) {
      throw new Error("插件未声明所请求的能力依赖。");
    }

    const binding = plugin.bindings[input.capability];
    if (!binding) {
      throw new Error("插件请求的能力当前没有可用绑定。");
    }

    const providerIds = normalizeProviderIds(binding).filter(
      (providerId) => providerId !== "core"
    );
    if (providerIds.length === 0) {
      throw new Error("核心能力不能通过插件数据仓库读取。");
    }

    return selectVisibleRecords(
      await readRecords<T>(input.capability),
      providerIds,
      await readVerifiedAccountId()
    );
  }
});
