import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const send = vi.fn();
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
    quitAndInstall: vi.fn()
  };
  return { handlers, send, app, updater };
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
  }
}));

vi.mock("electron-updater", () => ({ autoUpdater: mocks.updater }));
vi.mock("./ipcSecurity", () => ({ assertTrustedRenderer: vi.fn() }));

import {
  checkForUpdates,
  downloadUpdate,
  getUpdateStatus,
  registerUpdateHandlers
} from "./autoUpdater";

describe("auto updater", () => {
  beforeEach(() => {
    mocks.app.isPackaged = false;
    mocks.handlers.clear();
    mocks.send.mockClear();
    mocks.updater.checkForUpdates.mockReset();
    mocks.updater.downloadUpdate.mockReset();
    mocks.updater.cancelDownload.mockReset();
    mocks.updater.quitAndInstall.mockReset();
    mocks.app.getPath.mockReturnValue(`/tmp/campusos-updater-${Date.now()}`);
  });

  it("reports development builds as unavailable without contacting a feed", async () => {
    expect(await checkForUpdates()).toEqual({ state: "unavailable" });
    expect(mocks.updater.checkForUpdates).not.toHaveBeenCalled();
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
      prompt: true
    });
    expect(mocks.updater.autoDownload).toBe(false);
    expect(await downloadUpdate()).toEqual({
      state: "ready",
      version: "0.2.0",
      progress: 100
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
