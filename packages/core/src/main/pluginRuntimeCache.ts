import type { PluginRuntimeSnapshot } from "@campusos/shared";

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
