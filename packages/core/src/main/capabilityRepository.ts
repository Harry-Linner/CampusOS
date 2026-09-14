import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  CapabilityPublication,
  CapabilityRecord,
  PluginCapability
} from "@campusos/shared";

const CAPABILITY_DATA_VERSION = 1;

interface StoredCapabilityPayload {
  dataVersion: number;
  capability: PluginCapability;
  records: Record<string, CapabilityRecord>;
}

export interface CapabilityRepository {
  publish: <T>(
    providerId: string,
    providedCapabilities: readonly PluginCapability[],
    publication: CapabilityPublication<T>
  ) => Promise<CapabilityRecord<T>>;
  read: <T>(capability: PluginCapability) => Promise<CapabilityRecord<T>[]>;
}

const isMissingFileError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "ENOENT";

const accountStorageKey = (accountId: string | null): string =>
  accountId === null
    ? "no-account"
    : createHash("sha256").update(accountId, "utf8").digest("hex");

export const createCapabilityRepository = ({
  storageRoot
}: {
  storageRoot: string;
}): CapabilityRepository => {
  let updateQueue: Promise<void> = Promise.resolve();
  const getStoragePath = (capability: PluginCapability): string =>
    join(
      storageRoot,
      "capabilities",
      `${encodeURIComponent(capability)}.json`
    );

  const readPayload = async (
    capability: PluginCapability
  ): Promise<StoredCapabilityPayload> => {
    const storagePath = getStoragePath(capability);

    try {
      const payload = JSON.parse(
        await readFile(storagePath, "utf8")
      ) as Partial<StoredCapabilityPayload>;
      if (
        payload.dataVersion !== CAPABILITY_DATA_VERSION ||
        payload.capability !== capability ||
        typeof payload.records !== "object" ||
        payload.records === null
      ) {
        throw new Error(`Capability store schema is invalid: ${capability}`);
      }

      return payload as StoredCapabilityPayload;
    } catch (error) {
      if (!isMissingFileError(error)) throw error;

      return {
        dataVersion: CAPABILITY_DATA_VERSION,
        capability,
        records: {}
      };
    }
  };

  return {
    publish: async <T>(
      providerId: string,
      providedCapabilities: readonly PluginCapability[],
      publication: CapabilityPublication<T>
    ): Promise<CapabilityRecord<T>> => {
      if (!providedCapabilities.includes(publication.capability)) {
        throw new Error(
          `Plugin did not declare capability: ${publication.capability}`
        );
      }
      if (!Number.isFinite(Date.parse(publication.updatedAt))) {
        throw new Error("Capability publication has an invalid updatedAt value.");
      }

      const record: CapabilityRecord<T> = {
        ...publication,
        providerId
      };
      const operation = updateQueue.then(async () => {
        const payload = await readPayload(publication.capability);
        const key = `${providerId}:${accountStorageKey(publication.accountId)}`;
        payload.records[key] = record;
        const storagePath = getStoragePath(publication.capability);
        await mkdir(dirname(storagePath), { recursive: true });
        await writeFile(storagePath, JSON.stringify(payload, null, 2), "utf8");
      });
      updateQueue = operation.then(
        () => undefined,
        () => undefined
      );
      await operation;
      return record;
    },
    read: async <T>(capability: PluginCapability) => {
      await updateQueue;
      const payload = await readPayload(capability);
      return Object.values(payload.records) as CapabilityRecord<T>[];
    }
  };
};
