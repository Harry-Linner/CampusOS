import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

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
    }
  };
};
