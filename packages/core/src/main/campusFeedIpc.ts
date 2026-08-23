import { BrowserWindow, ipcMain, shell } from "electron";
import type { CampusFeedSnapshot, FeedSourceDescriptor } from "@campusos/shared";
import type { CampusFeedService } from "./campusFeedService";
import { assertTrustedRenderer } from "./ipcSecurity";

const broadcastSnapshot = (snapshot: CampusFeedSnapshot): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send("campusos:campus-feed:changed", snapshot);
    }
  }
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

export const registerCampusFeedHandlers = (service: CampusFeedService): void => {
  service.subscribe((snapshot) => broadcastSnapshot(snapshot));

  ipcMain.handle("campusos:campus-feed:get", async (event) => {
    assertTrustedRenderer(event);
    return service.getSnapshot();
  });

  ipcMain.handle("campusos:campus-feed:refresh-source", async (event, sourceId: string) => {
    assertTrustedRenderer(event);
    if (typeof sourceId !== "string" || !sourceId) {
      throw new Error("订阅源 ID 无效。");
    }
    return service.refreshSource(sourceId);
  });

  ipcMain.handle("campusos:campus-feed:refresh-all", async (event) => {
    assertTrustedRenderer(event);
    await service.refreshAll();
  });

  ipcMain.handle("campusos:campus-feed:update-source", async (event, input: { id: string; patch: Partial<FeedSourceDescriptor> }) => {
    assertTrustedRenderer(event);
    if (typeof input?.id !== "string" || !input.id || typeof input.patch !== "object" || input.patch === null) {
      throw new Error("订阅源更新参数无效。");
    }
    return service.updateSource(input.id, input.patch);
  });

  ipcMain.handle("campusos:campus-feed:remove-source", async (event, sourceId: string) => {
    assertTrustedRenderer(event);
    if (typeof sourceId !== "string" || !sourceId) {
      throw new Error("订阅源 ID 无效。");
    }
    await service.removeSource(sourceId);
  });

  ipcMain.handle("campusos:campus-feed:mark-read", async (event, ids: string[]) => {
    assertTrustedRenderer(event);
    if (!isStringArray(ids)) {
      throw new Error("已读条目参数无效。");
    }
    await service.markRead(ids);
  });

  ipcMain.handle("campusos:campus-feed:open-external", async (event, url: string) => {
    assertTrustedRenderer(event);
    const target = await service.openExternal(url);
    await shell.openExternal(target);
  });
};
