import { BrowserWindow, app, ipcMain, screen } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  createDefaultDeskCalendarSettings,
  normalizeDeskCalendarView,
  type DeskCalendarView,
  type DeskCalendarSettings,
  type DeskCalendarSnapshotMessage,
  type DeskCalendarWeather,
  type LocalTaskInput,
} from "@campusos/shared";
import { assertTrustedDeskCalendarCaller } from "./ipcSecurity";
import { pinWindowToDesktopBottom } from "./desktopPinning";
import { hydrateCampusWorkspace } from "./campusWorkspaceStore";
import { attachWindowStatePersistence, loadWindowState } from "./windowStateStore";
import { syncWidgetWindows } from "./deskCalendarWidgetWindow";
import {
  loadSchedulePeriods,
  loadScheduleTasks,
  mutateScheduleTask,
  saveScheduleTask
} from "./scheduleIpc";

const DESK_CALENDAR_SETTINGS_FILE = "desk-calendar.json";
export const DESK_CALENDAR_CHANGED_CHANNEL = "campusos:desk-calendar:changed";
export const DESK_CALENDAR_SNAPSHOT_CHANNEL = "campusos:desk-calendar:snapshot";
export const APP_NAVIGATION_REQUEST_CHANNEL = "campusos:navigation:request";

let deskCalendarWindow: BrowserWindow | null = null;
let settings: DeskCalendarSettings | null = null;
let appIsQuitting = false;
let settingsChangedListener: (() => void | Promise<void>) | null = null;

const getSettingsPath = (): string =>
  join(app.getPath("userData"), "settings", DESK_CALENDAR_SETTINGS_FILE);

const ensurePreferencesDir = async (storagePath: string): Promise<void> => {
  await mkdir(dirname(storagePath), { recursive: true });
};

const normalizeWidgets = (value: unknown): DeskCalendarSettings["widgets"] => {
  const defaults = createDefaultDeskCalendarSettings("").widgets;
  if (!Array.isArray(value)) return defaults;
  return defaults.map((item) => ({
    id: item.id,
    enabled: value.some((candidate) => typeof candidate === "object" && candidate !== null &&
      (candidate as { id?: unknown }).id === item.id && (candidate as { enabled?: unknown }).enabled === true)
  }));
};

const normalizeAppearance = (value: unknown): DeskCalendarSettings["appearance"] => {
  if (typeof value !== "object" || value === null) return createDefaultDeskCalendarSettings("").appearance;
  const candidate = value as { opacity?: unknown };
  return {
    opacity: typeof candidate.opacity === "number" && Number.isFinite(candidate.opacity)
      ? Math.max(0.2, Math.min(1, candidate.opacity))
      : 0.88
  };
};

const normalizeCountdowns = (value: unknown): DeskCalendarSettings["countdowns"] => Array.isArray(value)
  ? value.flatMap((item) => typeof item === "object" && item !== null && typeof (item as { id?: unknown }).id === "string" && typeof (item as { title?: unknown }).title === "string" && typeof (item as { targetAt?: unknown }).targetAt === "string" && Number.isFinite(Date.parse((item as { targetAt: string }).targetAt))
    ? [{ id: (item as { id: string }).id.slice(0, 128), title: (item as { title: string }).title.slice(0, 160), targetAt: new Date((item as { targetAt: string }).targetAt).toISOString() }]
    : [])
  : [];

const normalizeProgress = (value: unknown): DeskCalendarSettings["progress"] => Array.isArray(value)
  ? value.flatMap((item) => typeof item === "object" && item !== null && typeof (item as { id?: unknown }).id === "string" && typeof (item as { title?: unknown }).title === "string" && typeof (item as { startAt?: unknown }).startAt === "string" && typeof (item as { endAt?: unknown }).endAt === "string" && Date.parse((item as { startAt: string }).startAt) < Date.parse((item as { endAt: string }).endAt)
    ? [{ id: (item as { id: string }).id.slice(0, 128), title: (item as { title: string }).title.slice(0, 160), startAt: new Date((item as { startAt: string }).startAt).toISOString(), endAt: new Date((item as { endAt: string }).endAt).toISOString() }]
    : [])
  : [];

