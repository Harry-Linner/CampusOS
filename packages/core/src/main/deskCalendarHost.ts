import { dirname, join } from "node:path";
import { getAccountBrowserSession } from "./accountBrowserSession";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertTrustedRenderer } from "./ipcSecurity";
import { registerWindowIpcHandler } from "./trustedIpc";
import { resolveLocalTaskReminderAt } from "@campusos/shared";

// datetime-local controls describe the calendar's Shanghai clock, regardless
// of the operating system's timezone. Already-qualified ISO timestamps survive.
const calendarInputTime = (value: string): string => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(value) ? `${value}+08:00` : value;
import { app, BrowserWindow, ipcMain, nativeTheme, screen, type IpcMainEvent, type IpcMainInvokeEvent, type Rectangle } from "electron";
import { hydrateCampusWorkspace } from "./campusWorkspaceStore";
import { loadSchedulePeriods, loadScheduleTasks, saveScheduleTask, mutateScheduleTask } from "./scheduleIpc";
import { pinWindowToDesktopBottom } from "./desktopPinning";
import { loadUnifiedCalendarData } from "./calendarDataService";
import {
  DESK_CALENDAR_STATE_KEYS,
  loadCalendarEventPersonalizations,
  loadDesktopState,
  saveCalendarEventPersonalization,
  saveDesktopState
} from "./deskCalendarStateStore";
import {
  enforceCampusAutoStartDependency,
  loadDeskCalendarSettings,
  saveDeskCalendarSettings,
  type DeskCalendarSettings
} from "./deskCalendarSettings";

/** 桌面日历窗口对外暴露的数据（渲染层 CalData）。 */
interface DeskCalendarData {
  today: string;
  /** 法定节假日/补班：date->label, holiday=true 表示放假 */
  holidays: { date: string; label: string; holiday: boolean }[];
  /** 校历周次（解析好的 json 查表）：date -> 校历周次号 */
  weeks: Record<string, number>;
  /** 当前校历周次（用于"今天/选中时"显示） */
  currentWeek: number | null;
  theme: "light" | "dark" | "high-contrast";
  /** 主界面同款事件结构：kind/location/note(教师)/status 都在 */
  items: {
    id: string;
    title: string;
    date: string;
    kind: "course" | "exam" | "assignment" | "task";
    time?: string;
    color?: string;
    note?: string;
    location?: string;
      status?: string;
      origin: "local" | "upstream";
      startAt: string;
      endAt: string;
      taskId?: string;
      occurrenceKey?: string;
      repeatType?: string;
      repeatPeriod?: number;
      repeatEndsOn?: string;
      repeatEndMode?: "never" | "date" | "count";
      repeatCount?: number | null;
      repeatWeekdays?: number[];
      reminderMode?: "global" | "none" | "at-time" | "lead" | "custom";
      reminderLeadMinutes?: number | null;
      reminderAt?: string | null;
      taskType?: "deadline" | "fixed";
      timeSpentMinutes?: number;
      timeNeededMinutes?: number;
      breakable?: boolean;
      blocksPlanning?: boolean;
    }[];
}

let deskCalendarWindow: BrowserWindow | null = null;
let launchPending: Promise<void> | null = null;
let lifecycleRevision = 0;
let refreshRevision = 0;
const mainBundleDirectory = dirname(fileURLToPath(import.meta.url));
const calendarRendererPath = join(mainBundleDirectory, "../renderer/desk-calendar.html");
const calendarUrl = (): string => process.env.ELECTRON_RENDERER_URL && !app.isPackaged
  ? new URL("desk-calendar.html", `${process.env.ELECTRON_RENDERER_URL.replace(/\/$/, "")}/`).href
  : pathToFileURL(calendarRendererPath).href;
const isCalendarFrame = (event: IpcMainEvent | IpcMainInvokeEvent, win = deskCalendarWindow): boolean =>
  !!win && !win.isDestroyed() && event.sender === win.webContents &&
  event.senderFrame === win.webContents.mainFrame && event.senderFrame?.url === calendarUrl();
