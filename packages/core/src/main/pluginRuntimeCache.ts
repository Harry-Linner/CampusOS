import type {
  PluginCapability,
  PluginManifestV2,
  PluginRuntimeSnapshot
} from "@campusos/shared";
import { resolvePluginRuntime } from "./pluginRuntime";

const PENDING_PACKAGE_VALIDATION_ISSUE = "第三方插件正在后台重新校验。";

export const preparePluginRuntimeStartupCache = (
  snapshot: PluginRuntimeSnapshot,
  trustedPluginIds: ReadonlySet<string>
): PluginRuntimeSnapshot => ({
  ...snapshot,
  plugins: snapshot.plugins.map((plugin) => {
    if (plugin.status !== "active" || trustedPluginIds.has(plugin.id)) {
      return plugin;
    }
    return {
      ...plugin,
      status: "blocked",
      issues: [...new Set([...plugin.issues, PENDING_PACKAGE_VALIDATION_ISSUE])]
    };
  })
});

/**
 * Makes a startup cache usable even after an upgrade added new official
 * plugins (e.g. campus-feed). Instead of discarding the cache and forcing a
 * full (slow) runtime load, plugins missing from the cache are appended with
 * their default configuration — official plugins are enabled by default — and
 * the whole set is re-resolved through the formal runtime rules. This lets a
 * newly added plugin appear in the sidebar immediately on first launch after
 * the upgrade without waiting for the background full load to finish.
 */
export const augmentStartupCacheWithOfficialPlugins = (
  snapshot: PluginRuntimeSnapshot,
  trustedPluginIds: ReadonlySet<string>,
  officialManifests: readonly PluginManifestV2[],
  coreCapabilities: readonly PluginCapability[]
): PluginRuntimeSnapshot => {
  const cachedIds = new Set(snapshot.plugins.map((plugin) => plugin.id));
  const missingOfficial = officialManifests.filter(
    (manifest) => !cachedIds.has(manifest.id)
  );
  if (missingOfficial.length === 0) {
    return preparePluginRuntimeStartupCache(snapshot, trustedPluginIds);
  }
  const augmented = resolvePluginRuntime({
    coreCapabilities: [...coreCapabilities],
    registrations: [
      ...snapshot.plugins.map((plugin) => ({
        manifest: plugin.manifest,
        enabled: plugin.enabled,
        grantedPermissions: plugin.grantedPermissions
      })),
      ...missingOfficial.map((manifest) => ({
        manifest,
        enabled: manifest.releaseStage === "ready" && trustedPluginIds.has(manifest.id),
        grantedPermissions: [...manifest.permissions]
      }))
    ]
  });
  return preparePluginRuntimeStartupCache(augmented, trustedPluginIds);
};
