import { BrowserWindow, app, ipcMain } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  createDefaultDeskCalendarSettings,
  normalizeDeskCalendarView,
  type DeskCalendarSettings,
  type DeskCalendarSnapshotMessage,
} from "@campusos/shared";
import { assertTrustedRenderer } from "./ipcSecurity";
import { hydrateCampusWorkspace } from "./campusWorkspaceStore";

const DESK_CALENDAR_SETTINGS_FILE = "desk-calendar.json";
export const DESK_CALENDAR_CHANGED_CHANNEL = "campusos:desk-calendar:changed";
export const DESK_CALENDAR_SNAPSHOT_CHANNEL = "campusos:desk-calendar:snapshot";

let deskCalendarWindow: BrowserWindow | null = null;
let settings: DeskCalendarSettings | null = null;
let appIsQuitting = false;

const getSettingsPath = (): string =>
  join(app.getPath("userData"), "preferences", DESK_CALENDAR_SETTINGS_FILE);

const ensurePreferencesDir = async (storagePath: string): Promise<void> => {
  await mkdir(dirname(storagePath), { recursive: true });
};

const readStoredSettings = async (): Promise<DeskCalendarSettings | null> => {
  const storagePath = getSettingsPath();
  try {
    const raw = await readFile(storagePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const payload = parsed as {
      enabled?: boolean;
      view?: unknown;
      savedAt?: string;
    };
    return {
      enabled: payload.enabled === true,
      view: normalizeDeskCalendarView(payload.view),
      savedAt: payload.savedAt ?? new Date(0).toISOString(),
      storagePath
    };
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
};

const loadSettings = async (): Promise<DeskCalendarSettings> => {
  if (settings) return settings;
  const stored = await readStoredSettings();
  settings = stored ?? createDefaultDeskCalendarSettings(getSettingsPath());
  return settings;
};

const saveSettings = async (
  patch: Partial<Pick<DeskCalendarSettings, "enabled" | "view">>
): Promise<DeskCalendarSettings> => {
  const current = await loadSettings();
  const next: DeskCalendarSettings = {
    ...current,
    ...patch,
    savedAt: new Date().toISOString()
  };
  await ensurePreferencesDir(next.storagePath);
  await writeFile(next.storagePath, JSON.stringify(next, null, 2), "utf8");
  settings = next;
  return next;
};

const broadcastSettingsChanged = (): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(DESK_CALENDAR_CHANGED_CHANNEL);
  }
};

const currentSnapshotMessage = async (): Promise<DeskCalendarSnapshotMessage> => {
  const record = await hydrateCampusWorkspace();
  return {
    view: (await loadSettings()).view,
    snapshot: record.snapshot,
    generatedAt: record.snapshot.generatedAt
  };
};

const broadcastSnapshot = async (): Promise<void> => {
  if (!deskCalendarWindow || deskCalendarWindow.isDestroyed()) return;
  const message = await currentSnapshotMessage();
  deskCalendarWindow.webContents.send(DESK_CALENDAR_SNAPSHOT_CHANNEL, message);
};

const broadcastSnapshotSafely = (): void => {
  void broadcastSnapshot().catch(() => undefined);
};

const disableAfterUserClose = async (): Promise<void> => {
  if (appIsQuitting) return;
  const current = await loadSettings();
  if (!current.enabled) return;
  await saveSettings({ enabled: false });
  broadcastSettingsChanged();
};

const createDeskCalendarWindow = async (): Promise<BrowserWindow> => {
  const window = new BrowserWindow({
    width: 720,
    height: 560,
    minWidth: 420,
    minHeight: 320,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/deskCalendar.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  window.setAlwaysOnTop(true, "floating");
  window.setMenu(null);
  window.on("closed", () => {
    deskCalendarWindow = null;
    void disableAfterUserClose();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    await window.loadURL(
      new URL("desk-calendar.html", process.env.ELECTRON_RENDERER_URL).toString()
    );
  } else {
    await window.loadFile(
      join(__dirname, "../renderer/desk-calendar.html")
    );
  }

  window.show();
  return window;
};

const ensureDeskCalendarWindow = async (): Promise<BrowserWindow> => {
  if (deskCalendarWindow && !deskCalendarWindow.isDestroyed()) {
    deskCalendarWindow.show();
    deskCalendarWindow.focus();
    return deskCalendarWindow;
  }
  deskCalendarWindow = await createDeskCalendarWindow();
  return deskCalendarWindow;
};

export const registerDeskCalendarHandlers = (): void => {
  ipcMain.handle("campusos:desk-calendar:settings:load", async (event) => {
    assertTrustedRenderer(event);
    return loadSettings();
  });

  ipcMain.handle("campusos:desk-calendar:settings:save", async (event, input: unknown) => {
    assertTrustedRenderer(event);
    const candidate = typeof input === "object" && input !== null
      ? input as { enabled?: unknown; view?: unknown }
      : {};
    const patch: Partial<Pick<DeskCalendarSettings, "enabled" | "view">> = {};
    if (typeof candidate.enabled === "boolean") patch.enabled = candidate.enabled;
    if (candidate.view !== undefined) patch.view = normalizeDeskCalendarView(candidate.view);
    const next = await saveSettings(patch);

    if (next.enabled) {
      await ensureDeskCalendarWindow();
    } else if (deskCalendarWindow && !deskCalendarWindow.isDestroyed()) {
      deskCalendarWindow.close();
    }
    if (next.enabled) broadcastSnapshotSafely();
    broadcastSettingsChanged();
    return next;
  });

  ipcMain.handle("campusos:desk-calendar:window:snapshot", async (event) => {
    assertTrustedRenderer(event);
    return currentSnapshotMessage();
  });

  ipcMain.handle("campusos:desk-calendar:window:close", async (event) => {
    assertTrustedRenderer(event);
    await saveSettings({ enabled: false });
    if (deskCalendarWindow && !deskCalendarWindow.isDestroyed()) {
      deskCalendarWindow.close();
    }
    broadcastSettingsChanged();
  });
};

/** 工作区刷新后由协调器调用，向悬浮窗推送最新快照。 */
export const notifyDeskCalendarWorkspaceChanged = (): void => {
  broadcastSnapshotSafely();
};

export const getDeskCalendarSettings = (): Promise<DeskCalendarSettings> =>
  loadSettings();

export const setDeskCalendarEnabled = async (enabled: boolean): Promise<DeskCalendarSettings> => {
  const next = await saveSettings({ enabled });
  if (next.enabled) await ensureDeskCalendarWindow();
  else if (deskCalendarWindow && !deskCalendarWindow.isDestroyed()) deskCalendarWindow.close();
  if (next.enabled) broadcastSnapshotSafely();
  broadcastSettingsChanged();
  return next;
};

/** 应用启动完成后恢复用户上次启用的桌面日历。 */
export const restoreDeskCalendarWindow = async (): Promise<void> => {
  const current = await loadSettings();
  if (!current.enabled) return;
  await ensureDeskCalendarWindow();
  broadcastSnapshotSafely();
};

/** 退出应用时保留启用偏好，避免把正常退出误判为用户关闭组件。 */
export const markDeskCalendarAppQuitting = (): void => {
  appIsQuitting = true;
};
