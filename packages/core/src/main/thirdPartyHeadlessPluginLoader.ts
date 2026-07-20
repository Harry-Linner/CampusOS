import type { CampusPermission, PluginCapability } from "@campusos/shared";
import type { ThirdPartyHeadlessUtilityRunner } from "./thirdPartyHeadlessUtilityCoordinator";
import type { ThirdPartyHeadlessSandboxLimits } from "./thirdPartyHeadlessSandbox";
import type { CapabilityRepository } from "./capabilityRepository";

export interface ThirdPartyHeadlessSyncJob {
  pluginId: string;
  jobId: string;
  source: string;
  permissions: readonly CampusPermission[];
  requiredCapabilities: readonly PluginCapability[];
}

export interface ThirdPartyHeadlessPluginLoaderOptions {
  capabilityRepository: CapabilityRepository;
  utilityRunner: ThirdPartyHeadlessUtilityRunner;
  sandboxLimits?: Partial<ThirdPartyHeadlessSandboxLimits>;
}

export interface ThirdPartyHeadlessActivationResult {
  syncJobs: Array<{
    id: string;
    run: () => Promise<unknown>;
  }>;
}

/**
 * Create a function that activates a third-party headless plugin.
 *
 * Before each sync job run, it pre-loads the required capability data
 * from the capability repository and passes it into the sandbox via
 * `__CAMPUSOS_CAPABILITIES_JSON__`.
 */
export const createThirdPartyHeadlessPluginLoader = ({
  capabilityRepository,
  utilityRunner,
  sandboxLimits
}: ThirdPartyHeadlessPluginLoaderOptions) => {
  const activate = async (
    job: ThirdPartyHeadlessSyncJob
  ): Promise<ThirdPartyHeadlessActivationResult> => {
    const { pluginId, jobId, source, requiredCapabilities } = job;

    const loadCapabilities = async (): Promise<Record<string, unknown>> => {
      const caps: Record<string, unknown> = {};
      for (const cap of requiredCapabilities) {
        try {
          const records = await capabilityRepository.read(cap);
          caps[cap] = records
            .filter((r) => r.data !== null)
            .map((r) => ({
              providerId: r.providerId,
              accountId: r.accountId,
              state: r.state,
              updatedAt: r.updatedAt,
              data: r.data
            }));
        } catch {
          caps[cap] = [];
        }
      }
      return caps;
    };

    return {
      syncJobs: [
        {
          id: jobId,
          run: async () => {
            const capabilities = await loadCapabilities();
            return utilityRunner.run({
              pluginId,
              source,
              input: {},
              limits: sandboxLimits,
              capabilities
            });
          }
        }
      ]
    };
  };

  return { activate };
};
