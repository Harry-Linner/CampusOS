import { ipcMain } from "electron";
import { assertTrustedRenderer } from "./ipcSecurity";
import { getOfficialPluginRuntimeService } from "./officialPluginRuntimeService";

export interface HotReloadResult {
  pluginId: string;
  ok: boolean;
  status: string;
  issues: string[];
}

let isReloading = false;

export const reloadPlugin = async (pluginId: string): Promise<HotReloadResult> => {
  if (isReloading) {
    return { pluginId, ok: false, status: "busy", issues: ["已有插件重载正在进行中。"] };
  }

  isReloading = true;
  try {
    const service = getOfficialPluginRuntimeService();
    // Reload: re-load the snapshot and re-reconcile
    const snapshot = await service.load();
    const record = snapshot.plugins.find((p) => p.id === pluginId);
    if (!record) {
      return { pluginId, ok: false, status: "not-found", issues: [`未找到插件：${pluginId}`] };
    }

    // Toggle off then on to force reactivation
    await service.configure({ pluginId, enabled: false, grantedPermissions: record.grantedPermissions });
    const reEnabled = await service.configure({ pluginId, enabled: true, grantedPermissions: record.grantedPermissions });
    const updated = reEnabled.plugins.find((p) => p.id === pluginId);

    return {
      pluginId,
      ok: updated?.status === "active",
      status: updated?.status ?? "unknown",
      issues: updated?.issues ?? []
    };
  } catch (error) {
    return {
      pluginId,
      ok: false,
      status: "error",
      issues: [error instanceof Error ? error.message : "插件重载失败。"]
    };
  } finally {
    isReloading = false;
  }
};

export const registerPluginHotReloadHandlers = (): void => {
  ipcMain.handle("campusos:plugins:hot-reload", async (event, pluginId: string) => {
    assertTrustedRenderer(event);
    return reloadPlugin(pluginId);
  });
};
