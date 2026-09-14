import { describe, expect, it } from "vitest";
import {
  configurePluginRuntime,
  loadPluginRuntimeSnapshot,
  readPluginCapability
} from "./pluginBridge";

describe("plugin runtime bridge without Electron", () => {
  it("fails closed instead of fabricating activation state", async () => {
    await expect(loadPluginRuntimeSnapshot()).rejects.toThrow(
      "插件运行时仅能在 CampusOS 桌面应用中使用"
    );
    await expect(
      configurePluginRuntime({
        pluginId: "org.campusos.calendar-workspace",
        enabled: true,
        grantedPermissions: []
      })
    ).rejects.toThrow("插件运行时仅能在 CampusOS 桌面应用中使用");
    await expect(
      readPluginCapability(
        "org.campusos.academic-grades",
        "academic.grades@1"
      )
    ).rejects.toThrow("插件运行时仅能在 CampusOS 桌面应用中使用");
  });
});
