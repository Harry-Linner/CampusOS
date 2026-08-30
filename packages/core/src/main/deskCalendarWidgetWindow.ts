import { BrowserWindow, ipcMain, screen } from "electron";
import { join } from "node:path";
import type {
  DeskCalendarSettings,
  DeskCalendarWidgetData,
  DeskCalendarWidgetId
} from "@campusos/shared";
import { assertTrustedDeskCalendarWidgetCaller } from "./ipcSecurity";
import { pinWindowToDesktopBottom } from "./desktopPinning";
import { attachWindowStatePersistence, loadWindowState } from "./windowStateStore";
import { useE2eFixtureSources } from "./officialAcademicCalendarRequest";
import {
  broadcastSettingsChanged,
  isDeskCalendarAppQuitting,
  isVisibleOnCurrentDisplays,
  loadSettings,
  refreshWeather,
  saveSettings
} from "./deskCalendarWindow";

/**
 * B3 独立悬浮组件窗管理器（DeskToDo 式）。
 *
 * 时钟/天气/倒计时/进度条各自是一个透明、贴底、无边框的独立 BrowserWindow，
 * 可整窗拖拽摆放（-webkit-app-region: drag），位置由 windowStateStore 记忆。
 * 桌面日历启用时按 settings.widgets[].enabled 同步创建/销毁；组件窗关闭（或禁用）
 * 即持久化禁用该组件。组件窗不消费工作区快照，只读自己需要的设置子集。
 */

const WIDGET_SIZES: Record<DeskCalendarWidgetId, { width: number; height: number }> = {
  clock: { width: 220, height: 84 },
  weather: { width: 280, height: 190 },
  countdown: { width: 260, height: 120 },
  progress: { width: 260, height: 120 }
};

const WIDGET_STATE_KEY: Record<DeskCalendarWidgetId, string> = {
  clock: "desk-calendar-widget-clock",
  weather: "desk-calendar-widget-weather",
  countdown: "desk-calendar-widget-countdown",
  progress: "desk-calendar-widget-progress"
};

const WIDGET_ORDER: readonly DeskCalendarWidgetId[] = ["clock", "weather", "countdown", "progress"];

const componentWindows = new Map<DeskCalendarWidgetId, BrowserWindow>();
const widgetIdByWebContentsId = new Map<number, DeskCalendarWidgetId>();
/** 桌历整体禁用/组件关闭伴随销毁时，不应再把组件标记为禁用（单独关窗才禁用）。 */
const suppressedDisable = new Set<DeskCalendarWidgetId>();

const defaultBounds = (id: DeskCalendarWidgetId): { x: number; y: number; width: number; height: number } => {
  const { width, height } = WIDGET_SIZES[id];
  const workArea = screen.getPrimaryDisplay().workArea;
  const index = WIDGET_ORDER.indexOf(id);
  return {
    x: workArea.x + workArea.width - width - 24 - index * 16,
    y: workArea.y + 24 + index * 32,
    width,
    height
  };
};

const disableWidget = async (id: DeskCalendarWidgetId): Promise<void> => {
  const current = await loadSettings();
  const nextWidgets = current.widgets.map((widget) =>
    widget.id === id ? { ...widget, enabled: false } : widget
  );
  await saveSettings({ widgets: nextWidgets });
  broadcastSettingsChanged();
  // 窗口自身已关闭；此处仅需确保 map 状态一致（其余组件状态由 syncWidgetWindows 兜底）。
  componentWindows.delete(id);
};

