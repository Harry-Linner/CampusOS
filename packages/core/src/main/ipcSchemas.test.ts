import { describe, expect, it } from "vitest";
import {
  parseCapabilityReadInput,
  parsePluginConfigurationInput
} from "./ipcSchemas";

describe("ipcSchemas（schema 化 IPC 契约，fail closed）", () => {
  it("capability read：合法载荷通过", () => {
    const parsed = parseCapabilityReadInput({
      pluginId: "org.campusos.schedule",
      capability: "calendar.events@1"
    });
    expect(parsed).toEqual({
      pluginId: "org.campusos.schedule",
      capability: "calendar.events@1"
    });
  });

  it("capability read：非法载荷拒绝（fail closed）", () => {
    expect(
      parseCapabilityReadInput({
        pluginId: "org.campusos.schedule",
        capability: "not-a-capability"
      })
    ).toBeNull();
    expect(
      parseCapabilityReadInput({
        pluginId: "",
        capability: "calendar.events@1"
      })
    ).toBeNull();
    expect(parseCapabilityReadInput({ pluginId: "x", capability: 1 })).toBeNull();
    expect(parseCapabilityReadInput(null)).toBeNull();
    expect(
      parseCapabilityReadInput({
        pluginId: "org.campusos.schedule",
        capability: "calendar.events@1",
        extra: "unknown field 拒绝"
      })
    ).toBeNull();
  });

  it("插件配置：合法载荷通过，非法拒绝", () => {
    const parsed = parsePluginConfigurationInput({
      pluginId: "dev.example.countdown",
      enabled: true,
      grantedPermissions: ["storage:local"]
    });
    expect(parsed).toEqual({
      pluginId: "dev.example.countdown",
      enabled: true,
      grantedPermissions: ["storage:local"]
    });
    expect(
      parsePluginConfigurationInput({
        pluginId: "dev.example.countdown",
        enabled: "yes",
        grantedPermissions: []
      })
    ).toBeNull();
    expect(
      parsePluginConfigurationInput({
        pluginId: "bad id",
        enabled: true,
        grantedPermissions: []
      })
    ).toBeNull();
  });
});