const assertCalendarOrMain = (event: IpcMainInvokeEvent): void => {
  if (!isCalendarFrame(event)) assertTrustedRenderer(event);
};
let deskCalendarVisible = false;
let deskCalendarTransparency = 0.98;
let dragStartBounds: Electron.Rectangle | null = null;

interface SavedDeskCalendarGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

const hasMeaningfulVisibleArea = (geometry: SavedDeskCalendarGeometry, area: Rectangle): boolean => {
  const visibleWidth = Math.max(0, Math.min(geometry.x + geometry.width, area.x + area.width) - Math.max(geometry.x, area.x));
  const visibleHeight = Math.max(0, Math.min(geometry.y + geometry.height, area.y + area.height) - Math.max(geometry.y, area.y));
  return visibleWidth >= Math.min(160, geometry.width / 2) &&
    visibleHeight >= Math.min(120, geometry.height / 2);
};

const displaySignature = (): string => screen.getAllDisplays()
  .map((display) => `${display.workArea.x},${display.workArea.y},${display.workArea.width},${display.workArea.height}:${display.scaleFactor ?? 1}`)
  .sort()
  .join("|");

const getSavedDeskCalendarGeometry = (): SavedDeskCalendarGeometry | null => {
  const geometries = loadDesktopState<Record<string, Partial<SavedDeskCalendarGeometry>>>(
    DESK_CALENDAR_STATE_KEYS.geometries,
    {}
  );
  const parsed = geometries[displaySignature()];
  if (parsed && typeof parsed.x === "number" && typeof parsed.y === "number" &&
      typeof parsed.width === "number" && typeof parsed.height === "number") {
    return { x: parsed.x, y: parsed.y, width: parsed.width, height: parsed.height };
  }
  // One-time import of the old single-layout JSON.
  const legacy = loadDesktopState<Partial<SavedDeskCalendarGeometry>>(
    "desk-calendar-legacy-geometry",
    {},
    "desk-calendar-geometry.json"
  );
  if (typeof legacy.x === "number" && typeof legacy.y === "number" && typeof legacy.width === "number" && typeof legacy.height === "number") {
    return { x: legacy.x, y: legacy.y, width: legacy.width, height: legacy.height };
  }
  return null;
};

const saveDeskCalendarGeometry = (window: BrowserWindow): void => {
  try {
    const bounds = window.getBounds();
    // 防 WorkerW 子窗口 getBounds 异常(巨负坐标/超屏尺寸)：仅当与某显示器可见区有交集才保存，
    // 避免把异常值覆盖进有效记忆(否则恢复时窗口会跑到屏幕外)。
    const onScreen = screen.getAllDisplays().some((display) => hasMeaningfulVisibleArea(bounds, display.workArea));
    if (!onScreen) return;
    const geometries = loadDesktopState<Record<string, SavedDeskCalendarGeometry>>(
      DESK_CALENDAR_STATE_KEYS.geometries,
      {}
    );
    saveDesktopState(DESK_CALENDAR_STATE_KEYS.geometries, {
      ...geometries,
      [displaySignature()]: bounds
    });
  } catch {
    // 保存失败静默，不影响窗口。
  }
};

/** 桌历窗口恢复位置/尺寸：记忆位置若仍落在某显示器可见区则沿用；否则(含被 WorkerW 挂载污染的
 * 巨负坐标/全屏尺寸)回退主屏默认居中(940x700)，避免桌历跑到屏幕外看不到。 */
