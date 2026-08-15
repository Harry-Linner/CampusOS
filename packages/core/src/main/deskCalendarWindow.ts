import { BrowserWindow, app, ipcMain } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  createDefaultDeskCalendarSettings,
  normalizeDeskCalendarView,
  type DeskCalendarSettings,
  type DeskCalendarSnapshotMessage,
  type DeskCalendarView
} from "@campusos/shared";
import { assertTrustedRenderer } from "./ipcSecurity";
import { hydrateCampusWorkspace } from "./campusWorkspaceStore";

const DESK_CALENDAR_SETTINGS_FILE = "desk-calendar.json";
export const DESK_CALENDAR_CHANGED_CHANNEL = "campusos:desk-calendar:changed";
export const DESK_CALENDAR_SNAPSHOT_CHANNEL = "campusos:desk-calendar:snapshot";

let deskCalendarWindow: BrowserWindow | null = null;
let settings: DeskCalendarSettings | null = null;

const getSettingsPath = (): string =>
  join(app.getPath("userData"), "preferences", DESK_CALENDAR_SETTINGS_FILE);

const ensurePreferencesDir = async (storagePath: string): Promise<void> => {
  await mkdir(dirname(storagePath), { recursive: true });
};

const readStoredSettings = async (): Promise<DeskCalendarSettings | null> => {
  const storagePath = getSettingsPath();
  try {
    const raw = await readFile(storagePath, "utf8");
    const payload = JSON.parse(raw) as {
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
  void broadcastSnapshot();
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

  ipcMain.handle("campusos:desk-calendar:settings:save", async (event, input: {
    enabled?: boolean;
    view?: DeskCalendarView;
  }) => {
    assertTrustedRenderer(event);
    const patch: Partial<Pick<DeskCalendarSettings, "enabled" | "view">> = {};
    if (typeof input.enabled === "boolean") patch.enabled = input.enabled;
    if (input.view !== undefined) patch.view = normalizeDeskCalendarView(input.view);
    const next = await saveSettings(patch);

    if (next.enabled) {
      await ensureDeskCalendarWindow();
    } else if (deskCalendarWindow && !deskCalendarWindow.isDestroyed()) {
      deskCalendarWindow.close();
    }
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
  void broadcastSnapshot();
};

export const getDeskCalendarSettings = (): Promise<DeskCalendarSettings> =>
  loadSettings();
