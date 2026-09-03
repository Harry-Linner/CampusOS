import { mkdir as mkdirAsync, writeFile as writeFileAsync } from "node:fs/promises";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { app, BrowserWindow, ipcMain, nativeTheme, screen, type Rectangle } from "electron";
import { hydrateCampusWorkspace } from "./campusWorkspaceStore";
import { loadScheduleTasks, saveScheduleTask, mutateScheduleTask } from "./scheduleIpc";
import { pinWindowToDesktopBottom } from "./desktopPinning";
import { loadAcademicCalendarSettings } from "./academicCalendarStore";

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
  }[];
}

let deskCalendarWindow: BrowserWindow | null = null;
let deskCalendarVisible = false;
let deskCalendarTransparency = 0.98;
let dragStartBounds: Electron.Rectangle | null = null;

// 桌历窗口几何记忆（简化：单份 json；阶段2可按显示器签名记忆）。
const GEOMETRY_FILE = "desk-calendar-geometry.json";
const getGeometryPath = (): string =>
  join(app.getPath("userData"), "settings", GEOMETRY_FILE);

interface SavedDeskCalendarGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

const getSavedDeskCalendarGeometry = (): SavedDeskCalendarGeometry | null => {
  try {
    const parsed = JSON.parse(readFileSync(getGeometryPath(), "utf8")) as Partial<SavedDeskCalendarGeometry>;
    if (
      typeof parsed.x === "number" && typeof parsed.y === "number" &&
      typeof parsed.width === "number" && typeof parsed.height === "number"
    ) {
      return { x: parsed.x, y: parsed.y, width: parsed.width, height: parsed.height };
    }
  } catch {
    // 无存档/不可读 -> 用默认
  }
  return null;
};

