import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * A single schema migration step.
 *
 * `version` is the target dataVersion AFTER this migration runs.
 * Migrations are applied in ascending version order.
 */
export interface SchemaMigration {
  /** Target dataVersion after this migration completes. Must be >= 1. */
  version: number;
  /** Transform the payload from the previous version. Receives the full parsed payload. */
  migrate: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

/**
 * Options for running schema migrations against a persisted JSON file.
 */
export interface SchemaMigrationOptions {
  /** Absolute path to the persisted JSON file. */
  storagePath: string;
  /** Ordered list of migrations (sorted by version ascending before running). */
  migrations: readonly SchemaMigration[];
  /** Default payload to write when the file does not exist. Must include dataVersion: 0. */
  createDefaultPayload: () => Record<string, unknown>;
}

const isMissingFileError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code: string }).code === "ENOENT";

/**
 * Run pending schema migrations and return the current payload.
 *
 * - Reads the file at `storagePath`
 * - If missing, writes `createDefaultPayload()` with dataVersion: 0
 * - Runs any migrations whose `version` > current dataVersion, in order
 * - Each migration receives the full payload and returns the migrated payload
 * - Updates dataVersion to the migration's version after each step
 * - Writes atomically (tmp + rename) after ALL pending migrations complete
 * - Returns the final payload
 */
export const runSchemaMigrations = async ({
  storagePath,
  migrations,
  createDefaultPayload
}: SchemaMigrationOptions): Promise<Record<string, unknown>> => {
  const sorted = [...migrations].sort(
    (left, right) => left.version - right.version
  );

  // Validate migrations
  const seen = new Set<number>();
  for (const migration of sorted) {
    if (migration.version < 1 || !Number.isInteger(migration.version)) {
      throw new Error(
        `Schema migration version must be a positive integer, got ${migration.version}.`
      );
    }
    if (seen.has(migration.version)) {
      throw new Error(
        `Duplicate schema migration version: ${migration.version}.`
      );
    }
    seen.add(migration.version);
  }

  let payload: Record<string, unknown>;

  try {
    const raw = await readFile(storagePath, "utf8");
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
    payload = createDefaultPayload();
    await writePayload(storagePath, payload);
  }

  const currentVersion =
    typeof payload.dataVersion === "number" && Number.isInteger(payload.dataVersion)
      ? (payload.dataVersion as number)
      : 0;

  if (currentVersion < 0) {
    throw new Error(
      `Storage at ${storagePath} has an unsupported dataVersion: ${currentVersion}.`
    );
  }

  const pending = sorted.filter(
    (migration) => migration.version > currentVersion
  );

  if (pending.length === 0) return payload;

  for (const migration of pending) {
    payload = await migration.migrate(payload);
    payload = { ...payload, dataVersion: migration.version };
  }

  await writePayload(storagePath, payload);
  return payload;
};

const writePayload = async (
  storagePath: string,
  payload: Record<string, unknown>
): Promise<void> => {
  await mkdir(dirname(storagePath), { recursive: true });
  const operationId = randomUUID();
  const temporaryPath = `${storagePath}.${operationId}.tmp`;
  const backupPath = `${storagePath}.${operationId}.backup`;
  let hasBackup = false;

  try {
    await writeFile(temporaryPath, JSON.stringify(payload, null, 2), {
      encoding: "utf8",
      flag: "wx"
    });
    try {
      await rename(storagePath, backupPath);
      hasBackup = true;
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }
    await rename(temporaryPath, storagePath);
    if (hasBackup) await rm(backupPath, { force: true });
  } catch (error) {
    const recoveryErrors: unknown[] = [error];
    await rm(temporaryPath, { force: true }).catch((cleanupError) => {
      recoveryErrors.push(cleanupError);
    });
    if (hasBackup) {
      await rename(backupPath, storagePath).catch((recoveryError) => {
        recoveryErrors.push(recoveryError);
      });
    }
    if (recoveryErrors.length > 1) {
      throw new AggregateError(
        recoveryErrors,
        "Schema migration write and recovery both failed."
      );
    }
    throw error;
  }
};

/**
 * Validate that a set of migrations forms a complete, gapless chain from version 0.
 * Useful for testing and startup checks.
 */
export const validateMigrationChain = (
  migrations: readonly SchemaMigration[]
): string | null => {
  if (migrations.length === 0) return null;

  const sorted = [...migrations].sort(
    (left, right) => left.version - right.version
  );

  const seen = new Set<number>();
  for (const migration of sorted) {
    if (seen.has(migration.version)) {
      return `Duplicate migration version: ${migration.version}`;
    }
    seen.add(migration.version);
  }

  for (let index = 0; index < sorted.length; index += 1) {
    const expected = index + 1;
    if (sorted[index].version !== expected) {
      return `Migration version gap: expected v${expected}, found v${sorted[index].version}`;
    }
  }

  return null;
};
