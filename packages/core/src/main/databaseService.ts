import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { BriefCachedItem } from "@campusos/shared";

// Legacy schema compatibility only. New academic GPA business logic follows
// Celechron's first returned attempt and never reads or writes this table.
type LegacyAcademicGpaStrategy = "best" | "first";

export interface StoredWorkspaceSnapshot {
  snapshot: unknown;
  savedAt: string;
}

export interface StoredCapabilityRecord {
  providerId: string;
  accountId: string | null;
  payload: unknown;
}

export interface StoredDownloadQueue {
  queue: unknown;
  savedAt: string;
}

export interface StoredLocalTasks {
  tasks: unknown;
  savedAt: string;
}

export interface StoredAcademicGpaStrategy {
  strategy: LegacyAcademicGpaStrategy;
  savedAt: string;
}

export interface StoredAcademicGradeNotificationBaseline {
  fivePointGpa: number;
  gradedCourseCount: number;
  fused: true;
  savedAt: string;
}

export interface StoredBriefProfile {
  profile: unknown;
  savedAt: string;
}

export interface StoredBriefSnapshot {
  snapshot: unknown;
  savedAt: string;
}

export interface DatabaseService {
  readonly databasePath: string;
  readonly schemaVersion: number;
  close: () => void;
  saveWorkspaceSnapshot: (snapshot: unknown, savedAt: string) => void;
  loadWorkspaceSnapshot: () => StoredWorkspaceSnapshot | null;
  upsertCapabilityRecord: (
    capability: string,
    providerId: string,
    accountId: string | null,
    payload: unknown
  ) => void;
  readCapabilityRecords: (capability: string) => StoredCapabilityRecord[];
  saveDownloadQueue: (queue: unknown, savedAt: string) => void;
  loadDownloadQueue: () => StoredDownloadQueue | null;
  saveLocalTasks: (tasks: unknown, savedAt: string) => void;
  loadLocalTasks: () => StoredLocalTasks | null;
  saveAcademicGpaStrategy: (
    accountId: string,
    strategy: LegacyAcademicGpaStrategy,
    savedAt: string
  ) => void;
  loadAcademicGpaStrategy: (accountId: string) => StoredAcademicGpaStrategy | null;
  saveAcademicGradeNotificationBaseline: (
    accountId: string,
    baseline: Omit<StoredAcademicGradeNotificationBaseline, "fused">
  ) => void;
  loadAcademicGradeNotificationBaseline: (
    accountId: string
  ) => StoredAcademicGradeNotificationBaseline | null;
  saveBriefProfile: (profile: unknown, savedAt: string) => void;
  loadBriefProfile: () => StoredBriefProfile | null;
  saveBriefSnapshot: (snapshot: unknown, savedAt: string) => void;
  loadBriefSnapshot: () => StoredBriefSnapshot | null;
  /** Returns true when the item was newly inserted (dedupe across days). */
  upsertBriefItem: (item: BriefCachedItem) => boolean;
  findBriefItem: (fingerprint: string) => BriefCachedItem | null;
  listCampusFeedSources: () => { config: unknown; savedAt: string }[];
  saveCampusFeedSource: (id: string, config: unknown, savedAt: string) => void;
  deleteCampusFeedSource: (id: string) => void;
  /** Returns true when the item was newly inserted (canonical-URL dedupe). */
  upsertCampusFeedItem: (item: unknown) => boolean;
  listCampusFeedItems: (limit: number) => { item: unknown; savedAt: string }[];
  markCampusFeedItemsRead: (ids: string[]) => void;
  findCampusFeedItem: (id: string) => unknown | null;
  saveCampusFeedAiSettings: (settings: unknown, savedAt: string) => void;
  loadCampusFeedAiSettings: () => { settings: unknown; savedAt: string } | null;
}

const capabilityAccountKey = (accountId: string | null): string =>
  accountId === null
    ? "no-account"
    : createHash("sha256").update(accountId, "utf8").digest("hex");

