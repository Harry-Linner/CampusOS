import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CampusDownloadTask } from "@campusos/shared";
import type { NotificationKind, NotificationRecord } from "../shared/notificationBridge";

const electronState = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  openPath: vi.fn(async () => ""),
  showItemInFolder: vi.fn()
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => process.cwd())
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => [])
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      electronState.handlers.set(channel, handler);
    })
  },
  shell: {
    openPath: electronState.openPath,
    showItemInFolder: electronState.showItemInFolder
  }
}));

import {
  createDownloadCompletionTracker,
  registerDownloadHandlers
} from "./downloadIpc";

const readyTask: CampusDownloadTask = {
  id: "ready-download",
  title: "completed.pdf",
  courseName: "Software Engineering",
  sourceId: "learning-platform",
  progress: 100,
  status: "ready",
  targetPath: "D:\\CampusOS\\completed.pdf"
};

const failedTask: CampusDownloadTask = {
  ...readyTask,
  id: "failed-download",
  progress: 0,
  status: "failed"
};

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

describe("download IPC", () => {
  const summary = [readyTask, failedTask];
  const engine = {
    getSummary: vi.fn(() => summary),
    enqueue: vi.fn(async () => ({ id: readyTask.id })),
    pause: vi.fn(async () => true),
    resume: vi.fn(async () => true),
    cancel: vi.fn(async () => true),
    clearAll: vi.fn(async () => 2)
  };

  beforeEach(() => {
    process.env.ELECTRON_RENDERER_URL = "http://localhost:5173/";
    electronState.handlers.clear();
    electronState.openPath.mockReset();
    electronState.openPath.mockResolvedValue("");
    electronState.showItemInFolder.mockReset();
    registerDownloadHandlers({
      loadEngine: async () => engine,
      openPath: electronState.openPath,
      showItemInFolder: electronState.showItemInFolder
    });
  });

  afterEach(() => {
    delete process.env.ELECTRON_RENDERER_URL;
  });

  it("opens and reveals a completed task without accepting a renderer path", async () => {
    await invoke<void>("campusos:downloads:open", readyTask.id);
    await invoke<void>("campusos:downloads:reveal", readyTask.id);

    expect(electronState.openPath).toHaveBeenCalledWith(readyTask.targetPath);
    expect(electronState.showItemInFolder).toHaveBeenCalledWith(
      readyTask.targetPath
    );
  });

  it("clears the full queue through the trusted IPC handler", async () => {
    await expect(invoke<number>("campusos:downloads:clear-all")).resolves.toBe(2);
    expect(engine.clearAll).toHaveBeenCalledTimes(1);
  });

  it("rejects unfinished, unknown, and OS-rejected open requests", async () => {
    await expect(
      invoke("campusos:downloads:open", failedTask.id)
    ).rejects.toThrow("下载完成后才能打开文件");
    await expect(
      invoke("campusos:downloads:reveal", "D:\\arbitrary-file.txt")
    ).rejects.toThrow();

    electronState.openPath.mockResolvedValueOnce("No associated application");
    await expect(
      invoke("campusos:downloads:open", readyTask.id)
    ).rejects.toThrow("系统无法打开该文件");
    expect(electronState.showItemInFolder).not.toHaveBeenCalled();
  });

  it("announces a naturally settled failed batch once and suppresses manual clearing", async () => {
    const notify = vi.fn(async (input: {
      kind: NotificationKind;
      title: string;
      body: string;
      actionTarget?: string | null;
      showDesktop?: boolean;
    }): Promise<NotificationRecord> => ({
      id: "notification-1",
      kind: input.kind,
      title: input.title,
      body: input.body,
      state: "unread" as const,
      createdAt: "2026-09-05T00:00:00.000Z",
      expiresAt: "2026-10-05T00:00:00.000Z",
      actionTarget: input.actionTarget ?? null
    }));
    const broadcastSound = vi.fn();
    const tracker = createDownloadCompletionTracker({
      notify,
      isSoundEnabled: async () => true,
      broadcastSound
    });
    const activeTask: CampusDownloadTask = {
      ...readyTask,
      id: "active-download",
      progress: 50,
      status: "syncing"
    };

    tracker.observe([activeTask]);
    tracker.observe([failedTask]);
    await vi.waitFor(() => {
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({
        title: "资料下载已结束",
        body: "下载队列已结束，其中 1 项失败。"
      }));
      expect(broadcastSound).toHaveBeenCalledTimes(1);
    });

    tracker.observe([activeTask]);
    await tracker.suppressDuring(async () => {
      tracker.observe([]);
    });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(broadcastSound).toHaveBeenCalledTimes(1);
  });
});