const normalizeStatutoryHolidays = (value: unknown): DeskCalendarSettings["statutoryHolidays"] => Array.isArray(value)
  ? value.flatMap((item) => typeof item === "object" && item !== null && typeof (item as { date?: unknown }).date === "string" && /^\d{4}-\d{2}-\d{2}$/.test((item as { date: string }).date) && typeof (item as { label?: unknown }).label === "string"
    ? [{ date: (item as { date: string }).date, label: (item as { label: string }).label.slice(0, 80) }]
    : [])
  : [];

const normalizeMakeupDays = (value: unknown): DeskCalendarSettings["makeupDays"] => Array.isArray(value)
  ? value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const candidate = item as { date?: unknown; weekday?: unknown; source?: unknown };
    if (typeof candidate.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(candidate.date)) return [];
    if (typeof candidate.weekday !== "number" || !Number.isInteger(candidate.weekday) || candidate.weekday < 1 || candidate.weekday > 7) return [];
    const source = candidate.source === "manual" ? "manual" : "builtin";
    return [{ date: candidate.date, weekday: candidate.weekday, source }];
  })
  : [];

const normalizeDisplayProfiles = (value: unknown): DeskCalendarSettings["displayProfiles"] => Array.isArray(value)
  ? value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const candidate = item as { displayKey?: unknown; bounds?: { x?: unknown; y?: unknown; width?: unknown; height?: unknown } };
    const bounds = candidate.bounds;
    if (typeof candidate.displayKey !== "string" || !bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every((part) => typeof part === "number" && Number.isFinite(part))) return [];
    return [{ displayKey: candidate.displayKey.slice(0, 512), bounds: { x: Math.round(bounds.x as number), y: Math.round(bounds.y as number), width: Math.max(420, Math.round(bounds.width as number)), height: Math.max(320, Math.round(bounds.height as number)) } }];
  })
  : [];

export const getDisplayKey = (): string => {
  try {
    return screen.getAllDisplays().map((display) => `${display.bounds.x},${display.bounds.y},${display.bounds.width},${display.bounds.height}`).sort().join("|");
  } catch {
    return "default";
  }
};

export const isVisibleOnCurrentDisplays = (bounds: { x: number; y: number; width: number; height: number }): boolean => {
  try {
    return screen.getAllDisplays().some((display) => Math.max(bounds.x, display.workArea.x) < Math.min(bounds.x + bounds.width, display.workArea.x + display.workArea.width) && Math.max(bounds.y, display.workArea.y) < Math.min(bounds.y + bounds.height, display.workArea.y + display.workArea.height));
  } catch {
    return false;
  }
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
      showClock?: boolean;
      widgets?: unknown;
      countdowns?: unknown;
      progress?: unknown;
      weather?: DeskCalendarWeather | null;
      appearance?: unknown;
      statutoryHolidays?: unknown;
      makeupDays?: unknown;
      displayProfiles?: unknown;
      savedAt?: string;
    };
    return {
      enabled: payload.enabled === true,
      view: normalizeDeskCalendarView(payload.view),
      showClock: payload.showClock !== false,
      widgets: normalizeWidgets(payload.widgets),
      countdowns: normalizeCountdowns(payload.countdowns),
      progress: normalizeProgress(payload.progress),
      weather: payload.weather && typeof payload.weather === "object" ? payload.weather : null,
      appearance: normalizeAppearance(payload.appearance),
      statutoryHolidays: normalizeStatutoryHolidays(payload.statutoryHolidays),
      makeupDays: normalizeMakeupDays(payload.makeupDays),
      displayProfiles: normalizeDisplayProfiles(payload.displayProfiles),
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

export const loadSettings = async (): Promise<DeskCalendarSettings> => {
  if (settings) return settings;
  const stored = await readStoredSettings();
  settings = stored ?? createDefaultDeskCalendarSettings(getSettingsPath());
  return settings;
};

export const saveSettings = async (
  patch: Partial<Omit<DeskCalendarSettings, "savedAt" | "storagePath">>
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

export const broadcastSettingsChanged = (): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(DESK_CALENDAR_CHANGED_CHANNEL);
  }
  if (settingsChangedListener) {
    void Promise.resolve(settingsChangedListener()).catch(() => undefined);
  }
};