const migrate = (database: Database.Database): void => {
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  const applyMigration = (version: number, statements: string): void => {
    const applied = database
      .prepare("SELECT 1 FROM schema_migrations WHERE version = ?")
      .get(version);
    if (applied) return;
    database.transaction(() => {
      database.exec(statements);
      database
        .prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
        .run(version, new Date().toISOString());
    })();
  };

  applyMigration(1, `
      CREATE TABLE workspace_snapshots (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        snapshot_json TEXT NOT NULL,
        saved_at TEXT NOT NULL
      );
      CREATE TABLE capability_records (
        capability TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        account_key TEXT NOT NULL,
        account_id TEXT,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (capability, provider_id, account_key)
      );
      CREATE INDEX capability_records_lookup
        ON capability_records (capability, provider_id, account_key);
  `);
  applyMigration(2, `
    CREATE TABLE download_queues (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      queue_json TEXT NOT NULL,
      saved_at TEXT NOT NULL
    );
  `);
  applyMigration(3, `
    CREATE TABLE local_task_sets (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      tasks_json TEXT NOT NULL,
      saved_at TEXT NOT NULL
    );
    CREATE TABLE planner_schedules (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      schedule_json TEXT NOT NULL,
      saved_at TEXT NOT NULL
    );
  `);
  applyMigration(5, `
    CREATE TABLE academic_gpa_strategies (
      account_key TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      strategy TEXT NOT NULL CHECK (strategy IN ('best', 'first')),
      saved_at TEXT NOT NULL
    );
  `);
  applyMigration(6, `
    CREATE TABLE academic_grade_notification_baselines (
      account_key TEXT PRIMARY KEY,
      five_point_gpa REAL NOT NULL,
      graded_course_count INTEGER NOT NULL CHECK (graded_course_count >= 0),
      fused INTEGER NOT NULL CHECK (fused = 1),
      saved_at TEXT NOT NULL
    );
  `);
  applyMigration(7, `
    CREATE TABLE brief_profiles (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      profile_json TEXT NOT NULL,
      saved_at TEXT NOT NULL
    );
    CREATE TABLE brief_snapshots (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      snapshot_json TEXT NOT NULL,
      saved_at TEXT NOT NULL
    );
    CREATE TABLE brief_item_cache (
      fingerprint TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT,
      published_at TEXT,
      fetched_at TEXT NOT NULL
    );
    CREATE INDEX brief_item_cache_fetched
      ON brief_item_cache (fetched_at);
  `);
  applyMigration(8, `
    CREATE TABLE campus_feed_sources (
      id TEXT PRIMARY KEY,
      config_json TEXT NOT NULL,
      saved_at TEXT NOT NULL
    );
    CREATE TABLE campus_feed_items (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT,
      published_at TEXT,
      content_hash TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'new' CHECK (state IN ('new', 'read'))
    );
    CREATE INDEX campus_feed_items_fetched
      ON campus_feed_items (fetched_at);
  `);
  applyMigration(9, `
    CREATE TABLE campus_feed_ai_settings (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      settings_json TEXT NOT NULL,
      saved_at TEXT NOT NULL
    );
  `);
};

