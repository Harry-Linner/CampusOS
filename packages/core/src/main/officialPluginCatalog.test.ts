import { describe, expect, it } from "vitest";
import { resolvePluginRuntime } from "./pluginRuntime";
import {
  corePluginCapabilities,
  officialCoreModuleManifests,
  officialRuntimeManifests,
  officialUserPluginManifests,
  toUserPluginSnapshot
} from "./officialPluginCatalog";

describe("officialPluginCatalog", () => {
  it("keeps Core Adapters out of the user plugin Interface", () => {
    const internal = resolvePluginRuntime({
      registrations: officialRuntimeManifests.map((manifest) => ({
        manifest,
        enabled: true,
        grantedPermissions: [...manifest.permissions]
      })),
      coreCapabilities: corePluginCapabilities
    });
    const visible = toUserPluginSnapshot(internal);

    expect(visible.plugins.map((plugin) => plugin.id)).toEqual(
      officialUserPluginManifests.map((manifest) => manifest.id)
    );
    expect(visible.plugins).toHaveLength(6);
    expect(visible.plugins.every(
      (plugin) => (plugin.manifest.contributes.views?.length ?? 0) === 1
    )).toBe(true);
    expect(visible.plugins.some((plugin) =>
      officialCoreModuleManifests.some((module) => module.id === plugin.id)
    )).toBe(false);
  });
});