const currentSnapshotMessage = async (): Promise<DeskCalendarSnapshotMessage> => {
  const record = await hydrateCampusWorkspace();
  const now = new Date();
  return {
    view: (await loadSettings()).view,
    snapshot: record.snapshot,
    localTaskPeriods: loadSchedulePeriods({
      startAt: new Date(now.getTime() - 366 * 24 * 60 * 60 * 1000).toISOString(),
      endAt: new Date(now.getTime() + 1096 * 24 * 60 * 60 * 1000).toISOString()
    }),
    localTasks: loadScheduleTasks().tasks,
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

export const refreshWeather = async (): Promise<DeskCalendarWeather> => {
  const current = await loadSettings();
  const location = current.weather?.location?.trim() || "Hangzhou";
  try {
    const geocoding = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=zh&format=json`);
    if (!geocoding.ok) throw new Error(`定位服务返回 ${geocoding.status}`);
    const place = (await geocoding.json() as { results?: Array<{ latitude: number; longitude: number; name: string }> }).results?.[0];
    if (!place) throw new Error("未找到该地点。");
    const forecast = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=4&timezone=Asia%2FShanghai`);
    if (!forecast.ok) throw new Error(`天气服务返回 ${forecast.status}`);
    const data = await forecast.json() as {
      current?: { temperature_2m?: number; weather_code?: number; time?: string };
      daily?: { time?: string[]; weather_code?: number[]; temperature_2m_max?: number[]; temperature_2m_min?: number[] };
    };
    if (!data.current || !Number.isFinite(data.current.temperature_2m) || !Number.isFinite(data.current.weather_code)) throw new Error("天气服务返回无效数据。");
    const currentTemperature = data.current.temperature_2m as number;
    const currentWeatherCode = data.current.weather_code as number;
    const daily = data.daily;
    const days = daily && Array.isArray(daily.time) && Array.isArray(daily.temperature_2m_max) && Array.isArray(daily.temperature_2m_min)
      ? daily.time.slice(0, 4).map((date, index) => ({
          date,
          weatherCode: daily.weather_code?.[index] ?? currentWeatherCode,
          tempMax: daily.temperature_2m_max![index] ?? currentTemperature,
          tempMin: daily.temperature_2m_min![index] ?? currentTemperature
        }))
      : undefined;
    const weather: DeskCalendarWeather = {
      location: place.name,
      temperatureC: currentTemperature,
      weatherCode: currentWeatherCode,
      observedAt: data.current.time ?? new Date().toISOString(),
      cachedAt: new Date().toISOString(),
      error: null,
      forecast: days
    };
    await saveSettings({ weather });
    return weather;
  } catch (cause) {
    const weather: DeskCalendarWeather = {
      location,
      temperatureC: current.weather?.temperatureC ?? 0,
      weatherCode: current.weather?.weatherCode ?? -1,
      observedAt: current.weather?.observedAt ?? new Date(0).toISOString(),
      cachedAt: current.weather?.cachedAt ?? new Date(0).toISOString(),
      error: cause instanceof Error ? cause.message : "天气刷新失败。"
    };
    await saveSettings({ weather });
    return weather;
  }
};

const disableAfterUserClose = async (): Promise<void> => {
  if (appIsQuitting) return;
  const current = await loadSettings();
  if (!current.enabled) return;
  await saveSettings({ enabled: false });
  broadcastSettingsChanged();
};

const createDeskCalendarWindow = async (): Promise<BrowserWindow> => {
  // 窗口状态键用 "desk-calendar-window"：此前与桌面日历设置共用 "desk-calendar.json"，
  // 窗口移动/缩放会以 bounds-only JSON 覆盖 enabled/天气/displayProfiles 设置（实测踩坑）。
  const storedState = await loadWindowState("desk-calendar-window", { minimumWidth: 420, minimumHeight: 320 });
  const currentSettings = await loadSettings();
  const profile = currentSettings.displayProfiles.find((candidate) => candidate.displayKey === getDisplayKey());
  const profileBounds = profile && isVisibleOnCurrentDisplays(profile.bounds) ? profile.bounds : undefined;
  const window = new BrowserWindow({
    ...(profileBounds ?? storedState?.bounds ?? {}),
    width: 720,
    height: 560,
    minWidth: 420,
    minHeight: 320,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    // 对照 DeskToDo 的 Qt.Tool（overlay_window.py:267-271）：WS_EX_TOOLWINDOW
    // 使窗口不进任务栏/Alt-Tab，且 Win+D"显示桌面"时不会被最小化（用户贴底需求的一部分）。
    type: "toolbar",
    // 用户决策（2026-08-28）：桌面日历必须常驻桌面底层（壁纸之上、普通窗口之下），
    // 置顶会遮挡正常使用。贴底由 pinWindowToDesktopBottom 以 Win32 实现。
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

  const detachWindowStatePersistence = attachWindowStatePersistence(window, "desk-calendar-window");
  const persistDisplayProfile = (): void => {
    const nextProfile = { displayKey: getDisplayKey(), bounds: window.getNormalBounds() };
    void loadSettings().then((latest) => saveSettings({ displayProfiles: [...latest.displayProfiles.filter((candidate) => candidate.displayKey !== nextProfile.displayKey), nextProfile] })).catch(() => undefined);
  };
  window.on("move", persistDisplayProfile);
  window.on("resize", persistDisplayProfile);
  if (storedState?.maximized) window.maximize();
  window.setMenu(null);
  pinWindowToDesktopBottom(window);
  window.on("closed", () => {
    detachWindowStatePersistence();
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
    assertTrustedDeskCalendarCaller(event);
    return loadSettings();
  });

  ipcMain.handle("campusos:desk-calendar:settings:save", async (event, input: unknown) => {
    assertTrustedDeskCalendarCaller(event);
    const candidate = typeof input === "object" && input !== null
      ? input as Partial<DeskCalendarSettings>
      : {};
    const patch: Partial<Omit<DeskCalendarSettings, "savedAt" | "storagePath">> = {};
    if (typeof candidate.enabled === "boolean") patch.enabled = candidate.enabled;
    if (candidate.view !== undefined) patch.view = normalizeDeskCalendarView(candidate.view);
    if (typeof candidate.showClock === "boolean") patch.showClock = candidate.showClock;
    if (candidate.widgets !== undefined) patch.widgets = normalizeWidgets(candidate.widgets);
    if (candidate.countdowns !== undefined) patch.countdowns = normalizeCountdowns(candidate.countdowns);
    if (candidate.progress !== undefined) patch.progress = normalizeProgress(candidate.progress);
    if (candidate.appearance !== undefined) patch.appearance = normalizeAppearance(candidate.appearance);
    if (candidate.statutoryHolidays !== undefined) patch.statutoryHolidays = normalizeStatutoryHolidays(candidate.statutoryHolidays);
    if (candidate.makeupDays !== undefined) patch.makeupDays = normalizeMakeupDays(candidate.makeupDays);
    if (candidate.displayProfiles !== undefined) patch.displayProfiles = normalizeDisplayProfiles(candidate.displayProfiles);
    if (candidate.weather !== undefined) patch.weather = candidate.weather;
    const next = await saveSettings(patch);

    if (next.enabled) {
      await ensureDeskCalendarWindow();
    } else if (deskCalendarWindow && !deskCalendarWindow.isDestroyed()) {
      deskCalendarWindow.close();
    }
    if (next.enabled) broadcastSnapshotSafely();
    broadcastSettingsChanged();
    syncWidgetWindows(next);
    return next;
  });

  ipcMain.handle("campusos:desk-calendar:weather:refresh", async (event) => {
    assertTrustedDeskCalendarCaller(event);
    const weather = await refreshWeather();
    broadcastSettingsChanged();
    return weather;
  });

  ipcMain.handle("campusos:desk-calendar:task:complete", async (event, input: unknown) => {
    assertTrustedDeskCalendarCaller(event);
    const candidate = typeof input === "object" && input !== null ? input as Record<string, unknown> : {};
    const taskId = typeof candidate.taskId === "string" ? candidate.taskId.trim() : "";
    if (!taskId || taskId.length > 512) throw new Error("Invalid desktop calendar task.");
    const status = candidate.status === "running" || candidate.status === "completed" ? candidate.status : "completed";
    await mutateScheduleTask({ id: taskId, status, scope: "single" });
    broadcastSnapshotSafely();
  });

  ipcMain.handle("campusos:desk-calendar:task:save", async (event, input: unknown) => {
    assertTrustedDeskCalendarCaller(event);
    if (typeof input !== "object" || input === null) {
      throw new Error("Invalid desktop calendar task.");
    }
    await saveScheduleTask(input as LocalTaskInput);
    broadcastSnapshotSafely();
  });

  ipcMain.handle("campusos:desk-calendar:window:snapshot", async (event) => {
    assertTrustedDeskCalendarCaller(event);
    return currentSnapshotMessage();
  });

  ipcMain.handle("campusos:desk-calendar:window:close", async (event) => {
    assertTrustedDeskCalendarCaller(event);
    await saveSettings({ enabled: false });
    if (deskCalendarWindow && !deskCalendarWindow.isDestroyed()) {
      deskCalendarWindow.close();
    }
    broadcastSettingsChanged();
  });

  ipcMain.handle("campusos:desk-calendar:window:open-main", async (event, input: unknown) => {
    assertTrustedDeskCalendarCaller(event);
    const entityId = typeof input === "object" && input !== null &&
      "entityId" in input && typeof input.entityId === "string"
      ? input.entityId.trim()
      : "";
    if (!entityId || entityId.length > 512) {
      throw new Error("Invalid desktop calendar navigation target.");
    }
    const mainWindow = BrowserWindow.getAllWindows().find((window) => window !== deskCalendarWindow && !window.isDestroyed());
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send(APP_NAVIGATION_REQUEST_CHANNEL, {
      requestId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      viewId: "schedule",
      entityId
    });
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
  syncWidgetWindows(next);
  return next;
};

export const setDeskCalendarView = async (view: DeskCalendarView): Promise<DeskCalendarSettings> => {
  const next = await saveSettings({ view });
  if (next.enabled) {
    await ensureDeskCalendarWindow();
    broadcastSnapshotSafely();
  }
  broadcastSettingsChanged();
  return next;
};

export const setDeskCalendarSettingsChangedListener = (
  listener: (() => void | Promise<void>) | null
): void => {
  settingsChangedListener = listener;
};

/** 应用启动完成后恢复用户上次启用的桌面日历。 */
export const restoreDeskCalendarWindow = async (): Promise<void> => {
  const current = await loadSettings();
  if (!current.enabled) return;
  await ensureDeskCalendarWindow();
  broadcastSnapshotSafely();
  syncWidgetWindows(current);
};

/** 退出应用时保留启用偏好，避免把正常退出误判为用户关闭组件。 */
export const markDeskCalendarAppQuitting = (): void => {
  appIsQuitting = true;
};

export const isDeskCalendarAppQuitting = (): boolean => appIsQuitting;
