import { describe, expect, it, vi } from "vitest";

const electronState = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  openedUrls: [] as string[]
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "unused")
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      electronState.handlers.set(channel, handler);
    })
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true)
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => [])
  },
  shell: {
    openExternal: vi.fn(async (url: string) => {
      electronState.openedUrls.push(url);
    })
  }
}));

import { registerBriefHandlers } from "./briefIpc";
import type { BriefService } from "./briefService";

const state = {
  status: "idle",
  snapshot: null,
  error: null
};

const service = {
  getState: vi.fn(async () => state),
  refresh: vi.fn(async () => state),
  openExternal: vi.fn(async () => "https://example.com/a"),
  loadSettings: vi.fn(async () => ({ interests: [], sourceEnabled: {}, savedAt: null })),
  saveSettings: vi.fn(async (input: unknown) => input),
  subscribe: vi.fn(() => () => undefined)
} as unknown as BriefService;

const trustedEvent = (): {
  senderFrame: { url: string };
  sender: { mainFrame: unknown };
} => {
  const frame = { url: "http://localhost:5173/" };
  return { senderFrame: frame, sender: { mainFrame: frame } };
};

const invoke = async <T>(channel: string, ...args: unknown[]): Promise<T> => {
  const handler = electronState.handlers.get(channel);
  if (!handler) throw new Error(`missing handler: ${channel}`);
  return await handler(trustedEvent(), ...args) as T;
};

describe("briefIpc", () => {
  it("registers exactly the five formal channels", () => {
    process.env.ELECTRON_RENDERER_URL = "http://localhost:5173/";
    registerBriefHandlers(service);
    expect([...electronState.handlers.keys()]).toEqual([
      "campusos:brief:get",
      "campusos:brief:refresh",
      "campusos:brief:open-external",
      "campusos:brief:settings:load",
      "campusos:brief:settings:save"
    ]);
    delete process.env.ELECTRON_RENDERER_URL;
  });

  it("passes through state, refresh and settings calls", async () => {
    process.env.ELECTRON_RENDERER_URL = "http://localhost:5173/";
    registerBriefHandlers(service);
    expect(await invoke("campusos:brief:get")).toBe(state);
    await invoke("campusos:brief:refresh");
    expect(service.refresh).toHaveBeenCalledOnce();
    const profile = await invoke("campusos:brief:settings:save", { interests: [], sourceEnabled: {} });
    expect(profile).toMatchObject({ interests: [] });
    delete process.env.ELECTRON_RENDERER_URL;
  });

  it("opens external links only through the service-resolved url", async () => {
    process.env.ELECTRON_RENDERER_URL = "http://localhost:5173/";
    registerBriefHandlers(service);
    await invoke("campusos:brief:open-external", "fp-a");
    expect(service.openExternal).toHaveBeenCalledWith("fp-a");
    expect(electronState.openedUrls).toEqual(["https://example.com/a"]);
    delete process.env.ELECTRON_RENDERER_URL;
  });

  it("rejects requests from an untrusted frame", async () => {
    process.env.ELECTRON_RENDERER_URL = "http://localhost:5173/";
    registerBriefHandlers(service);
    const handler = electronState.handlers.get("campusos:brief:get")!;
    const evilFrame = { url: "https://evil.example/" };
    await expect(handler({ senderFrame: evilFrame, sender: { mainFrame: evilFrame } }))
      .rejects.toThrow(/untrusted/);
    delete process.env.ELECTRON_RENDERER_URL;
  });
});
