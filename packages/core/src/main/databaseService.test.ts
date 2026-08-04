import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabaseService } from "./databaseService";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("database service", () => {
  it("migrates a SQLite database and persists workspace and account-isolated capability records", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "campusos-database-test-"));
    temporaryDirectories.push(storageRoot);
    const database = createDatabaseService({
      databasePath: join(storageRoot, "campusos.sqlite")
    });

    try {
      expect(database.schemaVersion).toBe(5);
      database.saveWorkspaceSnapshot({
        generatedAt: "2026-07-20T08:00:00.000Z",
        sources: ["fixture"]
      }, "2026-07-20T08:01:00.000Z");
      expect(database.loadWorkspaceSnapshot()).toEqual({
        snapshot: {
          generatedAt: "2026-07-20T08:00:00.000Z",
          sources: ["fixture"]
        },
        savedAt: "2026-07-20T08:01:00.000Z"
      });

      database.upsertCapabilityRecord(
        "calendar.events@1",
        "org.campusos.fixture",
        "account-a",
        { events: [{ id: "a" }] }
      );
      database.upsertCapabilityRecord(
        "calendar.events@1",
        "org.campusos.fixture",
        "account-b",
        { events: [{ id: "b" }] }
      );

      expect(
        database.readCapabilityRecords("calendar.events@1")
      ).toEqual([
        {
          providerId: "org.campusos.fixture",
          accountId: "account-a",
          payload: { events: [{ id: "a" }] }
        },
        {
          providerId: "org.campusos.fixture",
          accountId: "account-b",
          payload: { events: [{ id: "b" }] }
        }
      ]);
      database.saveDownloadQueue(
        [{ id: "download-a", status: "paused" }],
        "2026-07-20T08:02:00.000Z"
      );
      expect(database.loadDownloadQueue()).toEqual({
        queue: [{ id: "download-a", status: "paused" }],
        savedAt: "2026-07-20T08:02:00.000Z"
      });
      database.saveLocalTasks(
        [{ id: "task-a", status: "running" }],
        "2026-07-20T08:03:00.000Z"
      );
      expect(database.loadLocalTasks()).toEqual({
        tasks: [{ id: "task-a", status: "running" }],
        savedAt: "2026-07-20T08:03:00.000Z"
      });
      database.savePlannerSchedule(
        { valid: true, segments: [] },
        "2026-07-20T08:04:00.000Z"
      );
      expect(database.loadPlannerSchedule()).toEqual({
        schedule: { valid: true, segments: [] },
        savedAt: "2026-07-20T08:04:00.000Z"
      });
      database.saveAcademicGpaWeights(
        "account-a",
        { "course-a": 1.25, "course-b": 0 },
        "2026-07-20T08:05:00.000Z"
      );
      expect(database.loadAcademicGpaWeights("account-a")).toEqual({
        weights: { "course-a": 1.25, "course-b": 0 },
        savedAt: "2026-07-20T08:05:00.000Z"
      });
      expect(database.loadAcademicGpaWeights("account-b")).toBeNull();
      database.saveAcademicGpaStrategy(
        "account-a",
        "first",
        "2026-07-20T08:06:00.000Z"
      );
      expect(database.loadAcademicGpaStrategy("account-a")).toEqual({
        strategy: "first",
        savedAt: "2026-07-20T08:06:00.000Z"
      });
      expect(database.loadAcademicGpaStrategy("account-b")).toBeNull();
    } finally {
      database.close();
    }
  });
});
