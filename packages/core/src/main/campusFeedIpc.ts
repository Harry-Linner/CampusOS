import { BrowserWindow, ipcMain, shell } from "electron";
import type {
  CampusFeedAiInput,
  CampusFeedScheduleCandidate,
  CampusFeedSnapshot,
  FeedSourceDescriptor
} from "@campusos/shared";
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

  ipcMain.handle("campusos:campus-feed:notification-settings-save", async (event, input: { keywords: string[] }) => {
    assertTrustedRenderer(event);
    if (typeof input !== "object" || input === null || !Array.isArray(input.keywords)) {
      throw new Error("通知关键词设置无效。");
    }
    return service.saveNotificationSettings(input);
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

  ipcMain.handle("campusos:campus-feed:ai-settings-load", async (event) => {
    assertTrustedRenderer(event);
    return service.loadAiSettings();
  });

  ipcMain.handle("campusos:campus-feed:ai-settings-save", async (event, input: CampusFeedAiInput | null) => {
    assertTrustedRenderer(event);
    if (input !== null && (typeof input !== "object" || input === undefined)) {
      throw new Error("AI 连接设置参数无效。");
    }
    return service.saveAiSettings(input as CampusFeedAiInput | null);
  });

  ipcMain.handle("campusos:campus-feed:ai-test", async (event, input: CampusFeedAiInput) => {
    assertTrustedRenderer(event);
    if (typeof input !== "object" || input === null) {
      throw new Error("AI 连接测试参数无效。");
    }
    return service.testAiConnection(input);
  });

  ipcMain.handle("campusos:campus-feed:ai-extract", async (event, itemIds: string[]) => {
    assertTrustedRenderer(event);
    if (!isStringArray(itemIds)) {
      throw new Error("AI 处理参数无效。");
    }
    return service.extractScheduleCandidates(itemIds);
  });

  ipcMain.handle("campusos:campus-feed:ai-create-tasks", async (event, candidates: CampusFeedScheduleCandidate[]) => {
    assertTrustedRenderer(event);
    if (!Array.isArray(candidates)) {
      throw new Error("加入日程参数无效。");
    }
    return service.createScheduleTasks(candidates);
  });
};
