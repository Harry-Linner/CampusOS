import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CampusWorkspaceSnapshot } from "@campusos/shared";
import { createDatabaseService } from "./databaseService";
import { createWorkspaceSnapshotStore } from "./workspaceSnapshotStore";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("workspace snapshot store", () => {
  it("migrates a valid v3 workspace snapshot from JSON into SQLite", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "campusos-workspace-store-"));
    temporaryDirectories.push(storageRoot);
    const legacyPath = join(storageRoot, "workspace", "campus-workspace.json");
    const snapshot = {
      generatedAt: "2026-07-20T08:00:00.000Z",
      term: {
        label: "2025-2026 夏",
        phase: "mock",
        currentWeek: null,
        progressPercent: 0
      },
      sourceStates: [],
      courses: [],
      todayCourses: [],
      deadlines: [],
      materials: [],
      downloads: [],
      reminders: [],
      summary: {
        readySources: 0,
        totalSources: 0,
        downloadsInFlight: 0,
        materialsReady: 0,
        remindersQueued: 0,
        deadlinesDueSoon: 0
      }
    } satisfies CampusWorkspaceSnapshot;
    await mkdir(join(storageRoot, "workspace"), { recursive: true });
    await writeFile(
      legacyPath,
      JSON.stringify({
        dataVersion: 3,
        snapshot,
        savedAt: "2026-07-20T08:01:00.000Z"
      }),
      "utf8"
    );
    const database = createDatabaseService({
      databasePath: join(storageRoot, "campusos.sqlite")
    });
    const store = createWorkspaceSnapshotStore({
      database,
      legacyStoragePath: legacyPath
    });

    try {
      await expect(store.load()).resolves.toEqual({
        snapshot,
        savedAt: "2026-07-20T08:01:00.000Z",
        storagePath: join(storageRoot, "campusos.sqlite")
      });
      await rm(legacyPath);
      await expect(store.load()).resolves.toEqual({
        snapshot,
        savedAt: "2026-07-20T08:01:00.000Z",
        storagePath: join(storageRoot, "campusos.sqlite")
      });
    } finally {
      database.close();
    }
  });
});
