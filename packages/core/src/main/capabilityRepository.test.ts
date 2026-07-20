import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AcademicProfileData } from "@campusos/shared";
import { createCapabilityRepository } from "./capabilityRepository";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("capability repository", () => {
  it("persists account-isolated data with provider provenance", async () => {
    const storageRoot = await mkdtemp(
      join(tmpdir(), "campusos-capability-store-")
    );
    temporaryDirectories.push(storageRoot);
    const createRepository = () => createCapabilityRepository({ storageRoot });

    await createRepository().publish(
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
      createRepository().read<AcademicProfileData>("academic.profile@1")
    ).resolves.toEqual([
      expect.objectContaining({
        providerId: "org.campusos.zju-undergraduate",
        accountId: "3240100001",
        state: "cache",
        data: expect.objectContaining({
          educationLevel: "undergraduate"
        })
      })
    ]);
  });
});