export const createDatabaseService = ({
  databasePath
}: {
  databasePath: string;
}): DatabaseService => {
  mkdirSync(dirname(databasePath), { recursive: true });
  const database = new Database(databasePath);
  migrate(database);

  return {
    databasePath,
    get schemaVersion(): number {
      const row = database
        .prepare("SELECT MAX(version) AS version FROM schema_migrations")
        .get() as { version: number | null };
      return row.version ?? 0;
    },
    close: () => database.close(),
    saveWorkspaceSnapshot: (snapshot, savedAt) => {
      if (!Number.isFinite(Date.parse(savedAt))) {
        throw new Error("工作区快照保存时间无效。");
      }
      database
        .prepare(`
          INSERT INTO workspace_snapshots (singleton, snapshot_json, saved_at)
          VALUES (1, ?, ?)
          ON CONFLICT(singleton) DO UPDATE SET
            snapshot_json = excluded.snapshot_json,
            saved_at = excluded.saved_at
        `)
        .run(JSON.stringify(snapshot), savedAt);
    },
    loadWorkspaceSnapshot: () => {
      const row = database
        .prepare(
          "SELECT snapshot_json, saved_at FROM workspace_snapshots WHERE singleton = 1"
        )
        .get() as { snapshot_json: string; saved_at: string } | undefined;
      if (!row) return null;
      return {
        snapshot: JSON.parse(row.snapshot_json) as unknown,
        savedAt: row.saved_at
      };
    },
    upsertCapabilityRecord: (capability, providerId, accountId, payload) => {
      if (!capability || !providerId) {
        throw new Error("Capability 和 provider 不能为空。");
      }
      database
        .prepare(`
          INSERT INTO capability_records (
            capability, provider_id, account_key, account_id, payload_json
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(capability, provider_id, account_key) DO UPDATE SET
            account_id = excluded.account_id,
            payload_json = excluded.payload_json
        `)
        .run(
          capability,
          providerId,
          capabilityAccountKey(accountId),
          accountId,
          JSON.stringify(payload)
        );
    },
    readCapabilityRecords: (capability) =>
      (database
        .prepare(`
          SELECT provider_id, account_id, payload_json
          FROM capability_records
          WHERE capability = ?
          ORDER BY provider_id ASC, account_id ASC
        `)
        .all(capability) as {
        provider_id: string;
        account_id: string | null;
        payload_json: string;
      }[]).map((row) => ({
        providerId: row.provider_id,
        accountId: row.account_id,
        payload: JSON.parse(row.payload_json) as unknown
      })),
    saveDownloadQueue: (queue, savedAt) => {
      if (!Number.isFinite(Date.parse(savedAt))) {
        throw new Error("下载队列保存时间无效。");
      }
      database
        .prepare(`
          INSERT INTO download_queues (singleton, queue_json, saved_at)
          VALUES (1, ?, ?)
          ON CONFLICT(singleton) DO UPDATE SET
            queue_json = excluded.queue_json,
            saved_at = excluded.saved_at
        `)
        .run(JSON.stringify(queue), savedAt);
    },
    loadDownloadQueue: () => {
      const row = database
        .prepare(
          "SELECT queue_json, saved_at FROM download_queues WHERE singleton = 1"
        )
        .get() as { queue_json: string; saved_at: string } | undefined;
      if (!row) return null;
      return {
        queue: JSON.parse(row.queue_json) as unknown,
        savedAt: row.saved_at
      };
    },
    saveLocalTasks: (tasks, savedAt) => {
      if (!Number.isFinite(Date.parse(savedAt))) {
        throw new Error("任务保存时间无效。");
      }
      database.prepare(`
        INSERT INTO local_task_sets (singleton, tasks_json, saved_at)
        VALUES (1, ?, ?)
        ON CONFLICT(singleton) DO UPDATE SET
          tasks_json = excluded.tasks_json,
          saved_at = excluded.saved_at
      `).run(JSON.stringify(tasks), savedAt);
    },
    loadLocalTasks: () => {
      const row = database.prepare(
        "SELECT tasks_json, saved_at FROM local_task_sets WHERE singleton = 1"
      ).get() as { tasks_json: string; saved_at: string } | undefined;
      return row ? { tasks: JSON.parse(row.tasks_json) as unknown, savedAt: row.saved_at } : null;
    },
    saveAcademicGpaStrategy: (accountId, strategy, savedAt) => {
      if (!accountId.trim()) throw new Error("GPA 策略账户不能为空。");
      if (strategy !== "best" && strategy !== "first") {
        throw new Error("GPA 策略必须是 best 或 first。");
      }
      if (!Number.isFinite(Date.parse(savedAt))) {
        throw new Error("GPA 策略保存时间无效。");
      }
      database.prepare(`
        INSERT INTO academic_gpa_strategies (
          account_key, account_id, strategy, saved_at
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT(account_key) DO UPDATE SET
          account_id = excluded.account_id,
          strategy = excluded.strategy,
          saved_at = excluded.saved_at
      `).run(capabilityAccountKey(accountId), accountId, strategy, savedAt);
    },
    loadAcademicGpaStrategy: (accountId) => {
      if (!accountId.trim()) return null;
      const row = database.prepare(`
        SELECT strategy, saved_at
        FROM academic_gpa_strategies
        WHERE account_key = ? AND account_id = ?
      `).get(capabilityAccountKey(accountId), accountId) as {
        strategy: string;
        saved_at: string;
      } | undefined;
      if (!row || (row.strategy !== "best" && row.strategy !== "first")) {
        return null;
      }
      return { strategy: row.strategy, savedAt: row.saved_at };
    },
    saveAcademicGradeNotificationBaseline: (accountId, baseline) => {
      if (!accountId.trim()) {
        throw new Error("Grade notification account cannot be empty.");
      }
      if (!Number.isFinite(baseline.fivePointGpa)) {
        throw new Error("Grade notification GPA must be finite.");
      }
      if (
        !Number.isInteger(baseline.gradedCourseCount) ||
        baseline.gradedCourseCount < 0
      ) {
        throw new Error("Grade notification course count must be a non-negative integer.");
      }
      if (!Number.isFinite(Date.parse(baseline.savedAt))) {
        throw new Error("Grade notification baseline time is invalid.");
      }
      database.prepare(`
        INSERT INTO academic_grade_notification_baselines (
          account_key, five_point_gpa, graded_course_count, fused, saved_at
        ) VALUES (?, ?, ?, 1, ?)
        ON CONFLICT(account_key) DO UPDATE SET
          five_point_gpa = excluded.five_point_gpa,
          graded_course_count = excluded.graded_course_count,
          fused = excluded.fused,
          saved_at = excluded.saved_at
      `).run(
        capabilityAccountKey(accountId),
        baseline.fivePointGpa,
        baseline.gradedCourseCount,
        baseline.savedAt
      );
    },
    loadAcademicGradeNotificationBaseline: (accountId) => {
      if (!accountId.trim()) return null;
      const row = database.prepare(`
        SELECT five_point_gpa, graded_course_count, fused, saved_at
        FROM academic_grade_notification_baselines
        WHERE account_key = ?
      `).get(capabilityAccountKey(accountId)) as {
        five_point_gpa: number;
        graded_course_count: number;
        fused: number;
        saved_at: string;
      } | undefined;
      if (!row || row.fused !== 1) return null;
      return {
        fivePointGpa: row.five_point_gpa,
        gradedCourseCount: row.graded_course_count,
        fused: true,
        savedAt: row.saved_at
      };
    },
    saveBriefProfile: (profile, savedAt) => {
      if (!Number.isFinite(Date.parse(savedAt))) {
        throw new Error("早报画像保存时间无效。");
      }
      database.prepare(`
        INSERT INTO brief_profiles (singleton, profile_json, saved_at)
        VALUES (1, ?, ?)
        ON CONFLICT(singleton) DO UPDATE SET
          profile_json = excluded.profile_json,
          saved_at = excluded.saved_at
      `).run(JSON.stringify(profile), savedAt);
    },
    loadBriefProfile: () => {
      const row = database.prepare(
        "SELECT profile_json, saved_at FROM brief_profiles WHERE singleton = 1"
      ).get() as { profile_json: string; saved_at: string } | undefined;
      return row ? { profile: JSON.parse(row.profile_json) as unknown, savedAt: row.saved_at } : null;
    },
    saveBriefSnapshot: (snapshot, savedAt) => {
      if (!Number.isFinite(Date.parse(savedAt))) {
        throw new Error("早报快照保存时间无效。");
      }
      database.prepare(`
        INSERT INTO brief_snapshots (singleton, snapshot_json, saved_at)
        VALUES (1, ?, ?)
        ON CONFLICT(singleton) DO UPDATE SET
          snapshot_json = excluded.snapshot_json,
          saved_at = excluded.saved_at
      `).run(JSON.stringify(snapshot), savedAt);
    },
    loadBriefSnapshot: () => {
      const row = database.prepare(
        "SELECT snapshot_json, saved_at FROM brief_snapshots WHERE singleton = 1"
      ).get() as { snapshot_json: string; saved_at: string } | undefined;
      return row ? { snapshot: JSON.parse(row.snapshot_json) as unknown, savedAt: row.saved_at } : null;
    },
    upsertBriefItem: (item) => {
      if (!item.fingerprint || !item.url || !item.title || !item.sourceId) {
        throw new Error("早报条目缺少必要字段。");
      }
      if (!Number.isFinite(Date.parse(item.fetchedAt))) {
        throw new Error("早报条目抓取时间无效。");
      }
      const result = database.prepare(`
        INSERT OR IGNORE INTO brief_item_cache (
          fingerprint, source_id, url, title, summary, published_at, fetched_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        item.fingerprint,
        item.sourceId,
        item.url,
        item.title,
        item.summary,
        item.publishedAt,
        item.fetchedAt
      );
      return result.changes === 1;
    },
    findBriefItem: (fingerprint) => {
      const row = database.prepare(`
        SELECT fingerprint, source_id, url, title, summary, published_at, fetched_at
        FROM brief_item_cache
        WHERE fingerprint = ?
      `).get(fingerprint) as {
        fingerprint: string;
        source_id: string;
        url: string;
        title: string;
        summary: string | null;
        published_at: string | null;
        fetched_at: string;
      } | undefined;
      if (!row) return null;
      return {
        fingerprint: row.fingerprint,
        sourceId: row.source_id,
        url: row.url,
        title: row.title,
        summary: row.summary,
        publishedAt: row.published_at,
        fetchedAt: row.fetched_at
      };
    },
    listCampusFeedSources: () => {
      const rows = database.prepare(
        "SELECT config_json, saved_at FROM campus_feed_sources ORDER BY saved_at ASC"
      ).all() as { config_json: string; saved_at: string }[];
      return rows.map((row) => ({
        config: JSON.parse(row.config_json) as unknown,
        savedAt: row.saved_at
      }));
    },
    saveCampusFeedSource: (id, config, savedAt) => {
      if (!id || !Number.isFinite(Date.parse(savedAt))) {
        throw new Error("校园资讯订阅源保存参数无效。");
      }
      database.prepare(`
        INSERT INTO campus_feed_sources (id, config_json, saved_at)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          config_json = excluded.config_json,
          saved_at = excluded.saved_at
      `).run(id, JSON.stringify(config), savedAt);
    },
    deleteCampusFeedSource: (id) => {
      database.prepare("DELETE FROM campus_feed_sources WHERE id = ?").run(id);
      database.prepare("DELETE FROM campus_feed_items WHERE source_id = ?").run(id);
    },
    upsertCampusFeedItem: (item) => {
      const candidate = item as {
        id: string;
        sourceId: string;
        url: string;
        title: string;
        summary: string | null;
        publishedAt: string | null;
        contentHash: string;
        fetchedAt: string;
      };
      if (!candidate.id || !candidate.sourceId || !candidate.url || !candidate.title || !candidate.contentHash) {
        throw new Error("校园资讯条目缺少必要字段。");
      }
      if (!Number.isFinite(Date.parse(candidate.fetchedAt))) {
        throw new Error("校园资讯条目抓取时间无效。");
      }
      const result = database.prepare(`
        INSERT OR IGNORE INTO campus_feed_items (
          id, source_id, url, title, summary, published_at, content_hash, fetched_at, state
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new')
      `).run(
        candidate.id,
        candidate.sourceId,
        candidate.url,
        candidate.title,
        candidate.summary,
        candidate.publishedAt,
        candidate.contentHash,
        candidate.fetchedAt
      );
      return result.changes === 1;
    },
    listCampusFeedItems: (limit) => {
      const rows = database.prepare(`
        SELECT id, source_id, url, title, summary, published_at, content_hash, fetched_at, state
        FROM campus_feed_items
        ORDER BY fetched_at DESC, id ASC
        LIMIT ?
      `).all(limit) as {
        id: string;
        source_id: string;
        url: string;
        title: string;
        summary: string | null;
        published_at: string | null;
        content_hash: string;
        fetched_at: string;
        state: string;
      }[];
      return rows.map((row) => ({
        item: {
          id: row.id,
          sourceId: row.source_id,
          url: row.url,
          title: row.title,
          summary: row.summary,
          publishedAt: row.published_at,
          contentHash: row.content_hash,
          fetchedAt: row.fetched_at,
          state: row.state
        },
        savedAt: row.fetched_at
      }));
    },
    markCampusFeedItemsRead: (ids) => {
      if (ids.length === 0) return;
      const statement = database.prepare(
        "UPDATE campus_feed_items SET state = 'read' WHERE id = ?"
      );
      database.transaction(() => {
        for (const id of ids) statement.run(id);
      })();
    },
    findCampusFeedItem: (id) => {
      const row = database.prepare(`
        SELECT id, source_id, url, title, summary, published_at, content_hash, fetched_at, state
        FROM campus_feed_items
        WHERE id = ?
      `).get(id) as {
        id: string;
        source_id: string;
        url: string;
        title: string;
        summary: string | null;
        published_at: string | null;
        content_hash: string;
        fetched_at: string;
        state: string;
      } | undefined;
      if (!row) return null;
      return {
        id: row.id,
        sourceId: row.source_id,
        url: row.url,
        title: row.title,
        summary: row.summary,
        publishedAt: row.published_at,
        contentHash: row.content_hash,
        fetchedAt: row.fetched_at,
        state: row.state
      };
    },
    saveCampusFeedAiSettings: (settings, savedAt) => {
      if (!Number.isFinite(Date.parse(savedAt))) {
        throw new Error("校园资讯 AI 设置保存时间无效。");
      }
      database.prepare(`
        INSERT INTO campus_feed_ai_settings (singleton, settings_json, saved_at)
        VALUES (1, ?, ?)
        ON CONFLICT(singleton) DO UPDATE SET
          settings_json = excluded.settings_json,
          saved_at = excluded.saved_at
      `).run(JSON.stringify(settings), savedAt);
    },
    loadCampusFeedAiSettings: () => {
      const row = database.prepare(
        "SELECT settings_json, saved_at FROM campus_feed_ai_settings WHERE singleton = 1"
      ).get() as { settings_json: string; saved_at: string } | undefined;
      return row
        ? { settings: JSON.parse(row.settings_json) as unknown, savedAt: row.saved_at }
        : null;
    }
  };
};
