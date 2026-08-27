import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electronState = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  userDataPath: ""
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
  Notification: {
    isSupported: vi.fn(() => false)
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true)
  }
}));

import {
  addNotification,
  readNotificationRecords,
  registerNotificationHandlers
} from "./notificationCenter";

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

    const cleared = await invoke("campusos:notifications:clear-all");
    expect(cleared).toEqual([]);
    expect(await readNotificationRecords()).toEqual([]);
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
});
