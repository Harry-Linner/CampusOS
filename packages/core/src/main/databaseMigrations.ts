/*
 * SQLite schema migrations for the CampusOS database.
 *
 * Extracted from databaseService.ts; the DDL text and
 * the order of the steps are unchanged, so an existing database runs exactly the same
 * statements as before. The chain is append-only: add a new applyMigration(n, ...) at the
 * end and never edit an applied step, because schema_migrations records what a user's
 * database has already run.
 */
import Database from "better-sqlite3";

export const migrate = (database: Database.Database): void => {
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
  applyMigration(10, `
    DROP TABLE IF EXISTS planner_schedules;
  `);
  applyMigration(11, `
    CREATE TABLE campus_feed_refresh_state (
      source_id TEXT PRIMARY KEY,
      last_success_at TEXT NOT NULL
    );
  `);
  applyMigration(12, `
    CREATE TABLE desktop_calendar_state (
      state_key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      saved_at TEXT NOT NULL
    );
  `);
  applyMigration(13, `
    CREATE TABLE notifications (
      id TEXT PRIMARY KEY,
      record_json TEXT NOT NULL
    );
    CREATE TABLE notification_storage_meta (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      legacy_imported INTEGER NOT NULL DEFAULT 0 CHECK (legacy_imported IN (0, 1))
    );
    INSERT INTO notification_storage_meta (singleton, legacy_imported) VALUES (1, 0);
  `);
  applyMigration(14, `
    CREATE TABLE campus_feed_notification_settings (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      settings_json TEXT NOT NULL,
      saved_at TEXT NOT NULL
    );
  `);
  // v10 in the unpublished collaboration build already created these tables.
  // Keep that local data while upgrading both upstream and collaboration databases.
  applyMigration(15, `
    DROP TABLE IF EXISTS planner_schedules;
    CREATE TABLE IF NOT EXISTS campus_feed_preferences (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      preferences_json TEXT NOT NULL,
      saved_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS campus_feed_details (
      item_id TEXT PRIMARY KEY,
      detail_json TEXT NOT NULL,
      saved_at TEXT NOT NULL
    );
  `);
};
