import type {
  CapabilityPublication,
  CapabilityRecord,
  PluginCapability
} from "@campusos/shared";
import type { CapabilityRepository } from "./capabilityRepository";
import type { DatabaseService } from "./databaseService";

export const createSqliteCapabilityRepository = ({
  database
}: {
  database: DatabaseService;
}): CapabilityRepository => ({
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
    database.upsertCapabilityRecord(
      publication.capability,
      providerId,
      publication.accountId,
      record
    );
    return record;
  },
  read: async <T>(capability: PluginCapability): Promise<CapabilityRecord<T>[]> =>
    database
      .readCapabilityRecords(capability)
      .map(({ payload }) => payload as CapabilityRecord<T>)
});
