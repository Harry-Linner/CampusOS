import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginRuntimeSnapshot } from "@campusos/shared";

const state = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  send: vi.fn(),
  loadCached: vi.fn(),
  load: vi.fn(),
  configure: vi.fn(),
  installPackage: vi.fn(),
  uninstallPackage: vi.fn()
}));

vi.mock("electron", () => ({
  app: { once: vi.fn() },
  BrowserWindow: {
    getAllWindows: vi.fn(() => [{ isDestroyed: () => false, webContents: { send: state.send } }])
  },
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      state.handlers.set(channel, handler);
    })
  }
}));

vi.mock("./academicCredentialStore", () => ({
  readAcademicCredentialRecord: vi.fn(async () => ({ verificationState: "unverified" }))
}));

vi.mock("./officialCapabilityRepository", () => ({
  getOfficialCapabilityRepository: vi.fn(() => ({ read: vi.fn(async () => []) }))
}));

vi.mock("./pluginCapabilityAccess", () => ({
  createPluginCapabilityAccess: vi.fn(() => ({ read: vi.fn(async () => []) }))
}));

vi.mock("./officialPluginRuntimeService", () => ({
  getOfficialPluginRuntimeService: vi.fn(() => ({
    loadCached: state.loadCached,
    load: state.load,
    loadInternal: vi.fn(),
    configure: state.configure,
    inspectPackage: vi.fn(),
    discardPackageInspection: vi.fn(),
    installPackage: state.installPackage,
    loadPackages: vi.fn(async () => ({ packages: [], issues: [] })),
    readPackageFile: vi.fn(),
    uninstallPackage: state.uninstallPackage,
    shutdown: vi.fn()
  }))
}));

import { registerPluginRuntimeHandlers } from "./pluginRuntimeIpc";

const cachedSnapshot: PluginRuntimeSnapshot = {
  apiVersion: 2,
  generatedAt: "2026-08-07T00:00:00.000Z",
  plugins: []
};

const freshSnapshot: PluginRuntimeSnapshot = {
  ...cachedSnapshot,
  generatedAt: "2026-08-08T00:00:00.000Z"
};

const trustedEvent = (): {
  senderFrame: { url: string };
  sender: { mainFrame: unknown };
} => {
  const frame = { url: "http://localhost:5173/" };
  return { senderFrame: frame, sender: { mainFrame: frame } };
};

const invoke = async <T>(channel: string, ...args: unknown[]): Promise<T> => {
  const handler = state.handlers.get(channel);
  if (!handler) throw new Error(`missing handler: ${channel}`);
  return await handler(trustedEvent(), ...args) as T;
};

beforeEach(() => {
  process.env.ELECTRON_RENDERER_URL = "http://localhost:5173/";
  state.handlers.clear();
  state.send.mockReset();
  state.loadCached.mockReset();
  state.load.mockReset();
  registerPluginRuntimeHandlers();
});

afterEach(() => {
  delete process.env.ELECTRON_RENDERER_URL;
});

describe("plugin runtime startup cache", () => {
  it("returns the previous snapshot immediately and announces the background refresh", async () => {
    let resolveFresh: ((snapshot: PluginRuntimeSnapshot) => void) | undefined;
    state.loadCached.mockResolvedValue(cachedSnapshot);
    state.load.mockImplementationOnce(() => new Promise<PluginRuntimeSnapshot>((resolve) => {
      resolveFresh = resolve;
    }));

    await expect(invoke("campusos:plugins:load")).resolves.toEqual(cachedSnapshot);
    expect(state.send).not.toHaveBeenCalled();

    resolveFresh?.(freshSnapshot);
    await vi.waitFor(() => expect(state.send).toHaveBeenCalledWith("campusos:plugins:changed", freshSnapshot));
  });

  it("uses a fresh runtime load after the one-time startup cache path", async () => {
    state.loadCached.mockResolvedValue(cachedSnapshot);
    state.load.mockResolvedValue(freshSnapshot);

    await expect(invoke("campusos:plugins:load")).resolves.toEqual(cachedSnapshot);
    await vi.waitFor(() => expect(state.send).toHaveBeenCalled());
    await expect(invoke("campusos:plugins:load")).resolves.toEqual(freshSnapshot);
    expect(state.loadCached).toHaveBeenCalledTimes(1);
  });
});
