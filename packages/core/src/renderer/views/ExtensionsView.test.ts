/* @vitest-environment jsdom */

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { manifest as calendarManifest } from "@campusos/plugin-calendar/manifest";
import type {
  PluginPackageInspection,
  PluginPackageRegistrySnapshot
} from "../../shared/pluginBridge";
import type { LoadedPlugin } from "../lib/pluginHost";
import { ExtensionsView } from "./ExtensionsView";

afterEach(cleanup);

const blockedCalendar: LoadedPlugin = {
  manifest: calendarManifest,
  Component: () => createElement("div"),
  capabilities: {
    read: async () => []
  },
  runtime: {
    id: calendarManifest.id,
    manifest: calendarManifest,
    enabled: true,
    grantedPermissions: [],
    status: "blocked",
    bindings: {},
    issues: calendarManifest.permissions.map(
      (permission) => `权限未授权：${permission}`
    )
  }
};

const emptyPackageRegistry: PluginPackageRegistrySnapshot = {
  packages: [],
  issues: []
};

const createProps = () => ({
  plugins: [blockedCalendar],
  loading: false,
  error: null,
  packageRegistry: emptyPackageRegistry,
  onConfigure: vi.fn(async () => undefined),
  onSelectPackage: vi.fn(async () => null),
  onDiscardPackage: vi.fn(async () => undefined),
  onInstallPackage: vi.fn(async () => undefined),
  onUninstallPackage: vi.fn(async () => undefined)
});

describe("ExtensionsView", () => {
  it("submits only permissions explicitly selected by the user", async () => {
    const configure = vi.fn(async () => undefined);
    render(
      createElement(ExtensionsView, {
        ...createProps(),
        onConfigure: configure
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "详情" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "日历领域数据" }));
    fireEvent.click(screen.getByRole("button", { name: "保存并启用" }));

    await waitFor(() => {
      expect(configure).toHaveBeenCalledWith({
        pluginId: calendarManifest.id,
        enabled: true,
        grantedPermissions: ["storage:domain:calendar"]
      });
    });
  });

  it("reviews an unsigned package and requires explicit confirmation before install", async () => {
    const inspection: PluginPackageInspection = {
      token: "58ac2bea-45ab-497e-85e5-1856063b674d",
      manifest: {
        ...calendarManifest,
        id: "dev.example.countdown",
        name: "countdown",
        displayName: "考试倒计时",
        permissions: ["storage:local"],
        requires: [],
        optionalRequires: []
      },
      entrypoints: { renderer: "dist/renderer.js" },
      archiveSize: 2048,
      unpackedSize: 4096,
      fileCount: 3,
      sha256: "a".repeat(64),
      signatureStatus: "unsigned"
    };
    const installPackage = vi.fn(async () => undefined);
    render(
      createElement(ExtensionsView, {
        ...createProps(),
        onSelectPackage: vi.fn(async () => inspection),
        onInstallPackage: installPackage
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "从文件安装" }));

    expect(await screen.findByRole("region", { name: "插件安装确认" })).toBeTruthy();
    expect(screen.getByText("未签名")).toBeTruthy();
    expect(screen.getByText("插件隔离本地存储")).toBeTruthy();
    expect(installPackage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "确认安装" }));
    await waitFor(() => {
      expect(installPackage).toHaveBeenCalledWith(inspection.token);
    });
  });

  it("grants and enables only an eligible installed sandbox view", async () => {
    const manifest = {
      ...calendarManifest,
      id: "dev.example.countdown",
      name: "countdown",
      displayName: "考试倒计时",
      permissions: ["storage:local" as const],
      provides: [],
      requires: [],
      optionalRequires: [],
      contributes: {
        views: [{
          id: "countdown-main",
          title: "倒计时",
          icon: "Clock",
          location: "activity" as const,
          activityTarget: "mod-dev-example-countdown"
        }]
      }
    };
    const plugin: LoadedPlugin = {
      manifest,
      runtime: {
        id: manifest.id,
        manifest,
        enabled: false,
        grantedPermissions: [],
        status: "disabled",
        bindings: {},
        issues: []
      },
      capabilities: { read: async () => [] }
    };
    const configure = vi.fn(async () => undefined);
    render(createElement(ExtensionsView, {
      ...createProps(),
      plugins: [plugin],
      packageRegistry: {
        packages: [{
          manifest,
          entrypoints: { renderer: "dist/renderer.js" },
          archiveSize: 2048,
          unpackedSize: 4096,
          fileCount: 2,
          sha256: "a".repeat(64),
          signatureStatus: "unsigned",
          installedAt: "2026-07-19T00:00:00.000Z",
          sourceFilename: "countdown.campusmod"
        }],
        issues: []
      },
      onConfigure: configure
    }));

    fireEvent.click(screen.getByRole("button", { name: "详情" }));
    fireEvent.click(screen.getByRole("checkbox", {
      name: "插件隔离本地存储"
    }));
    fireEvent.click(screen.getByRole("button", {
      name: "保存并启用沙箱视图"
    }));

    await waitFor(() => {
      expect(configure).toHaveBeenCalledWith({
        pluginId: manifest.id,
        enabled: true,
        grantedPermissions: ["storage:local"]
      });
    });
  });
});
