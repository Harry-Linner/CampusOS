import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const send = vi.fn();
  const netFetch = vi.fn();
  const app = {
    isPackaged: false,
    getName: vi.fn(() => "CampusOS"),
    getVersion: vi.fn(() => "0.1.0"),
    getPath: vi.fn(() => "/tmp/campusos-updater")
  };
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const updater = {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    on: (event: string, listener: (...args: unknown[]) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return updater;
    },
    emit: (event: string, ...args: unknown[]) => {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
    checkForUpdates: vi.fn(async () => undefined),
    downloadUpdate: vi.fn(async () => undefined),
    cancelDownload: vi.fn(),
    quitAndInstall: vi.fn(),
    setFeedURL: vi.fn()
  };
  return { handlers, send, app, updater, netFetch };
});

vi.mock("electron", () => ({
  app: mocks.app,
  BrowserWindow: {
    getAllWindows: () => [
      { isDestroyed: () => false, webContents: { send: mocks.send } }
    ]
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler);
    }
  },
  net: { fetch: mocks.netFetch }
}));

vi.mock("electron-updater", () => ({ autoUpdater: mocks.updater }));
vi.mock("./ipcSecurity", () => ({ assertTrustedRenderer: vi.fn() }));

import {
  checkForUpdates,
  downloadUpdate,
  getUpdateStatus,
  registerUpdateHandlers,
  resolveAutoUpdater,
  extractLatestReleaseTag,
  shouldTryGitHubFastFallback
} from "./autoUpdater";

