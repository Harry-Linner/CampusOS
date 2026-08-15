/* @vitest-environment jsdom */

import { createElement } from "react";
import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  PluginRuntimeSnapshot
} from "@campusos/shared";
import { manifest as academicManifest } from "@campusos/plugin-academic/manifest";
import type { LoadedPlugin } from "../lib/pluginHost";
import { usePluginHost } from "./usePluginHost";

const bridgeState = vi.hoisted(() => ({
  loadRuntime: vi.fn(),
  configure: vi.fn(),
  selectPackage: vi.fn(),
  discardPackage: vi.fn(),
  installPackage: vi.fn(),
  uninstallPackage: vi.fn(),
  loadPackages: vi.fn()
}));

vi.mock("../lib/pluginBridge", () => ({
  loadPluginRuntimeSnapshot: bridgeState.loadRuntime,
  configurePluginRuntime: bridgeState.configure,
  selectPluginPackage: bridgeState.selectPackage,
  discardPluginPackage: bridgeState.discardPackage,
  installPluginPackage: bridgeState.installPackage,
  uninstallPluginPackage: bridgeState.uninstallPackage,
  loadInstalledPluginPackages: bridgeState.loadPackages
}));

vi.mock("../lib/pluginHost", () => ({
  loadPlugins: async (snapshot: PluginRuntimeSnapshot) =>
    snapshot.plugins.map(
      (runtime): LoadedPlugin => ({
        manifest: runtime.manifest,
        runtime,
        capabilities: {
          read: async () => []
        }
      })
    )
}));

import type { PluginRuntimeRecord } from "@campusos/shared";

const runtime: PluginRuntimeRecord = {
  id: academicManifest.id,
  manifest: academicManifest,
  enabled: true,
  grantedPermissions: academicManifest.permissions,
  status: "active",
  bindings: {},
  issues: []
};

const snapshot: PluginRuntimeSnapshot = {
  apiVersion: 2,
  generatedAt: "2026-08-15T00:00:00.000Z",
  plugins: [runtime]
};

const renderHook = () => {
  let result: ReturnType<typeof usePluginHost> | undefined;
  const Component = (): JSX.Element => {
    result = usePluginHost();
    return createElement("div");
  };
  render(createElement(Component));
  return () => result!;
};