export const resolveDeskCalendarPlacement = (
  savedGeometry: SavedDeskCalendarGeometry | null,
  displays: ReadonlyArray<{ workArea: Rectangle }>,
  primaryWorkArea: Rectangle
): { width: number; height: number; x: number; y: number; useDefault: boolean } => {
  const savedVisible = savedGeometry
    ? displays.some((display) => hasMeaningfulVisibleArea(savedGeometry, display.workArea))
    : false;
  const useDefault = !savedGeometry || !savedVisible;
  const width = useDefault ? 940 : savedGeometry.width;
  const height = useDefault ? 700 : savedGeometry.height;
  const x = useDefault ? primaryWorkArea.x + Math.max(0, Math.round((primaryWorkArea.width - width) / 2)) : savedGeometry.x;
  const y = useDefault ? primaryWorkArea.y + Math.max(0, Math.round((primaryWorkArea.height - height) / 2)) : savedGeometry.y;
  return { width, height, x, y, useDefault };
};

const writeVisibilityFlag = async (visible: boolean): Promise<void> => {
  deskCalendarVisible = visible;
  saveDesktopState(DESK_CALENDAR_STATE_KEYS.visibility, { visible });
};

const toIso = (value: unknown): string | null =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) ? value : null;

// 把 ISO 字符串的时间转成"上海时区"的 HH:mm（避免 UTC 存储导致 8h 偏移）。
const shanghaiTimeOf = (iso: string): string | undefined => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return undefined;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(d);
  const h = parts.find((p) => p.type === "hour")?.value;
  const m = parts.find((p) => p.type === "minute")?.value;
  return h !== undefined && m !== undefined ? `${h}:${m}` : undefined;
};

const shanghaiDateOf = (iso: string): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date(iso));
  const record = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${record.year}-${record.month}-${record.day}`;
};

const parseDeskRangeBoundary = (value: unknown): Date | null => {
  if (typeof value !== "string") return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00+08:00` : value;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
};

