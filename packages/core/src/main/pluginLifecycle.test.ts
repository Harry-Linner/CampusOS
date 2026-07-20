import { describe, expect, it, vi } from "vitest";
import type { PluginManifestV2 } from "@campusos/shared";
import { resolvePluginRuntime } from "./pluginRuntime";
import { createPluginLifecycleCoordinator } from "./pluginLifecycle";

const connectorManifest: PluginManifestV2 = {
  id: "org.campusos.test-connector",
  name: "test-connector",
  displayName: "测试连接器",
  version: "1.0.0",
  apiVersion: 2,
  kind: "connector",
  description: "验证主进程连接器生命周期。",
  icon: "Connector",
  permissions: [],
  sourceScope: ["test:source"],
  releaseStage: "ready",
  provides: ["test.data@1"],
  requires: [],
  optionalRequires: [],
  contributes: {
    syncJobs: ["test-refresh"]
  }
};

const createSnapshot = (enabled: boolean) =>
  resolvePluginRuntime({
    registrations: [
      {
        manifest: connectorManifest,
        enabled,
        grantedPermissions: []
      }
    ],
    coreCapabilities: []
  });

describe("plugin lifecycle coordinator", () => {
  it("activates a connector once and deactivates it when disabled", async () => {
    const deactivate = vi.fn(async () => undefined);
    const activate = vi.fn(async () => ({ deactivate }));
    const coordinator = createPluginLifecycleCoordinator({
      loaders: {
        [connectorManifest.id]: async () => ({
          manifest: connectorManifest,
          activate
        })
      }
    });

    const first = await coordinator.reconcile(createSnapshot(true));
    expect(first.plugins[0].status).toBe("active");
    expect(activate).toHaveBeenCalledTimes(1);

    await coordinator.reconcile(createSnapshot(true));
    expect(activate).toHaveBeenCalledTimes(1);

    const disabled = await coordinator.reconcile(createSnapshot(false));
    expect(disabled.plugins[0].status).toBe("disabled");
    expect(deactivate).toHaveBeenCalledTimes(1);
  });

  it("activates a headless feature only after its connector dependency", async () => {
    const activationOrder: string[] = [];
    const featureManifest: PluginManifestV2 = {
      ...connectorManifest,
      id: "org.campusos.test-feature",
      name: "test-feature",
      displayName: "测试功能插件",
      kind: "feature",
      provides: ["calendar.events@1"],
      requires: ["test.data@1"],
      contributes: { syncJobs: ["test-derived-events"] }
    };
    const snapshot = resolvePluginRuntime({
      registrations: [featureManifest, connectorManifest].map((manifest) => ({
        manifest,
        enabled: true,
        grantedPermissions: []
      })),
      coreCapabilities: []
    });
    const connectorDeactivate = vi.fn();
    const featureDeactivate = vi.fn();
    const coordinator = createPluginLifecycleCoordinator({
      loaders: {
        [featureManifest.id]: async () => ({
          manifest: featureManifest,
          activate: async () => {
            activationOrder.push("feature");
            return { deactivate: featureDeactivate };
          }
        }),
        [connectorManifest.id]: async () => ({
          manifest: connectorManifest,
          activate: async () => {
            activationOrder.push("connector");
            return { deactivate: connectorDeactivate };
          }
        })
      }
    });

    const reconciled = await coordinator.reconcile(snapshot);

    expect(activationOrder).toEqual(["connector", "feature"]);
    expect(reconciled.plugins.every((plugin) => plugin.status === "active")).toBe(
      true
    );

    await coordinator.shutdown();
    expect(connectorDeactivate).toHaveBeenCalledTimes(1);
    expect(featureDeactivate).toHaveBeenCalledTimes(1);
  });
});
