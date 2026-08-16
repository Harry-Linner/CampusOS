import { app, BrowserWindow, ipcMain } from "electron";
import type { autoUpdater as AutoUpdaterType } from "electron-updater";
import type {
  CampusAppInfo,
  UpdateStatus
} from "../shared/updateBridge";
import { assertTrustedRenderer } from "./ipcSecurity";

let currentStatus: UpdateStatus = app.isPackaged
  ? { state: "idle" }
  : { state: "unavailable" };
let updater: typeof AutoUpdaterType | null = null;
let updaterEventsBound = false;

const normalizeReleaseNotes = (value: unknown): string[] => {
  if (typeof value === "string") return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 20);
  if (!Array.isArray(value)) return [];
  return value.map((entry) => typeof entry === "string" ? entry : typeof entry === "object" && entry !== null && "note" in entry && typeof entry.note === "string" ? entry.note : "").filter(Boolean).slice(0, 20);
};

const sanitizeUpdateError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  if (/network|internet|ENOTFOUND|ECONN|timed?\s*out/i.test(message)) {
    return "无法连接更新服务，请检查网络后重试。";
  }
  return "更新操作失败，请稍后重试。";
};

const emit = (status: UpdateStatus): void => {
  currentStatus = status;
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send("campusos:updater:changed", { ...status });
    }
  }
};

const bindUpdaterEvents = (instance: typeof AutoUpdaterType): void => {
  if (updaterEventsBound) return;
  updaterEventsBound = true;
  instance.autoDownload = false;
  instance.autoInstallOnAppQuit = false;
  instance.on("checking-for-update", () => emit({ state: "checking" }));
  instance.on("update-available", (info) => {
    const releaseNotes = normalizeReleaseNotes(info.releaseNotes);
    emit({ state: "available", version: info.version, ...(releaseNotes.length ? { releaseNotes } : {}) });
  });
  instance.on("update-not-available", (info) =>
    emit({ state: "up-to-date", version: info.version })
  );
  instance.on("download-progress", (progress) =>
    emit({
      state: "downloading",
      progress: Math.max(0, Math.min(100, progress.percent))
    })
  );
  instance.on("update-downloaded", (info) =>
    emit({ state: "ready", version: info.version, progress: 100 })
  );
  instance.on("error", (error) =>
    emit({ state: "error", error: sanitizeUpdateError(error) })
  );
};

const getAutoUpdater = async (): Promise<typeof AutoUpdaterType> => {
  if (!updater) {
    const module = await import("electron-updater");
    updater = module.autoUpdater;
    bindUpdaterEvents(updater);
  }
  return updater;
};

export const getUpdateStatus = (): Readonly<UpdateStatus> => ({ ...currentStatus });

export const checkForUpdates = async (): Promise<UpdateStatus> => {
  if (!app.isPackaged) {
    emit({ state: "unavailable" });
    return getUpdateStatus();
  }

  try {
    emit({ state: "checking" });
    await (await getAutoUpdater()).checkForUpdates();
  } catch (error) {
    emit({ state: "error", error: sanitizeUpdateError(error) });
  }
  return getUpdateStatus();
};

export const downloadUpdate = async (): Promise<UpdateStatus> => {
  if (currentStatus.state !== "available") {
    return getUpdateStatus();
  }

  try {
    emit({
      state: "downloading",
      version: currentStatus.version,
      progress: 0
    });
    await (await getAutoUpdater()).downloadUpdate();
  } catch (error) {
    emit({ state: "error", error: sanitizeUpdateError(error) });
  }
  return getUpdateStatus();
};

export const cancelDownload = async (): Promise<UpdateStatus> => {
  if (currentStatus.state !== "downloading") return getUpdateStatus();
  try {
    const instance = await getAutoUpdater();
    const cancellable = instance as typeof instance & { cancelDownload?: () => void };
    if (typeof cancellable.cancelDownload === "function") cancellable.cancelDownload();
    emit({ state: "available", version: currentStatus.version });
  } catch (error) {
    emit({ state: "error", error: sanitizeUpdateError(error) });
  }
  return getUpdateStatus();
};

export const quitAndInstall = async (): Promise<void> => {
  if (currentStatus.state !== "ready") return;
  (await getAutoUpdater()).quitAndInstall();
};

const getAppInfo = (): CampusAppInfo => ({
  name: app.getName(),
  version: app.getVersion(),
  packaged: app.isPackaged,
  licenseName: "MIT",
  copyright: "Copyright (c) 2026 Harry-Linner"
});

export const registerUpdateHandlers = (): void => {
  ipcMain.handle("campusos:app:info", (event) => {
    assertTrustedRenderer(event);
    return getAppInfo();
  });
  ipcMain.handle("campusos:updater:check", async (event) => {
    assertTrustedRenderer(event);
    return checkForUpdates();
  });
  ipcMain.handle("campusos:updater:download", async (event) => {
    assertTrustedRenderer(event);
    return downloadUpdate();
  });
  ipcMain.handle("campusos:updater:cancel", async (event) => {
    assertTrustedRenderer(event);
    return cancelDownload();
  });
  ipcMain.handle("campusos:updater:install", async (event) => {
    assertTrustedRenderer(event);
    await quitAndInstall();
  });
  ipcMain.handle("campusos:updater:status", (event) => {
    assertTrustedRenderer(event);
    return getUpdateStatus();
  });
};