const buildDeskCalendarData = async (range?: { startAt?: string; endAt?: string }): Promise<DeskCalendarData> => {
  const record = await hydrateCampusWorkspace();
  const snapshot = record.snapshot;
  const items: DeskCalendarData["items"] = [];
  const now = new Date();
  const today = shanghaiDateOf(now.toISOString());
  const rangeStart = parseDeskRangeBoundary(range?.startAt) ?? new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000);
  const rangeEnd = parseDeskRangeBoundary(range?.endAt) ?? new Date(now.getTime() + 400 * 24 * 60 * 60 * 1000);
  const calendarData = await loadUnifiedCalendarData(today, {
    startAt: shanghaiDateOf(rangeStart.toISOString()),
    endAt: shanghaiDateOf(rangeEnd.toISOString())
  }).catch(() => ({ holidays: [], weeks: {}, currentWeek: null }));
  const personalizations = loadCalendarEventPersonalizations();

  // 主题跟随主界面（原生主题）。CampusOS 主界面由 renderer 切换，这里用 nativeTheme 近似，
  // 保证桌历窗口与主界面所选主题（light/dark/high-contrast）一致。
  const theme: DeskCalendarData["theme"] = nativeTheme.shouldUseHighContrastColors
    ? "high-contrast"
    : nativeTheme.shouldUseDarkColors
      ? "dark"
      : "light";

  const canonicalEventIds = new Set(snapshot.calendarEvents?.map((event) => event.id) ?? []);
  for (const event of snapshot.calendarEvents ?? []) {
    const start = toIso(event.startAt);
    if (!start) continue;
    const end = toIso(event.endAt ?? "") ?? new Date(Date.parse(start) + 60 * 60 * 1000).toISOString();
    if (Date.parse(end) <= rangeStart.getTime() || Date.parse(start) >= rangeEnd.getTime()) continue;
    const id = `calendar:${event.id}`;
    items.push({
      id,
      title: event.title,
      date: shanghaiDateOf(start),
      kind: event.kind,
      time: shanghaiTimeOf(start),
      note: personalizations[id]?.note || event.note || undefined,
      location: event.location ?? undefined,
      origin: "upstream",
      startAt: start,
      endAt: end,
      reminderLeadMinutes: personalizations[id]?.reminderLeadMinutes ?? null
    });
  }

  for (const course of snapshot.courses ?? []) {
    if (canonicalEventIds.has(course.id)) continue;
    const start = toIso(course.startAt);
    if (!start) continue;
    const end = toIso(course.endAt) ?? new Date(Date.parse(start) + 60 * 60 * 1000).toISOString();
    if (Date.parse(end) <= rangeStart.getTime() || Date.parse(start) >= rangeEnd.getTime()) continue;
    const id = `course:${course.id}`;
    items.push({
      id,
      title: course.title,
      date: shanghaiDateOf(start),
      kind: "course",
      time: shanghaiTimeOf(start),
      color: "var(--accent)",
      note: personalizations[id]?.note || course.note || undefined,
      location: course.location ?? undefined,
      origin: "upstream",
      startAt: start,
      endAt: end,
      reminderLeadMinutes: personalizations[id]?.reminderLeadMinutes ?? null
    });
  }

  for (const deadline of snapshot.deadlines ?? []) {
    if (canonicalEventIds.has(deadline.id)) continue;
    const due = toIso(deadline.dueAt);
    if (!due) continue;
    // 截止事项一律落在 DDL 当天：此前非考试类被前移一小时、且结束时间被补成一小时后，
    // 凌晨的 DDL 会被画到前一天，与主窗口形成"跨天两条"的错觉。
    const start = due;
    const oneHourLater = new Date(Date.parse(due) + 60 * 60 * 1000).toISOString();
    const end = shanghaiDateOf(oneHourLater) === shanghaiDateOf(due) ? oneHourLater : due;
    if (Date.parse(due) <= rangeStart.getTime() || Date.parse(start) >= rangeEnd.getTime()) continue;
    const id = `deadline:${deadline.id}`;
    items.push({
      id,
      title: deadline.title,
      date: shanghaiDateOf(due),
      kind: deadline.kind === "exam" ? "exam" : "assignment",
      time: shanghaiTimeOf(start),
      color: deadline.kind === "exam" ? "#c0392b" : "#a56d22",
      note: personalizations[id]?.note || deadline.note || undefined,
      origin: "upstream",
      startAt: start,
      endAt: end,
      reminderLeadMinutes: personalizations[id]?.reminderLeadMinutes ?? null
    });
  }

  const tasks = loadScheduleTasks().tasks;
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const seenOccurrences = new Set<string>();
  for (const period of loadSchedulePeriods({ startAt: rangeStart.toISOString(), endAt: rangeEnd.toISOString() })) {
    const task = taskById.get(period.taskId);
    if (!task) continue;
    const occurrenceId = period.occurrenceId ?? period.id;
    if (seenOccurrences.has(occurrenceId)) continue;
    seenOccurrences.add(occurrenceId);
    const occurrenceStartAt = period.occurrenceStartAt ?? period.startAt;
    const occurrenceEndAt = period.occurrenceEndAt ?? period.endAt;
    const override = task.occurrenceOverrides?.[period.occurrenceKey ?? "0"];
    items.push({
      id: `task:${occurrenceId}`,
      title: period.title,
      date: shanghaiDateOf(occurrenceStartAt),
      kind: "task",
      time: shanghaiTimeOf(occurrenceStartAt),
      color: "#356b57",
      note: period.description || undefined,
      location: period.location || undefined,
      status: period.status,
      origin: "local",
      startAt: occurrenceStartAt,
      endAt: occurrenceEndAt,
      taskId: task.id,
      occurrenceKey: period.occurrenceKey,
      repeatType: task.repeatType,
      repeatPeriod: task.repeatPeriod,
      repeatEndsOn: task.repeatEndsOn,
      repeatEndMode: task.repeatEndMode,
      repeatCount: task.repeatCount,
      repeatWeekdays: task.repeatWeekdays,
      reminderMode: override?.reminderMode ?? task.reminderMode,
      reminderLeadMinutes: override?.reminderLeadMinutes ?? task.reminderLeadMinutes,
      reminderAt: resolveLocalTaskReminderAt(task, { occurrenceKey: period.occurrenceKey, startAt: occurrenceStartAt, endAt: occurrenceEndAt }),
      taskType: task.type === "fixedlegacy" ? "fixed" : task.type,
      timeSpentMinutes: override?.timeSpentMinutes ?? task.timeSpentMinutes,
      timeNeededMinutes: task.timeNeededMinutes,
      breakable: task.breakable,
      blocksPlanning: task.blocksPlanning
    });
  }

  return { today, theme, items, ...calendarData };
};

