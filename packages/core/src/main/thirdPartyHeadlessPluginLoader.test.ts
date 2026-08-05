import { describe, expect, it, vi } from "vitest";
import type { CapabilityRecord, PluginCapability } from "@campusos/shared";
import type { ThirdPartyHeadlessUtilityRunner } from "./thirdPartyHeadlessUtilityCoordinator";
import { createThirdPartyHeadlessPluginLoader } from "./thirdPartyHeadlessPluginLoader";

const capability = "academic.grades@1" as PluginCapability;

const record = (accountId: string | null, data: unknown): CapabilityRecord<unknown> => ({
  capability,
  providerId: "org.campusos.zju-undergraduate",
  accountId,
  state: "live",
  updatedAt: "2026-08-05T00:00:00.000Z",
  data
});

const repository = (records: CapabilityRecord<unknown>[]) => ({
  publish: vi.fn(),
  read: async <T>(): Promise<CapabilityRecord<T>[]> =>
    records as CapabilityRecord<T>[]
});

describe("third-party headless plugin loader", () => {
  it("projects only accountless and current-account capability records", async () => {
    const run = vi.fn(async () => ({ ok: true }));
    const loader = createThirdPartyHeadlessPluginLoader({
      capabilityRepository: repository([
        record(null, { scope: "public" }),
        record("account-a", { scope: "current" }),
        record("account-b", { scope: "other" }),
        { ...record("account-a", null), state: "unavailable" }
      ]),
      utilityRunner: { run } as ThirdPartyHeadlessUtilityRunner,
      readVerifiedAccountId: async () => "account-a"
    });

    const activation = await loader.activate({
      pluginId: "dev.example.headless",
      jobId: "refresh",
      source: "export function run(input) { return input; }",
      permissions: [],
      requiredCapabilities: [capability]
    });

    await activation.syncJobs[0].run();

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      pluginId: "dev.example.headless",
      capabilities: {
        [capability]: [
          expect.objectContaining({ accountId: null, data: { scope: "public" } }),
          expect.objectContaining({ accountId: "account-a", data: { scope: "current" } })
        ]
      }
    }));
  });

  it("keeps accountless records when no account is verified", async () => {
    const run = vi.fn(async () => null);
    const loader = createThirdPartyHeadlessPluginLoader({
      capabilityRepository: repository([
        record(null, { scope: "public" }),
        record("account-a", { scope: "private" })
      ]),
      utilityRunner: { run } as ThirdPartyHeadlessUtilityRunner,
      readVerifiedAccountId: async () => null
    });

    const activation = await loader.activate({
      pluginId: "dev.example.headless",
      jobId: "refresh",
      source: "export function run() { return null; }",
      permissions: [],
      requiredCapabilities: [capability]
    });
    await activation.syncJobs[0].run();

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      capabilities: {
        [capability]: [expect.objectContaining({ accountId: null })]
      }
    }));
  });
});
