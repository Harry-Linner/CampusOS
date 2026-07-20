import { app } from "electron";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  DownloadQueueItem,
  DownloadQueuePersistence
} from "./downloadEngine";
import { getOfficialDatabaseService } from "./officialDatabaseService";

const LEGACY_QUEUE_FILE = "queue-state.json";

const isMissingFileError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "ENOENT";

export const createSqliteDownloadQueuePersistence = ({
  legacyPersistencePath,
  database = getOfficialDatabaseService()
}: {
  legacyPersistencePath: string;
  database?: ReturnType<typeof getOfficialDatabaseService>;
}): DownloadQueuePersistence => ({
  load: async () => {
    const stored = database.loadDownloadQueue();
    if (stored) return Array.isArray(stored.queue) ? stored.queue as DownloadQueueItem[] : [];

    try {
      const legacy = JSON.parse(
        await readFile(legacyPersistencePath, "utf8")
      ) as { queue?: unknown };
      const queue = Array.isArray(legacy.queue)
        ? legacy.queue as DownloadQueueItem[]
        : [];
      database.saveDownloadQueue(queue, new Date().toISOString());
      return queue;
    } catch (error) {
      if (isMissingFileError(error)) return [];
      throw error;
    }
  },
  save: async (queue) => {
    database.saveDownloadQueue(queue, new Date().toISOString());
  }
});

export const getOfficialDownloadQueuePersistence = (): DownloadQueuePersistence =>
  createSqliteDownloadQueuePersistence({
    legacyPersistencePath: join(
      app.getPath("userData"),
      "downloads",
      LEGACY_QUEUE_FILE
    )
  });