const sendDataToWindow = async (): Promise<void> => {
  const window = deskCalendarWindow;
  if (!window || window.isDestroyed()) return;
  const revision = ++refreshRevision;
  const data = await buildDeskCalendarData();
  if (revision !== refreshRevision || window !== deskCalendarWindow || window.isDestroyed()) return;
  window.webContents.send("campusos:desk-calendar:changed", data);
};

export const writeDeskCalendarFeed = async (): Promise<void> => {
  // 兼容旧 IPC 语义：外部刷新 feed 时同步推送窗口数据。
  await sendDataToWindow();
};

const applyTransparency = (): void => {
  if (!deskCalendarWindow || deskCalendarWindow.isDestroyed()) return;
  deskCalendarWindow.setOpacity(deskCalendarTransparency);
};

const createDeskCalendarWindow = async (): Promise<BrowserWindow> => {
  const primary = screen.getPrimaryDisplay();
  const placement = resolveDeskCalendarPlacement(getSavedDeskCalendarGeometry(), screen.getAllDisplays(), primary.workArea);
  const bx = placement.x;
  const by = placement.y;
  const winWidth = placement.width;
  const winHeight = placement.height;

  const settings = loadDeskCalendarSettings();
  const win = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    x: bx,
    y: by,
    transparent: true,
    frame: false,
    resizable: !settings.locked,
    hasShadow: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      session: getAccountBrowserSession(),
      preload: join(mainBundleDirectory, "../preload/deskCalendar.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  // 保持可交互的桌面层级：桌面之上、普通应用之下，不提供置顶模式。
  win.setMenu(null);
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => { if (url !== calendarUrl()) event.preventDefault(); });
  win.webContents.on("will-redirect", (event) => event.preventDefault());
  deskCalendarTransparency = settings.opacity;
  win.setOpacity(settings.opacity);
  win.setMovable(!settings.locked);
  pinWindowToDesktopBottom(win);

  // 几何记忆：移动/缩放/关闭时保存，下次按记忆恢复。
  const persistGeometry = (): void => saveDeskCalendarGeometry(win);
  win.on("move", persistGeometry);
  win.on("resize", persistGeometry);
  win.on("closed", () => {
    if (deskCalendarWindow === win) {
      deskCalendarWindow = null;
      deskCalendarVisible = false;
      refreshRevision++;
    }
  });
  win.on("close", persistGeometry);

  // 拖动：缓存起点 + 总位移，锁死宽高（避免 Windows 缩放下 DIP↔像素取整累积放大）。
  const fromThisWindow = (event: IpcMainEvent): boolean => isCalendarFrame(event, win);
  const onDragMove = (event: IpcMainEvent, payload: unknown): void => {
    const { dx, dy } = (payload ?? {}) as { dx?: number; dy?: number };
    if (!fromThisWindow(event) || loadDeskCalendarSettings().locked) return;
    if (typeof dx !== "number" || typeof dy !== "number" || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
    if (!dragStartBounds) dragStartBounds = win.getBounds();
    win.setBounds({
      x: dragStartBounds.x + Math.round(dx),
      y: dragStartBounds.y + Math.round(dy),
      width: dragStartBounds.width,
      height: dragStartBounds.height
    });
  };
  const onDragEnd = (event: IpcMainEvent): void => {
    if (fromThisWindow(event)) dragStartBounds = null;
  };
  const onTransparency = (event: IpcMainEvent, value: unknown): void => {
    if (fromThisWindow(event) && typeof value === "number" && value >= 0.3 && value <= 1) {
      deskCalendarTransparency = value;
      applyTransparency();
    }
  };
  const onClose = (event: IpcMainEvent): void => {
    if (fromThisWindow(event)) void closeDeskCalendar();
  };
  ipcMain.on("campusos:desk-calendar:drag-move", onDragMove);
  ipcMain.on("campusos:desk-calendar:drag-end", onDragEnd);
  ipcMain.on("campusos:desk-calendar:transparency", onTransparency);
  ipcMain.on("campusos:desk-calendar:close", onClose);
  win.once("closed", () => {
    dragStartBounds = null;
    ipcMain.removeListener("campusos:desk-calendar:drag-move", onDragMove);
    ipcMain.removeListener("campusos:desk-calendar:drag-end", onDragEnd);
    ipcMain.removeListener("campusos:desk-calendar:transparency", onTransparency);
    ipcMain.removeListener("campusos:desk-calendar:close", onClose);
  });

  return win;
};

export const launchDeskCalendar = (): Promise<void> => {
  if (launchPending) return launchPending;
  const revision = ++lifecycleRevision;
  const operation = (async () => {
    await writeVisibilityFlag(true);
    if (revision !== lifecycleRevision) return;
    if (deskCalendarWindow && !deskCalendarWindow.isDestroyed()) {
      deskCalendarWindow.showInactive();
      return;
    }
    const win = await createDeskCalendarWindow();
    if (revision !== lifecycleRevision) { win.destroy(); return; }
    deskCalendarWindow = win;
    try {
      if (process.env.ELECTRON_RENDERER_URL && !app.isPackaged) await win.loadURL(calendarUrl());
      else await win.loadFile(calendarRendererPath);
      if (revision !== lifecycleRevision || win.isDestroyed()) return;
      win.showInactive();
      await sendDataToWindow();
    } catch (error) {
      if (!win.isDestroyed()) win.destroy();
      throw error;
    }
  })();
  launchPending = operation;
  void operation.finally(() => { if (launchPending === operation) launchPending = null; }).catch(() => undefined);
  return operation;
};

/** 打开桌历的设置面板：确保桌历窗口存在并显示，然后通知渲染层打开设置。 */
export const openDeskCalendarSettings = async (): Promise<void> => {
  await launchDeskCalendar();
  if (deskCalendarWindow && !deskCalendarWindow.isDestroyed()) {
    deskCalendarWindow.showInactive();
    deskCalendarWindow.webContents.send("campusos:desk-calendar:open-settings");
  }
};

/** 关闭（隐藏/销毁）：真正销毁窗口，避免贴底守护把隐藏窗口重新拉回（问题：点关闭后又弹出）。 */
export const closeDeskCalendar = async (): Promise<void> => {
  lifecycleRevision++;
  launchPending = null;
  await writeVisibilityFlag(false);
  if (deskCalendarWindow && !deskCalendarWindow.isDestroyed()) {
    deskCalendarWindow.destroy();
  }
  deskCalendarWindow = null;
};

/** 应用退出时销毁桌面日历窗口。 */
export const killDeskCalendar = (): void => {
  lifecycleRevision++;
  launchPending = null;
  if (deskCalendarWindow && !deskCalendarWindow.isDestroyed()) {
    deskCalendarWindow.destroy();
  }
  deskCalendarWindow = null;
};

export const isDeskCalendarRunning = (): boolean =>
  deskCalendarVisible && deskCalendarWindow !== null && !deskCalendarWindow.isDestroyed();

export const enforceDeskCalendarAutoStartDependency = (campusAutoStartEnabled: boolean): void => {
  enforceCampusAutoStartDependency(campusAutoStartEnabled);
  if (deskCalendarWindow && !deskCalendarWindow.isDestroyed()) {
    deskCalendarWindow.webContents.send("campusos:desk-calendar:settings-changed", loadDeskCalendarSettings());
  }
};

export const restoreDeskCalendarOnCampusStart = async (): Promise<void> => {
  const settings = loadDeskCalendarSettings();
  if (settings.campusAutoStartEnabled && settings.autoStart) await launchDeskCalendar();
};

export const registerDeskCalendarHostHandlers = (): void => {

  registerWindowIpcHandler("campusos:desk-calendar:process:start", assertCalendarOrMain, async () => {
    await launchDeskCalendar();
    return { running: isDeskCalendarRunning() };
  });
  registerWindowIpcHandler("campusos:desk-calendar:process:stop", assertCalendarOrMain, async () => {
    await closeDeskCalendar();
    return { running: false };
  });
  registerWindowIpcHandler("campusos:desk-calendar:process:status", assertCalendarOrMain, async () => ({
    running: isDeskCalendarRunning()
  }));
  registerWindowIpcHandler("campusos:desk-calendar:data", assertCalendarOrMain, async (_event, range) => buildDeskCalendarData((range ?? {}) as { startAt?: string; endAt?: string }));
  registerWindowIpcHandler("campusos:desk-calendar:settings:load", assertCalendarOrMain, async () => loadDeskCalendarSettings());
  registerWindowIpcHandler("campusos:desk-calendar:settings:save", assertCalendarOrMain, async (_event, patch) => {
    const next = saveDeskCalendarSettings((patch ?? {}) as Partial<DeskCalendarSettings>);
    deskCalendarTransparency = next.opacity;
    applyTransparency();
    if (deskCalendarWindow && !deskCalendarWindow.isDestroyed()) {
      deskCalendarWindow.setResizable(!next.locked);
      deskCalendarWindow.setMovable(!next.locked);
      deskCalendarWindow.webContents.send("campusos:desk-calendar:settings-changed", next);
    }
    return next;
  });
  registerWindowIpcHandler("campusos:desk-calendar:complete-task", assertCalendarOrMain, async (_event, id, completed, occurrenceKey) => {
    if (typeof id !== "string" || !id) return { ok: false, error: "任务不存在。" };
    try {
      // completed=true -> 置为 completed；false -> restore（按类型回退为 running/overdue/running）。
      await mutateScheduleTask(completed
        ? { id, status: "completed", ...(typeof occurrenceKey === "string" ? { occurrenceKey } : {}) }
        : { id, action: "restore", ...(typeof occurrenceKey === "string" ? { occurrenceKey } : {}) });
      await sendDataToWindow();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "操作失败。" };
    }
  });
  registerWindowIpcHandler("campusos:desk-calendar:save-event", assertCalendarOrMain, async (_event, input) => {
    try {
    const { id, origin, taskId, occurrenceKey, editScope, date, title, startAt, endAt, location, note, reminderMode, reminderLeadMinutes, reminderAt, type, timeSpentMinutes, timeNeededMinutes, breakable, blocksPlanning, repeatType, repeatPeriod, repeatEndsOn, repeatEndMode, repeatCount, repeatWeekdays } = (input ?? {}) as {
      id?: string;
      origin?: "local" | "upstream";
      taskId?: string;
      occurrenceKey?: string;
      editScope?: "single" | "future" | "series";
      date: string;
      title: string;
      startAt?: string;
      endAt?: string;
      location?: string;
      note?: string;
      reminderLeadMinutes?: number;
      reminderMode?: "global" | "none" | "at-time" | "lead" | "custom";
      reminderAt?: string | null;
      type?: "deadline" | "fixed";
      timeSpentMinutes?: number;
      timeNeededMinutes?: number;
      breakable?: boolean;
      blocksPlanning?: boolean;
      repeatType?: "norepeat" | "days" | "weeks" | "weekdays" | "month" | "year";
      repeatPeriod?: number;
      repeatEndsOn?: string;
      repeatEndMode?: "never" | "date" | "count";
      repeatCount?: number | null;
      repeatWeekdays?: number[];
    };
    if (origin === "upstream") {
      if (!id) return { ok: false, error: "事件不存在。" };
      saveCalendarEventPersonalization(id, { note, reminderLeadMinutes: reminderLeadMinutes ?? null });
      await sendDataToWindow();
      return { ok: true };
    }
    if (!date || !title) return { ok: false, error: "日期和名称不能为空。" };
    // 默认只在当日新增（用户双击某天时）；重复类型仅在显式选择时使用。
    // repeatEndsOn 必须是有效日期（scheduleDomain 校验不接受空串），用当天；
    // reminderAt 若开提醒则给当天一个时间。
    const dayStart = `${date}T00:00:00+08:00`;
    const dayEnd = `${date}T23:59:59+08:00`;
    await saveScheduleTask({
      ...(taskId ? { id: taskId } : {}),
      title,
      description: note ?? "",
      startAt: calendarInputTime(startAt ?? dayStart),
      endAt: calendarInputTime(endAt ?? dayEnd),
      location: location ?? "",
      type: type ?? "deadline",
      repeatType: repeatType ?? "norepeat",
      repeatPeriod: Math.max(1, repeatPeriod ?? 1),
      repeatEndsOn: repeatEndsOn ?? date,
      repeatEndMode: repeatEndMode ?? (repeatType === "norepeat" || !repeatType ? "date" : "never"),
      repeatCount: repeatEndMode === "count" ? Math.max(1, repeatCount ?? 1) : null,
      repeatWeekdays: repeatWeekdays ?? [],
      editScope,
      occurrenceKey,
      breakable: breakable ?? true,
      blocksPlanning: blocksPlanning ?? true,
      timeSpentMinutes: Math.max(0, timeSpentMinutes ?? 0),
      timeNeededMinutes: Math.max(1, timeNeededMinutes ?? 60),
      reminderMode: reminderMode ?? (reminderLeadMinutes != null ? "lead" : "none"),
      reminderLeadMinutes: reminderMode === "lead" || (!reminderMode && reminderLeadMinutes != null) ? reminderLeadMinutes ?? 15 : null,
      reminderAt: reminderMode === "custom" && reminderAt ? calendarInputTime(reminderAt) : null
    });
    await sendDataToWindow();
    return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "日程保存失败。" };
    }
  });
  // Compatibility for older renderer bundles during an application update.
  registerWindowIpcHandler("campusos:desk-calendar:create-event", assertCalendarOrMain, async (_event, input) => {
    const handlerInput = (input ?? {}) as Record<string, unknown>;
    const { date, title } = handlerInput;
    if (typeof date !== "string" || typeof title !== "string" || !date || !title) return { ok: false, error: "日期和名称不能为空。" };
    await saveScheduleTask({
      title, description: typeof handlerInput.note === "string" ? handlerInput.note : "",
      startAt: typeof handlerInput.startAt === "string" ? handlerInput.startAt : `${date}T00:00:00+08:00`,
      endAt: typeof handlerInput.endAt === "string" ? handlerInput.endAt : `${date}T23:59:59+08:00`,
      location: typeof handlerInput.location === "string" ? handlerInput.location : "",
      type: "deadline", repeatType: "norepeat", repeatPeriod: 1, repeatEndsOn: date,
      repeatEndMode: "date", repeatCount: null, repeatWeekdays: [], breakable: true,
      blocksPlanning: false, timeSpentMinutes: 0, timeNeededMinutes: 1,
      reminderMode: Number.isFinite(handlerInput.reminderLeadMinutes) ? "lead" : "none",
      reminderLeadMinutes: Number.isFinite(handlerInput.reminderLeadMinutes) ? Number(handlerInput.reminderLeadMinutes) : null,
      reminderAt: null
    });
    await sendDataToWindow();
    return { ok: true };
  });
  registerWindowIpcHandler("campusos:desk-calendar:feed:refresh", assertCalendarOrMain, async () => {
    await sendDataToWindow();
    return { ok: true };
  });
};
