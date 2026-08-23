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

import { registerCampusFeedHandlers } from "./campusFeedIpc";
import type { CampusFeedService } from "./campusFeedService";

const snapshot = {
  sources: [],
  items: [],
  lastRefresh: {}
};

const service = {
  getSnapshot: vi.fn(async () => snapshot),
  refreshSource: vi.fn(async () => []),
  refreshAll: vi.fn(async () => undefined),
  updateSource: vi.fn(async (_id: string, patch: unknown) => ({ id: "s1", ...(patch as Record<string, unknown>) })),
  removeSource: vi.fn(async () => undefined),
  markRead: vi.fn(async () => undefined),
  openExternal: vi.fn(async () => "https://xgb.zju.edu.cn/a"),
  loadAiSettings: vi.fn(async () => null),
  saveAiSettings: vi.fn(async (input: unknown) => input),
  testAiConnection: vi.fn(async () => ({ ok: true, message: "连接成功。" })),
  extractScheduleCandidates: vi.fn(async () => []),
  createScheduleTasks: vi.fn(async () => ({ created: 1, deduplicated: 0 })),
  subscribe: vi.fn(() => () => undefined)
} as unknown as CampusFeedService;

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

describe("campusFeedIpc", () => {
  it("registers exactly the twelve formal channels", () => {
    process.env.ELECTRON_RENDERER_URL = "http://localhost:5173/";
    registerCampusFeedHandlers(service);
    expect([...electronState.handlers.keys()]).toEqual([
      "campusos:campus-feed:get",
      "campusos:campus-feed:refresh-source",
      "campusos:campus-feed:refresh-all",
      "campusos:campus-feed:update-source",
      "campusos:campus-feed:remove-source",
      "campusos:campus-feed:mark-read",
      "campusos:campus-feed:open-external",
      "campusos:campus-feed:ai-settings-load",
      "campusos:campus-feed:ai-settings-save",
      "campusos:campus-feed:ai-test",
      "campusos:campus-feed:ai-extract",
      "campusos:campus-feed:ai-create-tasks"
    ]);
  });

  it("forwards get / refresh / mark-read to the service", async () => {
    expect(await invoke("campusos:campus-feed:get")).toBe(snapshot);
    expect(await invoke("campusos:campus-feed:refresh-source", "s1")).toEqual([]);
    expect(service.refreshSource).toHaveBeenCalledWith("s1");
    await invoke("campusos:campus-feed:refresh-all");
    expect(service.refreshAll).toHaveBeenCalledTimes(1);
    await invoke("campusos:campus-feed:mark-read", ["a", "b"]);
    expect(service.markRead).toHaveBeenCalledWith(["a", "b"]);
  });

  it("opens a validated external URL through the shell", async () => {
    await invoke("campusos:campus-feed:open-external", "https://xgb.zju.edu.cn/a");
    expect(electronState.openedUrls).toEqual(["https://xgb.zju.edu.cn/a"]);
  });

  it("forwards AI settings / test / extract / create to the service", async () => {
    const settings = { provider: "deepseek", protocol: "openai-chat-completions", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", apiKeyConfigured: false };
    expect(await invoke("campusos:campus-feed:ai-settings-load")).toBeNull();
    expect(await invoke("campusos:campus-feed:ai-settings-save", settings)).toBe(settings);
    expect(service.saveAiSettings).toHaveBeenCalledWith(settings);
    await invoke("campusos:campus-feed:ai-test", settings);
    expect(service.testAiConnection).toHaveBeenCalledWith(settings);
    await invoke("campusos:campus-feed:ai-extract", ["item-1"]);
    expect(service.extractScheduleCandidates).toHaveBeenCalledWith(["item-1"]);
    await invoke("campusos:campus-feed:ai-create-tasks", []);
    expect(service.createScheduleTasks).toHaveBeenCalledWith([]);
  });

  it("rejects malformed arguments", async () => {
    await expect(invoke("campusos:campus-feed:refresh-source", 42))
      .rejects.toThrow(/订阅源 ID 无效/);
    await expect(invoke("campusos:campus-feed:update-source", { id: "", patch: {} }))
      .rejects.toThrow(/订阅源更新参数无效/);
    await expect(invoke("campusos:campus-feed:mark-read", "not-an-array"))
      .rejects.toThrow(/已读条目参数无效/);
  });
});
