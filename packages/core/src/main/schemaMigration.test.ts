import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  runSchemaMigrations,
  validateMigrationChain,
  type SchemaMigration
} from "./schemaMigration";

const testRoot = join(tmpdir(), "campusos-schema-migration-test");

const dirs: string[] = [];

const testStoragePath = (name: string): string => {
  const full = join(testRoot, name);
  dirs.push(full);
  return join(full, "store.json");
};

afterEach(async () => {
  for (const dir of dirs) {
    await rm(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

const createDefaultV0 = (): Record<string, unknown> => ({
  dataVersion: 0,
  plugins: {}
});

describe("validateMigrationChain", () => {
  it("accepts a valid ordered chain", () => {
    expect(
      validateMigrationChain([
        { version: 1, migrate: async (p) => p },
        { version: 2, migrate: async (p) => p }
      ])
    ).toBeNull();
  });

  it("rejects a gap", () => {
    expect(
      validateMigrationChain([
        { version: 1, migrate: async (p) => p },
        { version: 3, migrate: async (p) => p }
      ])
    ).toContain("gap");
  });

  it("rejects a duplicate", () => {
    expect(
      validateMigrationChain([
        { version: 1, migrate: async (p) => p },
        { version: 1, migrate: async (p) => p }
      ])
    ).toContain("Duplicate");
  });
});

describe("runSchemaMigrations", () => {
  it("creates a default payload when the file is missing", async () => {
    const storagePath = testStoragePath("missing");
    const payload = await runSchemaMigrations({
      storagePath,
      migrations: [],
      createDefaultPayload: createDefaultV0
    });

    expect(payload).toEqual({ dataVersion: 0, plugins: {} });
  });

  it("returns existing payload when no migrations are pending", async () => {
    const storagePath = testStoragePath("up-to-date");
    await mkdir(join(testRoot, "up-to-date"), { recursive: true });
    await writeFile(
      storagePath,
      JSON.stringify({ dataVersion: 2, plugins: { a: 1 } }),
      "utf8"
    );

    const payload = await runSchemaMigrations({
      storagePath,
      migrations: [
        {
          version: 1,
          migrate: async () => {
            throw new Error("should not run");
          }
        },
        {
          version: 2,
          migrate: async () => {
            throw new Error("should not run");
          }
        }
      ],
      createDefaultPayload: createDefaultV0
    });

    expect(payload).toEqual({ dataVersion: 2, plugins: { a: 1 } });
  });

  it("runs pending migrations in order", async () => {
    const storagePath = testStoragePath("pending");
    await mkdir(join(testRoot, "pending"), { recursive: true });
    await writeFile(
      storagePath,
      JSON.stringify({ dataVersion: 0, name: "v0" }),
      "utf8"
    );

    const v1: SchemaMigration = {
      version: 1,
      migrate: async (p) => ({
        ...p,
        name: `${String(p.name)}-migrated-v1`,
        added: "v1-field"
      })
    };
    const v2: SchemaMigration = {
      version: 2,
      migrate: async (p) => ({
        ...p,
        name: `${String(p.name)}-migrated-v2`,
        another: true
      })
    };

    const payload = await runSchemaMigrations({
      storagePath,
      migrations: [v1, v2],
      createDefaultPayload: createDefaultV0
    });

    expect(payload).toEqual({
      dataVersion: 2,
      name: "v0-migrated-v1-migrated-v2",
      added: "v1-field",
      another: true
    });
  });

  it("preserves atomicity by writing after all migrations complete", async () => {
    const storagePath = testStoragePath("atomic");
    await mkdir(join(testRoot, "atomic"), { recursive: true });
    await writeFile(
      storagePath,
      JSON.stringify({ dataVersion: 0, value: 1 }),
      "utf8"
    );

    const v1: SchemaMigration = {
      version: 1,
      migrate: async (p) => ({ ...p, value: (p.value as number) + 10 })
    };
    const v2: SchemaMigration = {
      version: 2,
      migrate: async (p) => ({ ...p, value: (p.value as number) + 100 })
    };
    const v3: SchemaMigration = {
      version: 3,
      migrate: async () => {
        throw new Error("migration failure");
      }
    };

    await expect(
      runSchemaMigrations({
        storagePath,
        migrations: [v1, v2, v3],
        createDefaultPayload: createDefaultV0
      })
    ).rejects.toThrow("migration failure");

    // The file on disk should still be at dataVersion 0 — no partial writes.
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(storagePath, "utf8");
    const onDisk = JSON.parse(raw) as Record<string, unknown>;
    expect(onDisk).toEqual({ dataVersion: 0, value: 1 });
  });

  it("handles dataVersion field as a bare integer", async () => {
    const storagePath = testStoragePath("bare-int");
    await mkdir(join(testRoot, "bare-int"), { recursive: true });
    await writeFile(
      storagePath,
      JSON.stringify({ dataVersion: 0, items: [] }),
      "utf8"
    );

    const v1: SchemaMigration = {
      version: 1,
      migrate: async (p) => ({ ...p, items: ["migrated"] })
    };

    const payload = await runSchemaMigrations({
      storagePath,
      migrations: [v1],
      createDefaultPayload: createDefaultV0
    });

    expect(payload).toEqual({ dataVersion: 1, items: ["migrated"] });
  });

  it("runs only the migrations with version > current", async () => {
    const storagePath = testStoragePath("skip");
    await mkdir(join(testRoot, "skip"), { recursive: true });
    await writeFile(
      storagePath,
      JSON.stringify({ dataVersion: 1, stage: 1 }),
      "utf8"
    );

    const callOrder: number[] = [];
    const v1: SchemaMigration = {
      version: 1,
      migrate: async (p) => {
        callOrder.push(1);
        return p;
      }
    };
    const v2: SchemaMigration = {
      version: 2,
      migrate: async (p) => {
        callOrder.push(2);
        return { ...p, stage: 2 };
      }
    };

    const payload = await runSchemaMigrations({
      storagePath,
      migrations: [v1, v2],
      createDefaultPayload: createDefaultV0
    });

    expect(callOrder).toEqual([2]);
    expect(payload).toEqual({ dataVersion: 2, stage: 2 });
  });
});
