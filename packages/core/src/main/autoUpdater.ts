import { app, ipcMain } from "electron";
import type { autoUpdater as AutoUpdaterType } from "electron-updater";

export interface UpdateStatus {
  state: "idle" | "checking" | "available" | "downloading" | "ready" | "error" | "up-to-date";
  version?: string;
  progress?: number;
  error?: string;
}

let currentStatus: UpdateStatus = { state: "idle" };
const statusListeners: Array<(status: UpdateStatus) => void> = [];
let _autoUpdater: typeof AutoUpdaterType | null = null;

const getAutoUpdater = async (): Promise<typeof AutoUpdaterType> => {
  if (!_autoUpdater) {
    const mod = await import("electron-updater");
    _autoUpdater = mod.autoUpdater;
  }
  return _autoUpdater;
};

export const getUpdateStatus = (): Readonly<UpdateStatus> => ({ ...currentStatus });

const emit = (status: UpdateStatus): void => {
  currentStatus = status;
  for (const listener of statusListeners) listener({ ...status });
};

export const checkForUpdates = async (): Promise<void> => {
  if (!app.isPackaged) {
    emit({ state: "error", error: "Update check only available in packaged apps." });
    return;
  }
  try {
    const a = await getAutoUpdater();
    await a.checkForUpdates();
  } catch (error) {
    emit({ state: "error", error: error instanceof Error ? error.message : "Check failed." });
  }
};

export const downloadUpdate = async (): Promise<void> => {
  try {
    const a = await getAutoUpdater();
    await a.downloadUpdate();
  } catch (error) {
    emit({ state: "error", error: error instanceof Error ? error.message : "Download failed." });
  }
};

export const quitAndInstall = async (): Promise<void> => {
  const a = await getAutoUpdater();
  a.quitAndInstall();
};

export const registerUpdateHandlers = (): void => {
  ipcMain.handle("campusos:updater:check", async () => {
    await checkForUpdates();
    return { ...currentStatus };
  });
  ipcMain.handle("campusos:updater:download", async () => {
    await downloadUpdate();
    return { ...currentStatus };
  });
  ipcMain.handle("campusos:updater:install", async () => {
    await quitAndInstall();
    return { state: "ready" as const };
  });
  ipcMain.handle("campusos:updater:status", async () => ({ ...currentStatus }));
};