const saveDeskCalendarGeometry = (window: BrowserWindow): void => {
  try {
    const bounds = window.getBounds();
    mkdirSync(dirname(getGeometryPath()), { recursive: true });
    writeFileSync(getGeometryPath(), JSON.stringify(bounds, null, 2), "utf8");
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
    ? displays.some((display) => {
      const area = display.workArea;
      return Math.max(savedGeometry.x, area.x) < Math.min(savedGeometry.x + savedGeometry.width, area.x + area.width) &&
        Math.max(savedGeometry.y, area.y) < Math.min(savedGeometry.y + savedGeometry.height, area.y + area.height);
    })
    : false;
  const useDefault = !savedGeometry || !savedVisible;
  const width = useDefault ? 940 : savedGeometry.width;
  const height = useDefault ? 700 : savedGeometry.height;
  const x = useDefault ? primaryWorkArea.x + Math.max(0, Math.round((primaryWorkArea.width - width) / 2)) : savedGeometry.x;
  const y = useDefault ? primaryWorkArea.y + Math.max(0, Math.round((primaryWorkArea.height - height) / 2)) : savedGeometry.y;
  return { width, height, x, y, useDefault };
};

const getVisibilityPath = (): string =>
  join(app.getPath("userData"), "desk-calendar-visible.json");

const writeVisibilityFlag = async (visible: boolean): Promise<void> => {
  deskCalendarVisible = visible;
  const path = getVisibilityPath();
  await mkdirAsync(dirname(path), { recursive: true });
  await writeFileAsync(path, JSON.stringify({ visible }), "utf8");
};

const dateOf = (iso: string): string => iso.slice(0, 10);
const timeOf = (iso: string): string | undefined => {
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[1]}:${m[2]}` : undefined;
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

const buildDeskCalendarData = async (): Promise<DeskCalendarData> => {
  const record = await hydrateCampusWorkspace();
  const snapshot = record.snapshot;
  const items: DeskCalendarData["items"] = [];

  // 法定节假日/补班（来自 academic-calendar 设置），供月历格子标注。
  let holidays: DeskCalendarData["holidays"] = [];
  try {
    const cal = await loadAcademicCalendarSettings();
    holidays = [
      ...(cal.statutoryHolidays ?? []).map((h) => ({ date: h.date, label: h.label, holiday: true })),
      ...(cal.makeupDays ?? []).map((m) => ({ date: m.date, label: `补班`, holiday: false }))
    ];
  } catch {
    holidays = [];
  }

  // 主题跟随主界面（原生主题）。CampusOS 主界面由 renderer 切换，这里用 nativeTheme 近似，
  // 保证桌历窗口与主界面所选主题（light/dark/high-contrast）一致。
  const theme: DeskCalendarData["theme"] = nativeTheme.shouldUseHighContrastColors
    ? "high-contrast"
    : nativeTheme.shouldUseDarkColors
      ? "dark"
      : "light";

  for (const course of snapshot.courses ?? []) {
    const start = toIso(course.startAt);
    if (!start) continue;
    items.push({
      id: `course:${course.id}`,
      title: course.title,
      date: dateOf(start),
      kind: "course",
      time: timeOf(start) ?? undefined,
      color: "var(--accent)",
      note: course.note ?? undefined,
      location: course.location ?? undefined
    });
  }

  for (const deadline of snapshot.deadlines ?? []) {
    const due = toIso(deadline.dueAt);
    if (!due) continue;
    items.push({
      id: `deadline:${deadline.id}`,
      title: deadline.title,
      date: dateOf(due),
      kind: deadline.kind === "exam" ? "exam" : "assignment",
      time: timeOf(due) ?? undefined,
      color: deadline.kind === "exam" ? "#c0392b" : "#a56d22",
      note: deadline.note ?? undefined
    });
  }

  for (const task of loadScheduleTasks().tasks) {
    if (task.status === "deleted") continue;
    const start = toIso(task.startAt);
    if (!start) continue;
    items.push({
      id: `task:${task.id}`,
      title: task.title,
      date: dateOf(start),
      kind: "task",
      time: shanghaiTimeOf(start) ?? undefined,
      color: "#356b57",
      status: task.status
    });
  }

  // 校历周次（解析好的 json，这里用占位：由校历 provider 提供，暂空）
  const weeks: DeskCalendarData["weeks"] = {};
  const currentWeek: number | null = null;
  const today = new Date().toISOString().slice(0, 10);

  return { today, holidays, theme, items, weeks, currentWeek };
};

const sendDataToWindow = async (): Promise<void> => {
  if (!deskCalendarWindow || deskCalendarWindow.isDestroyed()) return;
  const data = await buildDeskCalendarData();
  deskCalendarWindow.webContents.send("campusos:desk-calendar:changed", data);
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

  const win = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    x: bx,
    y: by,
    transparent: true,
    frame: false,
    resizable: true,
    hasShadow: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: join(app.getAppPath(), "out/preload/deskCalendar.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  // 贴底：壁纸之上、其它窗口之下（含 Win+D 自愈守护）。千万不用 setAlwaysOnTop。
  win.setMenu(null);
  win.setOpacity(deskCalendarTransparency);
  pinWindowToDesktopBottom(win);

  // 几何记忆：移动/缩放/关闭时保存，下次按记忆恢复。
  const persistGeometry = (): void => saveDeskCalendarGeometry(win);
  win.on("move", persistGeometry);
  win.on("resize", persistGeometry);
  win.on("closed", () => {
    deskCalendarWindow = null;
  });
  win.on("close", persistGeometry);

  // 拖动：缓存起点 + 总位移，锁死宽高（避免 Windows 缩放下 DIP↔像素取整累积放大）。
  ipcMain.on("campusos:desk-calendar:drag-move", (_event, payload) => {
    const { dx, dy } = (payload ?? {}) as { dx?: number; dy?: number };
    if (!win || win.isDestroyed()) return;
    if (!dragStartBounds) dragStartBounds = win.getBounds();
    win.setBounds({
      x: dragStartBounds.x + Math.round(dx ?? 0),
      y: dragStartBounds.y + Math.round(dy ?? 0),
      width: dragStartBounds.width,
      height: dragStartBounds.height
    });
  });
  ipcMain.on("campusos:desk-calendar:drag-end", () => {
    dragStartBounds = null;
  });
  ipcMain.on("campusos:desk-calendar:transparency", (_event, value) => {
    if (typeof value === "number" && value >= 0.3 && value <= 1) {
      deskCalendarTransparency = value;
      applyTransparency();
    }
  });
  ipcMain.on("campusos:desk-calendar:close", () => {
    if (win && !win.isDestroyed()) win.close();
  });

  return win;
};

export const launchDeskCalendar = async (): Promise<void> => {
  await writeVisibilityFlag(true);
  if (deskCalendarWindow && !deskCalendarWindow.isDestroyed()) {
    deskCalendarWindow.showInactive();
    return;
  }
  const win = await createDeskCalendarWindow();
  deskCalendarWindow = win;
  if (app.isPackaged) {
    await win.loadFile(join(__dirname, "../renderer/desk-calendar.html"));
  } else {
    const rendererUrl = process.env.ELECTRON_RENDERER_URL;
    if (rendererUrl) {
      await win.loadURL(`${rendererUrl}/desk-calendar.html`);
    } else {
      await win.loadFile(join(__dirname, "../renderer/desk-calendar.html"));
    }
  }
  win.showInactive();
  await sendDataToWindow();
};

/** 关闭（隐藏/销毁）：真正销毁窗口，避免贴底守护把隐藏窗口重新拉回（问题：点关闭后又弹出）。 */
export const closeDeskCalendar = async (): Promise<void> => {
  await writeVisibilityFlag(false);
  if (deskCalendarWindow && !deskCalendarWindow.isDestroyed()) {
    deskCalendarWindow.destroy();
  }
  deskCalendarWindow = null;
};

/** 应用退出时销毁桌面日历窗口。 */
export const killDeskCalendar = (): void => {
  if (deskCalendarWindow && !deskCalendarWindow.isDestroyed()) {
    deskCalendarWindow.destroy();
  }
  deskCalendarWindow = null;
};

export const isDeskCalendarRunning = (): boolean => deskCalendarVisible;

export const registerDeskCalendarHostHandlers = (): void => {
  ipcMain.handle("campusos:desk-calendar:process:start", async () => {
    await launchDeskCalendar();
    return { running: isDeskCalendarRunning() };
  });
  ipcMain.handle("campusos:desk-calendar:process:stop", async () => {
    await closeDeskCalendar();
    return { running: false };
  });
  ipcMain.handle("campusos:desk-calendar:process:status", async () => ({
    running: isDeskCalendarRunning()
  }));
  ipcMain.handle("campusos:desk-calendar:data", async () => buildDeskCalendarData());
  ipcMain.handle("campusos:desk-calendar:complete-task", async (_event, id, completed) => {
    if (typeof id !== "string" || !id) return { ok: false, error: "任务不存在。" };
    try {
      // completed=true -> 置为 completed；false -> restore（按类型回退为 running/overdue/running）。
      await mutateScheduleTask(completed ? { id, status: "completed" } : { id, action: "restore" });
      await sendDataToWindow();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "操作失败。" };
    }
  });
  ipcMain.handle("campusos:desk-calendar:create-event", async (_event, input) => {
    const { date, title, startAt, endAt, location, note, reminderLeadMinutes } = (input ?? {}) as {
      date: string;
      title: string;
      startAt?: string;
      endAt?: string;
      location?: string;
      note?: string;
      reminderLeadMinutes?: number;
    };
    if (!date || !title) return { ok: false, error: "日期和名称不能为空。" };
    // 默认只在当日新增（用户双击某天时）；重复类型仅在显式选择时使用。
    // repeatEndsOn 必须是有效日期（scheduleDomain 校验不接受空串），用当天；
    // reminderAt 若开提醒则给当天一个时间。
    const dayStart = `${date}T00:00:00+08:00`;
    const dayEnd = `${date}T23:59:59+08:00`;
    await saveScheduleTask({
      title,
      description: note ?? "",
      startAt: startAt ?? dayStart,
      endAt: endAt ?? dayEnd,
      location: location ?? "",
      type: "deadline",
      repeatType: "norepeat",
      repeatPeriod: 1,
      repeatEndsOn: date,
      breakable: true,
      blocksPlanning: false,
      timeSpentMinutes: 0,
      timeNeededMinutes: 0,
      reminderMode: reminderLeadMinutes != null ? "lead" : "none",
      reminderLeadMinutes: reminderLeadMinutes ?? null,
      reminderAt: null
    });
    await sendDataToWindow();
    return { ok: true };
  });
  ipcMain.handle("campusos:desk-calendar:feed:refresh", async () => {
    await sendDataToWindow();
    return { ok: true };
  });
};
