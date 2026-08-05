import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CampusDownloadTask } from "@campusos/shared";

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

import { registerDownloadHandlers } from "./downloadIpc";

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
    cancel: vi.fn(async () => true)
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
});
