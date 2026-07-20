import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AcademicProfileData } from "@campusos/shared";
import { createDatabaseService } from "./databaseService";
import { createSqliteCapabilityRepository } from "./sqliteCapabilityRepository";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("SQLite capability repository", () => {
  it("persists account-isolated capability records with provider provenance", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "campusos-sqlite-capability-"));
    temporaryDirectories.push(storageRoot);
    const database = createDatabaseService({
      databasePath: join(storageRoot, "campusos.sqlite")
    });
    const repository = createSqliteCapabilityRepository({ database });

    try {
      await repository.publish(
        "org.campusos.zju-undergraduate",
        ["academic.profile@1"],
        {
          capability: "academic.profile@1",
          accountId: "3240100001",
          state: "cache",
          updatedAt: "2026-07-19T04:00:00.000Z",
          data: {
            studentId: "3240100001",
            educationLevel: "undergraduate",
            verifiedAt: "2026-07-18T08:00:00.000Z",
            verifiedService: "undergraduate-academic-affairs"
          } satisfies AcademicProfileData
        }
      );

      await expect(
        repository.read<AcademicProfileData>("academic.profile@1")
      ).resolves.toEqual([
        expect.objectContaining({
          providerId: "org.campusos.zju-undergraduate",
          accountId: "3240100001",
          state: "cache",
          data: expect.objectContaining({ educationLevel: "undergraduate" })
        })
      ]);
    } finally {
      database.close();
    }
  });
});
