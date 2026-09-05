import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
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
      expect(database.schemaVersion).toBe(13);
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
      database.saveDesktopCalendarState("settings", { opacity: 0.8 }, "2026-07-20T08:04:00.000Z");
      expect(database.loadDesktopCalendarState("settings")).toEqual({
        value: { opacity: 0.8 },
        savedAt: "2026-07-20T08:04:00.000Z"
      });
      database.saveAcademicGpaStrategy(
        "account-a",
        "first",
        "2026-07-20T08:05:00.000Z"
      );
      expect(database.loadAcademicGpaStrategy("account-a")).toEqual({
        strategy: "first",
        savedAt: "2026-07-20T08:05:00.000Z"
      });
      expect(database.loadAcademicGpaStrategy("account-b")).toBeNull();
      expect(database.loadCampusFeedRefreshState("xgb-pingjiang")).toBeNull();
      database.saveCampusFeedRefreshState("xgb-pingjiang", "2026-07-20T08:06:00.000Z");
      expect(database.loadCampusFeedRefreshState("xgb-pingjiang")).toBe("2026-07-20T08:06:00.000Z");

      expect(() =>
        database.saveAcademicGpaStrategy("", "first", "2026-07-20T08:05:00.000Z")
      ).toThrow("GPA 策略账户不能为空。");
      expect(() =>
        database.saveAcademicGpaStrategy(
          "account-a",
          "invalid" as "first",
          "2026-07-20T08:05:00.000Z"
        )
      ).toThrow("GPA 策略必须是 best 或 first。");
      expect(() =>
        database.saveAcademicGpaStrategy("account-a", "first", "not-a-date")
      ).toThrow("GPA 策略保存时间无效。");
    } finally {
      database.close();
    }
  });

  it("removes the legacy planner schedule table when migrating an existing v9 database", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "campusos-database-v9-test-"));
    temporaryDirectories.push(storageRoot);
    const databasePath = join(storageRoot, "campusos.sqlite");
    const legacyDatabase = new Database(databasePath);
    legacyDatabase.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      INSERT INTO schema_migrations (version, applied_at) VALUES
        (1, '2026-01-01T00:00:00.000Z'),
        (2, '2026-01-01T00:00:00.000Z'),
        (3, '2026-01-01T00:00:00.000Z'),
        (5, '2026-01-01T00:00:00.000Z'),
        (6, '2026-01-01T00:00:00.000Z'),
        (7, '2026-01-01T00:00:00.000Z'),
        (8, '2026-01-01T00:00:00.000Z'),
        (9, '2026-01-01T00:00:00.000Z');
      CREATE TABLE planner_schedules (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        schedule_json TEXT NOT NULL,
        saved_at TEXT NOT NULL
      );
      INSERT INTO planner_schedules (singleton, schedule_json, saved_at)
      VALUES (1, '{}', '2026-01-01T00:00:00.000Z');
    `);
    legacyDatabase.close();

    const database = createDatabaseService({ databasePath });
    try {
      expect(database.schemaVersion).toBe(13);
    } finally {
      database.close();
    }

    const migratedDatabase = new Database(databasePath, { readonly: true });
    try {
      const plannerTable = migratedDatabase
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get("planner_schedules");
      expect(plannerTable).toBeUndefined();
      expect(
        migratedDatabase
          .prepare("SELECT 1 AS applied FROM schema_migrations WHERE version = 10")
          .get()
      ).toEqual({ applied: 1 });
      expect(
        migratedDatabase
          .prepare("SELECT 1 AS applied FROM schema_migrations WHERE version = 11")
          .get()
      ).toEqual({ applied: 1 });
    } finally {
      migratedDatabase.close();
    }
  });
});