describe("auto updater", () => {
  beforeEach(async () => {
    mocks.app.isPackaged = false;
    mocks.handlers.clear();
    mocks.send.mockClear();
    mocks.updater.checkForUpdates.mockReset();
    mocks.updater.downloadUpdate.mockReset();
    mocks.updater.cancelDownload.mockReset();
    mocks.updater.quitAndInstall.mockReset();
    mocks.updater.setFeedURL.mockReset();
    mocks.netFetch.mockReset();
    mocks.app.getPath.mockReturnValue(`/tmp/campusos-updater-${Date.now()}`);
    await checkForUpdates();
  });

  it("reports development builds as unavailable without contacting a feed", async () => {
    expect(await checkForUpdates()).toEqual({ state: "unavailable" });
    expect(mocks.updater.checkForUpdates).not.toHaveBeenCalled();
  });

  it("resolves the CommonJS default export shape produced in packaged builds", () => {
    expect(resolveAutoUpdater({
      default: { autoUpdater: mocks.updater as never }
    })).toBe(mocks.updater);
  });

  it("accepts only the expected CampusOS release link from the mirrored Atom feed", () => {
    expect(extractLatestReleaseTag('<link href="https://github.com/Harry-Linner/CampusOS/releases/tag/v0.1.0-beta.9"/>')).toBe("v0.1.0-beta.9");
    expect(extractLatestReleaseTag('<link href="https://githubfast.com/Harry-Linner/CampusOS/releases/tag/v0.1.0-beta.9"/>')).toBe("v0.1.0-beta.9");
    expect(() => extractLatestReleaseTag('<link href="https://github.com/other/repo/releases/tag/v9.9.9"/>')).toThrow();
  });

  it("uses GitHubFast only after a GitHub connectivity failure", async () => {
    mocks.app.isPackaged = true;
    mocks.netFetch.mockResolvedValue(new Response(
      '<link href="https://github.com/Harry-Linner/CampusOS/releases/tag/v0.1.0-beta.9"/>',
      { status: 200 }
    ));
    mocks.updater.checkForUpdates
      .mockRejectedValueOnce(new Error("getaddrinfo ENOTFOUND github.com"))
      .mockImplementationOnce(async () => {
        mocks.updater.emit("update-available", { version: "0.1.0-beta.9" });
      });

    await expect(checkForUpdates()).resolves.toEqual({
      state: "available",
      version: "0.1.0-beta.9",
      prompt: true,
      source: "githubfast"
    });
    expect(mocks.netFetch).toHaveBeenCalledWith(
      "https://githubfast.com/Harry-Linner/CampusOS/releases.atom",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(mocks.updater.setFeedURL).toHaveBeenLastCalledWith({
      provider: "generic",
      channel: "latest",
      url: "https://githubfast.com/Harry-Linner/CampusOS/releases/download/v0.1.0-beta.9/"
    });
    mocks.updater.downloadUpdate.mockImplementationOnce(async () => {
      mocks.updater.emit("download-progress", { percent: 64 });
      mocks.updater.emit("update-downloaded", { version: "0.1.0-beta.9" });
    });
    await expect(downloadUpdate()).resolves.toMatchObject({
      state: "ready",
      version: "0.1.0-beta.9",
      source: "githubfast"
    });
  });

  it("does not switch mirrors for a malformed release response", () => {
    expect(shouldTryGitHubFastFallback(new Error("Cannot parse latest.yml from github.com"))).toBe(false);
  });

  it("reports when both GitHub and the mirror are unavailable", async () => {
    mocks.app.isPackaged = true;
    mocks.updater.checkForUpdates.mockRejectedValueOnce(
      new Error("net::ERR_NAME_NOT_RESOLVED at github.com")
    );
    mocks.netFetch.mockResolvedValue(new Response("Forbidden", { status: 403 }));

    await expect(checkForUpdates()).resolves.toEqual({
      state: "error",
      error: "GitHub 与 GitHubFast 镜像均无法连接，请稍后重试。",
      source: "githubfast"
    });
  });

  it("binds updater events and exposes the real available/download states", async () => {
    mocks.app.isPackaged = true;
    mocks.updater.checkForUpdates.mockImplementation(async () => {
      mocks.updater.emit("update-available", { version: "0.2.0" });
      return undefined;
    });
    mocks.updater.downloadUpdate.mockImplementation(async () => {
      mocks.updater.emit("download-progress", { percent: 42.4 });
      mocks.updater.emit("update-downloaded", { version: "0.2.0" });
      return undefined;
    });

    expect(await checkForUpdates()).toEqual({
      state: "available",
      version: "0.2.0",
      prompt: true,
      source: "github"
    });
    expect(mocks.updater.autoDownload).toBe(false);
    expect(await downloadUpdate()).toEqual({
      state: "ready",
      version: "0.2.0",
      progress: 100,
      prompt: true,
      source: "github"
    });
    expect(mocks.send).toHaveBeenCalledWith(
      "campusos:updater:changed",
      expect.objectContaining({ state: "ready" })
    );
  });

  it("persists a dismissed version and suppresses its next prompt", async () => {
    mocks.app.isPackaged = true;
    mocks.app.getPath.mockReturnValue(`/tmp/campusos-updater-dismiss-${Date.now()}`);
    mocks.updater.checkForUpdates.mockImplementation(async () => {
      mocks.updater.emit("update-available", { version: "0.3.0" });
    });
    await checkForUpdates();
    const { dismissUpdate } = await import("./autoUpdater");
    await expect(dismissUpdate("0.3.0")).resolves.toMatchObject({ prompt: false });
    expect(getUpdateStatus()).toMatchObject({ version: "0.3.0", prompt: false });
  });

  it("registers trusted IPC endpoints for app metadata and update status", async () => {
    registerUpdateHandlers();
    expect([...mocks.handlers.keys()]).toEqual([
      "campusos:app:info",
      "campusos:updater:check",
      "campusos:updater:download",
      "campusos:updater:cancel",
      "campusos:updater:dismiss",
      "campusos:updater:install",
      "campusos:updater:status"
    ]);
    const appInfo = await mocks.handlers.get("campusos:app:info")?.({});
    expect(appInfo).toMatchObject({
      name: "CampusOS",
      version: "0.1.0",
      licenseName: "MIT"
    });
    expect(getUpdateStatus()).toBeDefined();
  });
});