const createComponentWindow = async (
  id: DeskCalendarWidgetId
): Promise<BrowserWindow> => {
  const { width, height } = WIDGET_SIZES[id];
  const stored = await loadWindowState(WIDGET_STATE_KEY[id], {
    minimumWidth: width,
    minimumHeight: height
  });
  const bounds =
    stored?.bounds && isVisibleOnCurrentDisplays(stored.bounds)
      ? stored.bounds
      : defaultBounds(id);

  const window = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width,
    height,
    minWidth: width,
    minHeight: height,
    maxWidth: width,
    maxHeight: height,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    // 对照 DeskToDo 的 Qt.Tool：不进任务栏/Alt-Tab，配合贴底悬浮在壁纸之上。
    type: "toolbar",
    skipTaskbar: true,
    resizable: false,
    movable: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/deskCalendarWidget.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  window.setMenu(null);
  pinWindowToDesktopBottom(window);
  // "closed" 事件触发时 window.webContents 已销毁，此时再访问
  // window.webContents.id 会抛 "Object has been destroyed"，每个组件窗关闭都会
  // 触发一次未捕获异常，导致主进程连弹原生错误对话框（实测 4 组件窗 = 4 弹窗）。
  // webContents id 必须在窗口存活时捕获，供 closed 处理器清理映射。
  const webContentsId = window.webContents.id;
  widgetIdByWebContentsId.set(webContentsId, id);
  const detach = attachWindowStatePersistence(window, WIDGET_STATE_KEY[id]);
  window.on("closed", () => {
    widgetIdByWebContentsId.delete(webContentsId);
    detach();
    // 整体禁用/伴随销毁时 suppressedDisable 命中 → 不改设置；单独关组件窗才禁用该组件。
    if (suppressedDisable.delete(id)) return;
    if (!isDeskCalendarAppQuitting()) void disableWidget(id);
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    await window.loadURL(
      new URL("desk-calendar-widget.html", process.env.ELECTRON_RENDERER_URL).toString()
    );
  } else {
    await window.loadFile(
      join(__dirname, "../renderer/desk-calendar-widget.html")
    );
  }

  window.showInactive();
  return window;
};

/** 根据桌历设置同步组件窗：启用的创建，禁用/桌历关闭的销毁。 */
export const syncWidgetWindows = (settings: DeskCalendarSettings): void => {
  // e2e fixture（headless，无真实桌面）下不创建组件窗：组件窗是透明 + Win32 贴底的桌面
  // overlay，仅在有真实桌面的运行环境有意义；其功能由单元测试与 CDP 视觉验收覆盖，
  // 避免 headless e2e 因创建/销毁组件窗产生框架错误、干扰桌历导航/布局回归。
  if (useE2eFixtureSources()) return;
  const enabledIds = new Set<DeskCalendarWidgetId>(
    settings.enabled
      ? settings.widgets.filter((widget) => widget.enabled).map((widget) => widget.id)
      : []
  );
  for (const id of [...componentWindows.keys()]) {
    if (!enabledIds.has(id)) {
      const window = componentWindows.get(id);
      if (window) {
        suppressedDisable.add(id);
        window.close();
      }
      componentWindows.delete(id);
    }
  }
  for (const id of enabledIds) {
    if (!componentWindows.has(id)) {
      void createComponentWindow(id)
        .then((window) => {
          componentWindows.set(id, window);
        })
        .catch(() => undefined);
    }
  }
};

const loadWidgetData = async (
  id: DeskCalendarWidgetId
): Promise<DeskCalendarWidgetData> => {
  const settings = await loadSettings();
  return {
    id,
    enabled: settings.widgets.find((widget) => widget.id === id)?.enabled ?? false,
    countdowns: settings.countdowns,
    progress: settings.progress,
    weather: settings.weather,
    appearance: settings.appearance
  };
};

const widgetIdFromSender = (sender: Electron.WebContents): DeskCalendarWidgetId | null =>
  widgetIdByWebContentsId.get(sender.id) ?? null;

export const registerDeskCalendarWidgetHandlers = (): void => {
  ipcMain.handle("campusos:desk-calendar-widget:data:load", async (event) => {
    assertTrustedDeskCalendarWidgetCaller(event);
    const id = widgetIdFromSender(event.sender);
    if (!id) throw new Error("未知的桌面组件窗口。");
    return loadWidgetData(id);
  });

  ipcMain.handle("campusos:desk-calendar-widget:weather:refresh", async (event) => {
    assertTrustedDeskCalendarWidgetCaller(event);
    // 复用桌历的天气刷新（真实 Open-Meteo + 缓存/错误态），组件窗同样消费正式数据。
    const weather = await refreshWeather();
    broadcastSettingsChanged();
    return weather;
  });

  ipcMain.handle("campusos:desk-calendar-widget:settings:update", async (event, input: unknown) => {
    assertTrustedDeskCalendarWidgetCaller(event);
    const patch = typeof input === "object" && input !== null
      ? input as Partial<Omit<DeskCalendarSettings, "savedAt" | "storagePath">>
      : {};
    const next = await saveSettings(patch);
    broadcastSettingsChanged();
    // 组件窗删除倒计时/进度条等动作会改 settings.widgets 之外数组；无需重建窗，广播即可。
    return next;
  });

  ipcMain.handle("campusos:desk-calendar-widget:close", async (event) => {
    assertTrustedDeskCalendarWidgetCaller(event);
    const id = widgetIdFromSender(event.sender);
    const window = id !== null ? componentWindows.get(id) : null;
    if (window && !window.isDestroyed()) window.close();
  });
};
