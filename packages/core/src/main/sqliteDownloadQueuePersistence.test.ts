import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabaseService } from "./databaseService";
import { createSqliteDownloadQueuePersistence } from "./sqliteDownloadQueuePersistence";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("SQLite download queue persistence", () => {
  it("migrates a legacy queue into SQLite and keeps it after the JSON file is removed", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "campusos-download-queue-"));
    temporaryDirectories.push(storageRoot);
    const legacyPath = join(storageRoot, "downloads", "queue-state.json");
    await mkdir(join(storageRoot, "downloads"), { recursive: true });
    await writeFile(
      legacyPath,
      JSON.stringify({ queue: [{ id: "download-a", status: "paused" }] }),
      "utf8"
    );
    const database = createDatabaseService({
      databasePath: join(storageRoot, "campusos.sqlite")
    });
    const persistence = createSqliteDownloadQueuePersistence({
      database,
      legacyPersistencePath: legacyPath
    });

    try {
      await expect(persistence.load()).resolves.toEqual([
        { id: "download-a", status: "paused" }
      ]);
      await rm(legacyPath);
      await expect(persistence.load()).resolves.toEqual([
        { id: "download-a", status: "paused" }
      ]);
    } finally {
      database.close();
    }
  });
});
