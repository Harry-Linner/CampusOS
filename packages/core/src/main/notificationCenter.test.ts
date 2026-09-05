import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electronState = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  userDataPath: "",
  notifications: [] as Array<{ handlers: Map<string, () => void>; show: ReturnType<typeof vi.fn> }>,
  navigate: vi.fn()
}));

vi.mock("./appLifecycle", () => ({
  getAppLifecycleSettings: vi.fn(async () => ({ notificationEnabled: true })),
  navigateCampusMainWindow: electronState.navigate
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => electronState.userDataPath),
    setLoginItemSettings: vi.fn(),
    getLoginItemSettings: vi.fn(() => ({ openAtLogin: false }))
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      electronState.handlers.set(channel, handler);
    })
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => [])
  },
  Notification: class {
    static isSupported = vi.fn(() => true);
    handlers = new Map<string, () => void>();
    show = vi.fn();
    constructor() { electronState.notifications.push(this); }
    on(event: string, handler: () => void): void { this.handlers.set(event, handler); }
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true)
  }
}));

import {
  addNotification,
  readNotificationRecords,
  registerNotificationHandlers,
  restoreNotificationRecords
} from "./notificationCenter";
import type { NotificationRecord } from "../shared/notificationBridge";

const temporaryDirectories: string[] = [];

const trustedEvent = (): { senderFrame: { url: string }; sender: { mainFrame: unknown } } => {
  const frame = { url: "http://localhost:5173/" };
  return { senderFrame: frame, sender: { mainFrame: frame } };
};

const invoke = async <T>(channel: string, ...args: unknown[]): Promise<T> => {
  const handler = electronState.handlers.get(channel);
  if (!handler) throw new Error(`missing handler: ${channel}`);
  return await handler(trustedEvent(), ...args) as T;
};

beforeEach(async () => {
  const root = await mkdtemp(join(process.env.TEMP ?? process.cwd(), "campusos-notifications-ipc-"));
  temporaryDirectories.push(root);
  electronState.userDataPath = root;
  electronState.handlers.clear();
  electronState.notifications.length = 0;
  electronState.navigate.mockClear();
  process.env.ELECTRON_RENDERER_URL = "http://localhost:5173/";
  registerNotificationHandlers();
});

afterEach(async () => {
  delete process.env.ELECTRON_RENDERER_URL;
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("Notification IPC", () => {
  it("registers the extended notification channels", () => {
    expect([...electronState.handlers.keys()]).toEqual([
      "campusos:notifications:load",
      "campusos:notifications:read",
      "campusos:notifications:unread",
      "campusos:notifications:handled",
      "campusos:notifications:read-all",
      "campusos:notifications:batch",
      "campusos:notifications:clear-expired",
      "campusos:notifications:clear-all"
    ]);
  });

  it("marks all read, batches states, and clears all", async () => {
    const first = await addNotification({ kind: "system", title: "a", body: "1", showDesktop: false });
    const second = await addNotification({ kind: "system", title: "b", body: "2", showDesktop: false });

    const allRead = await invoke<Array<{ state: string }>>("campusos:notifications:read-all");
    expect(allRead.every((entry) => entry.state === "read")).toBe(true);

    const batched = await invoke<Array<{ id: string; state: string }>>("campusos:notifications:batch", { ids: [first.id], state: "unread" });
    expect(batched.find((entry) => entry.id === first.id)?.state).toBe("unread");
    expect(batched.find((entry) => entry.id === second.id)?.state).toBe("read");

    const cleared = await invoke<Array<{ state: string }>>("campusos:notifications:clear-all");
    expect(cleared.every((entry) => entry.state === "handled")).toBe(true);
    expect((await readNotificationRecords()).every((entry) => entry.state === "handled")).toBe(true);
  });

  it("rejects an untrusted renderer on the batch channel", async () => {
    const handler = electronState.handlers.get("campusos:notifications:batch");
    const frame = { url: "https://evil.example/" };
    await expect(
      handler?.({ senderFrame: frame, sender: { mainFrame: frame } }, { ids: [], state: "read" })
    ).rejects.toThrow("untrusted origin");
  });

  it("rejects invalid batch payloads", async () => {
    await expect(invoke("campusos:notifications:batch", { ids: "nope", state: "read" })).rejects.toThrow("参数无效");
    await expect(invoke("campusos:notifications:batch", { ids: [], state: "bogus" })).rejects.toThrow("参数无效");
  });

  it("keeps at most 500 records and protects unread entries before read history", async () => {
    const makeRecord = (index: number, state: "unread" | "read"): NotificationRecord => ({
      id: `record-${index}`,
      kind: "system",
      title: `通知 ${index}`,
      body: "正文",
      state,
      createdAt: new Date(Date.UTC(2026, 7, 1, 0, index % 60, index)).toISOString(),
      expiresAt: new Date(Date.UTC(2027, 7, 1)).toISOString(),
      actionTarget: null,
      source: "system"
    });
    const incoming = [makeRecord(1000, "unread"), makeRecord(1001, "unread")];
    for (let index = 0; index < 500; index += 1) incoming.push(makeRecord(index, "read"));

    const restored = await restoreNotificationRecords(incoming, "replace");
    expect(restored).toHaveLength(500);
    expect(restored.filter((entry) => entry.state === "unread").map((entry) => entry.id)).toEqual(["record-1001", "record-1000"]);
  });

  it("opens the target and marks a persistent notification read when its native toast is clicked", async () => {
    const added = await addNotification({
      id: "click-target",
      kind: "feed",
      title: "校园资讯",
      body: "一条新资讯",
      source: "campus-feed",
      actionTarget: { viewId: "campus-feed", entityId: "feed-1" }
    });
    expect(added.state).toBe("unread");
    expect(electronState.notifications).toHaveLength(1);

    electronState.notifications[0].handlers.get("click")?.();
    expect(electronState.navigate).toHaveBeenCalledWith({ viewId: "campus-feed", entityId: "feed-1" });
    await vi.waitFor(async () => {
      expect((await readNotificationRecords()).find((entry) => entry.id === added.id)?.state).toBe("read");
    });
  });
});
