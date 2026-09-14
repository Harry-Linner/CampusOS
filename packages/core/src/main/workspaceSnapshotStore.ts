import { readFile } from "node:fs/promises";
import type { CampusWorkspaceSnapshot } from "@campusos/shared";
import type { DatabaseService } from "./databaseService";

export const WORKSPACE_DATA_VERSION = 3;

export interface StoredWorkspaceSnapshot {
  snapshot: CampusWorkspaceSnapshot;
  savedAt: string;
  storagePath: string;
}

interface LegacyWorkspacePayload {
  dataVersion?: number;
  snapshot: CampusWorkspaceSnapshot;
  savedAt: string;
}

export interface WorkspaceSnapshotStore {
  load: () => Promise<StoredWorkspaceSnapshot | null>;
  save: (snapshot: CampusWorkspaceSnapshot) => Promise<StoredWorkspaceSnapshot>;
}

const isMissingFileError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "ENOENT";

const isLegacyWorkspacePayload = (
  value: unknown
): value is LegacyWorkspacePayload =>
  typeof value === "object" &&
  value !== null &&
  "dataVersion" in value &&
  value.dataVersion === WORKSPACE_DATA_VERSION &&
  "snapshot" in value &&
  typeof value.snapshot === "object" &&
  value.snapshot !== null &&
  "savedAt" in value &&
  typeof value.savedAt === "string" &&
  Number.isFinite(Date.parse(value.savedAt));

export const createWorkspaceSnapshotStore = ({
  database,
  legacyStoragePath
}: {
  database: DatabaseService;
  legacyStoragePath: string;
}): WorkspaceSnapshotStore => {
  const toStoredSnapshot = (
    snapshot: CampusWorkspaceSnapshot,
    savedAt: string
  ): StoredWorkspaceSnapshot => ({
    snapshot,
    savedAt,
    storagePath: database.databasePath
  });

  return {
    load: async () => {
      const stored = database.loadWorkspaceSnapshot();
      if (stored) {
        return toStoredSnapshot(
          stored.snapshot as CampusWorkspaceSnapshot,
          stored.savedAt
        );
      }

      try {
        const legacy = JSON.parse(
          await readFile(legacyStoragePath, "utf8")
        ) as unknown;
        if (!isLegacyWorkspacePayload(legacy)) return null;
        database.saveWorkspaceSnapshot(legacy.snapshot, legacy.savedAt);
        return toStoredSnapshot(legacy.snapshot, legacy.savedAt);
      } catch (error) {
        if (isMissingFileError(error)) return null;
        throw error;
      }
    },
    save: async (snapshot) => {
      const savedAt = new Date().toISOString();
      database.saveWorkspaceSnapshot(snapshot, savedAt);
      return toStoredSnapshot(snapshot, savedAt);
    }
  };
};
