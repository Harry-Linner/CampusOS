import { BrowserWindow, shell } from "electron";
import type {
  CampusFeedAiInput,
  CampusFeedScheduleCandidate,
  CampusFeedSnapshot,
  CampusFeedPreferencesInput,
  CampusFeedHistorySearchInput,
  FeedSourceDescriptor
} from "@campusos/shared";
import type { CampusFeedService } from "./campusFeedService";
import { registerTrustedIpcHandler } from "./trustedIpc";

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

  registerTrustedIpcHandler("campusos:campus-feed:get", async () => {
    return service.getSnapshot();
  });
  registerTrustedIpcHandler("campusos:campus-feed:search-history", async (input: CampusFeedHistorySearchInput) => service.searchHistory(input));
  registerTrustedIpcHandler("campusos:campus-feed:get-items", async (ids: string[]) => service.getItems(ids));

  registerTrustedIpcHandler("campusos:campus-feed:refresh-source", async (sourceId: string) => {
    if (typeof sourceId !== "string" || !sourceId) {
      throw new Error("订阅源 ID 无效。");
    }
    return service.refreshSource(sourceId);
  });

  registerTrustedIpcHandler("campusos:campus-feed:add-source", async (sourceId: string) => {
    if (typeof sourceId !== "string" || !sourceId) throw new Error("订阅源 ID 无效。");
    await service.addSource(sourceId);
  });
  registerTrustedIpcHandler("campusos:campus-feed:preferences-save", async (input: CampusFeedPreferencesInput) => {
    return service.savePreferences(input);
  });
  registerTrustedIpcHandler("campusos:campus-feed:item-detail", async (itemId: string) => {
    if (typeof itemId !== "string" || !itemId || itemId.length > 200) throw new Error("通知 ID 无效。");
    return service.getItemDetail(itemId);
  });

  registerTrustedIpcHandler("campusos:campus-feed:refresh-all", async () => {
    await service.refreshAll();
  });

  registerTrustedIpcHandler("campusos:campus-feed:update-source", async (input: { id: string; patch: Partial<FeedSourceDescriptor> }) => {
    if (typeof input?.id !== "string" || !input.id || typeof input.patch !== "object" || input.patch === null) {
      throw new Error("订阅源更新参数无效。");
    }
    return service.updateSource(input.id, input.patch);
  });

  registerTrustedIpcHandler("campusos:campus-feed:notification-settings-save", async (input: { keywords: string[] }) => {
    if (typeof input !== "object" || input === null || !Array.isArray(input.keywords)) {
      throw new Error("通知关键词设置无效。");
    }
    return service.saveNotificationSettings(input);
  });

  registerTrustedIpcHandler("campusos:campus-feed:remove-source", async (sourceId: string) => {
    if (typeof sourceId !== "string" || !sourceId) {
      throw new Error("订阅源 ID 无效。");
    }
    await service.removeSource(sourceId);
  });

  registerTrustedIpcHandler("campusos:campus-feed:mark-read", async (ids: string[]) => {
    if (!isStringArray(ids)) {
      throw new Error("已读条目参数无效。");
    }
    await service.markRead(ids);
  });

  registerTrustedIpcHandler("campusos:campus-feed:open-external", async (url: string) => {
    const target = await service.openExternal(url);
    await shell.openExternal(target);
  });

  registerTrustedIpcHandler("campusos:campus-feed:ai-settings-load", async () => {
    return service.loadAiSettings();
  });

  registerTrustedIpcHandler("campusos:campus-feed:ai-settings-save", async (input: CampusFeedAiInput | null) => {
    if (input !== null && (typeof input !== "object" || input === undefined)) {
      throw new Error("AI 连接设置参数无效。");
    }
    return service.saveAiSettings(input as CampusFeedAiInput | null);
  });

  registerTrustedIpcHandler("campusos:campus-feed:ai-test", async (input: CampusFeedAiInput) => {
    if (typeof input !== "object" || input === null) {
      throw new Error("AI 连接测试参数无效。");
    }
    return service.testAiConnection(input);
  });

  registerTrustedIpcHandler("campusos:campus-feed:ai-extract", async (itemIds: string[]) => {
    if (!isStringArray(itemIds)) {
      throw new Error("AI 处理参数无效。");
    }
    return service.extractScheduleCandidates(itemIds);
  });

  registerTrustedIpcHandler("campusos:campus-feed:ai-create-tasks", async (candidates: CampusFeedScheduleCandidate[]) => {
    if (!Array.isArray(candidates)) {
      throw new Error("加入日程参数无效。");
    }
    return service.createScheduleTasks(candidates);
  });
};