const loadHook = async (): Promise<ReturnType<typeof renderHook>> => {
  const readResult = renderHook();
  await act(async () => {
    await readResult().load();
  });
  return readResult;
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("usePluginHost", () => {
  it("loads the runtime snapshot and package registry on mount", async () => {
    bridgeState.loadRuntime.mockResolvedValue(snapshot);
    bridgeState.loadPackages.mockResolvedValue({ packages: [], issues: [] });
    const readResult = await loadHook();

    expect(readResult().ready).toBe(true);
    expect(readResult().plugins).toHaveLength(1);
    expect(readResult().plugins[0].runtime.id).toBe(academicManifest.id);
    expect(readResult().packageRegistry).toEqual({ packages: [], issues: [] });
    expect(readResult().loading).toBe(false);
    expect(readResult().error).toBeNull();
  });

  it("surfaces a load failure through error", async () => {
    bridgeState.loadRuntime.mockRejectedValue(new Error("运行时损坏"));
    bridgeState.loadPackages.mockResolvedValue({ packages: [], issues: [] });
    const readResult = await loadHook();

    expect(readResult().error).toBe("运行时损坏");
    expect(readResult().ready).toBe(false);
  });

  it("applies a fresh runtime snapshot via applyRuntimeSnapshot", async () => {
    bridgeState.loadRuntime.mockResolvedValue(snapshot);
    bridgeState.loadPackages.mockResolvedValue({ packages: [], issues: [] });
    const readResult = await loadHook();
    expect(readResult().ready).toBe(true);

    const next: PluginRuntimeSnapshot = {
      ...snapshot,
      plugins: []
    };
    await act(async () => {
      await readResult().applyRuntimeSnapshot(next);
    });
    expect(readResult().plugins).toHaveLength(0);
  });

  it("configures the runtime and applies the returned snapshot", async () => {
    bridgeState.loadRuntime.mockResolvedValue(snapshot);
    bridgeState.loadPackages.mockResolvedValue({ packages: [], issues: [] });
    const readResult = await loadHook();

    const configured: PluginRuntimeSnapshot = {
      ...snapshot,
      plugins: [{ ...runtime, enabled: false, status: "disabled" }]
    };
    bridgeState.configure.mockResolvedValue(configured);
    await act(async () => {
      await readResult().configure({
        pluginId: academicManifest.id,
        enabled: false,
        grantedPermissions: []
      });
    });
    expect(bridgeState.configure).toHaveBeenCalledWith({
      pluginId: academicManifest.id,
      enabled: false,
      grantedPermissions: []
    });
    expect(readResult().plugins[0].runtime.status).toBe("disabled");
    expect(readResult().loading).toBe(false);
  });

  it("rethrows configure failures after recording the error", async () => {
    bridgeState.loadRuntime.mockResolvedValue(snapshot);
    bridgeState.loadPackages.mockResolvedValue({ packages: [], issues: [] });
    const readResult = await loadHook();

    bridgeState.configure.mockRejectedValue(new Error("依赖缺失"));
    await act(async () => {
      await expect(
        readResult().configure({
          pluginId: academicManifest.id,
          enabled: true,
          grantedPermissions: []
        })
      ).rejects.toThrow("依赖缺失");
    });
    expect(readResult().error).toBe("依赖缺失");
  });

  it("selects a package and exposes its inspection result", async () => {
    bridgeState.loadRuntime.mockResolvedValue(snapshot);
    bridgeState.loadPackages.mockResolvedValue({ packages: [], issues: [] });
    bridgeState.selectPackage.mockResolvedValue({
      canceled: false,
      inspection: {
        token: "token-1",
        manifest: academicManifest,
        permissions: academicManifest.permissions
      }
    });
    const readResult = await loadHook();

    let inspection: unknown;
    await act(async () => {
      inspection = await readResult().selectPackage();
    });
    expect(inspection).toEqual({
      token: "token-1",
      manifest: academicManifest,
      permissions: academicManifest.permissions
    });
    expect(readResult().error).toBeNull();
  });

  it("records a package selection failure and rethrows", async () => {
    bridgeState.loadRuntime.mockResolvedValue(snapshot);
    bridgeState.loadPackages.mockResolvedValue({ packages: [], issues: [] });
    bridgeState.selectPackage.mockRejectedValue(new Error("读取失败"));
    const readResult = await loadHook();

    await act(async () => {
      await expect(readResult().selectPackage()).rejects.toThrow("读取失败");
    });
    expect(readResult().error).toBe("读取失败");
  });

  it("installs a package and refreshes runtime and registry", async () => {
    bridgeState.loadRuntime.mockResolvedValue(snapshot);
    bridgeState.loadPackages.mockResolvedValue({ packages: [], issues: [] });
    const readResult = await loadHook();

    const installed: PluginRuntimeSnapshot = {
      ...snapshot,
      plugins: [
        ...snapshot.plugins,
        { ...runtime, id: "org.example.hello-world" }
      ]
    };
    bridgeState.installPackage.mockResolvedValue({
      runtime: installed,
      registry: { packages: [{ id: "org.example.hello-world" }], issues: [] }
    });
    await act(async () => {
      await readResult().installPackage("token-1");
    });
    expect(readResult().plugins).toHaveLength(2);
    expect(readResult().packageRegistry.packages).toHaveLength(1);
  });

  it("records an install failure and rethrows", async () => {
    bridgeState.loadRuntime.mockResolvedValue(snapshot);
    bridgeState.loadPackages.mockResolvedValue({ packages: [], issues: [] });
    bridgeState.installPackage.mockRejectedValue(new Error("校验失败"));
    const readResult = await loadHook();

    await act(async () => {
      await expect(readResult().installPackage("token-1")).rejects.toThrow(
        "校验失败"
      );
    });
    expect(readResult().error).toBe("校验失败");
  });

  it("uninstalls a package and refreshes runtime and registry", async () => {
    bridgeState.loadRuntime.mockResolvedValue(snapshot);
    bridgeState.loadPackages.mockResolvedValue({ packages: [], issues: [] });
    const readResult = await loadHook();

    bridgeState.uninstallPackage.mockResolvedValue({
      runtime: { ...snapshot, plugins: [] },
      registry: { packages: [], issues: [] }
    });
    await act(async () => {
      await readResult().uninstallPackage(academicManifest.id);
    });
    expect(readResult().plugins).toHaveLength(0);
    expect(bridgeState.uninstallPackage).toHaveBeenCalledWith(
      academicManifest.id
    );
  });

  it("discards a pending package via the bridge", async () => {
    bridgeState.loadRuntime.mockResolvedValue(snapshot);
    bridgeState.loadPackages.mockResolvedValue({ packages: [], issues: [] });
    const readResult = await loadHook();

    await act(async () => {
      await readResult().discardPackage("token-1");
    });
    expect(bridgeState.discardPackage).toHaveBeenCalledWith("token-1");
  });
});
