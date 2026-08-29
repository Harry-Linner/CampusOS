import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeskCalendarSettings, DeskCalendarWidgetId } from "@campusos/shared";

const electronState = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  windows: [] as Array<{
    webContents: { id: number; send: ReturnType<typeof vi.fn> };
    show: ReturnType<typeof vi.fn>;
    showInactive: ReturnType<typeof vi.fn>;
    focus: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    isDestroyed: () => boolean;
    loadURL: ReturnType<typeof vi.fn>;
    loadFile: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    getNativeWindowHandle: ReturnType<typeof vi.fn>;
    setMenu: ReturnType<typeof vi.fn>;
    getNormalBounds: ReturnType<typeof vi.fn>;
    isMaximized: ReturnType<typeof vi.fn>;
    listeners: Map<string, () => void>;
    nextWebContentsId: number;
  }>
}));

vi.mock("koffi", () => ({
  default: { load: () => ({ func: () => vi.fn(() => true) }) }
}));

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "") },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      electronState.handlers.set(channel, handler);
    })
  },
  screen: {
    getPrimaryDisplay: vi.fn(() => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }))
  },
  BrowserWindow: Object.assign(
    vi.fn().mockImplementation(() => {
      const window = {
        webContents: { id: electronState.windows.length, send: vi.fn() },
        show: vi.fn(),
        showInactive: vi.fn(),
        focus: vi.fn(),
        close: vi.fn(),
        isDestroyed: () => false,
        listeners: new Map<string, () => void>(),
        on: vi.fn(),
        loadURL: vi.fn(async () => undefined),
        loadFile: vi.fn(async () => undefined),
        getNativeWindowHandle: vi.fn(() => {
          const handle = Buffer.alloc(8);
          handle.writeBigUInt64LE(0x5678n, 0);
          return handle;
        }),
        setMenu: vi.fn(),
        getNormalBounds: vi.fn(() => ({ x: 0, y: 0, width: 220, height: 84 })),
        isMaximized: vi.fn(() => false),
        nextWebContentsId: electronState.windows.length
      };
      electronState.windows.push(window);
      return window;
    }),
    { getAllWindows: () => electronState.windows }
  )
}));

const defaultSettings = (overrides?: Partial<Record<DeskCalendarWidgetId, boolean>>): DeskCalendarSettings => ({
  enabled: true,
  view: "month",
  showClock: true,
  widgets: (["clock", "weather", "countdown", "progress"] as const).map((id) => ({
    id,
    enabled: overrides?.[id] ?? true
  })),
  countdowns: [{ id: "c1", title: "开学", targetAt: "2026-09-01T00:00:00.000Z" }],
  progress: [{ id: "p1", title: "学期", startAt: "2026-02-01T00:00:00.000Z", endAt: "2026-07-01T00:00:00.000Z" }],
  weather: { location: "Hangzhou", temperatureC: 25, weatherCode: 1, observedAt: "2026-08-15T04:00:00.000Z", cachedAt: "2026-08-15T04:00:00.000Z", error: null },
  appearance: { opacity: 0.88 },
  statutoryHolidays: [],
  makeupDays: [],
  displayProfiles: [],
  savedAt: "2026-08-15T04:00:00.000Z",
  storagePath: "C:/settings/desk-calendar.json"
});

const loadSettingsMock = vi.fn(async () => defaultSettings());
const saveSettingsMock = vi.fn(async (patch: unknown) => ({ ...defaultSettings(), ...(patch as object), savedAt: "2026-08-15T04:00:00.000Z" }));
const broadcastSettingsChangedMock = vi.fn();
const refreshWeatherMock = vi.fn(async () => defaultSettings().weather);
const isDeskCalendarAppQuittingMock = vi.fn(() => false);
const isVisibleOnCurrentDisplaysMock = vi.fn(() => true);
const loadWindowStateMock = vi.fn(async () => null);
const attachWindowStatePersistenceMock = vi.fn(() => vi.fn());
const pinWindowToDesktopBottomMock = vi.fn();

vi.mock("./deskCalendarWindow", () => ({
  loadSettings: loadSettingsMock,
  saveSettings: saveSettingsMock,
  broadcastSettingsChanged: broadcastSettingsChangedMock,
  refreshWeather: refreshWeatherMock,
  isDeskCalendarAppQuitting: isDeskCalendarAppQuittingMock,
  isVisibleOnCurrentDisplays: isVisibleOnCurrentDisplaysMock
}));

vi.mock("./windowStateStore", () => ({
  loadWindowState: loadWindowStateMock,
  attachWindowStatePersistence: attachWindowStatePersistenceMock
}));

vi.mock("./desktopPinning", () => ({
  pinWindowToDesktopBottom: pinWindowToDesktopBottomMock
}));

vi.mock("./ipcSecurity", () => ({
  assertTrustedDeskCalendarWidgetCaller: vi.fn()
}));

const loadWidgetModule = async (): Promise<{
  syncWidgetWindows: (settings: DeskCalendarSettings) => void;
  registerDeskCalendarWidgetHandlers: () => void;
}> => {
  vi.resetModules();
  return import("./deskCalendarWidgetWindow");
};

beforeEach(async () => {
  vi.clearAllMocks();
  electronState.handlers.clear();
  electronState.windows.length = 0;
  isDeskCalendarAppQuittingMock.mockReturnValue(false);
  isVisibleOnCurrentDisplaysMock.mockReturnValue(true);
  loadWindowStateMock.mockResolvedValue(null);
  loadSettingsMock.mockResolvedValue(defaultSettings());
  saveSettingsMock.mockResolvedValue(defaultSettings());
});

const tick = async (): Promise<void> => {
  // 组件窗创建是 async（loadURL/loadFile）；让位于微任务后的 then 链跑完。
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

const closedCallback = (windowIndex: number): (() => void) | undefined =>
  electronState.windows[windowIndex]?.on.mock.calls.find((call) => call[0] === "closed")?.[1] as (() => void) | undefined;

describe("deskCalendarWidgetWindow", () => {
  it("desk calendar enabled 时按 widgets 创建全部启用组件窗", async () => {
    const { syncWidgetWindows } = await loadWidgetModule();
    syncWidgetWindows(defaultSettings());
    await tick();
    expect(electronState.windows).toHaveLength(4);
    expect(electronState.windows.every((w) => w.setMenu.mock.calls.length > 0)).toBe(true);
    expect(electronState.windows.every((w) => w.showInactive.mock.calls.length > 0)).toBe(true);
  });

  it("再次同步不会重复创建已启用组件窗", async () => {
    const { syncWidgetWindows } = await loadWidgetModule();
    syncWidgetWindows(defaultSettings());
    await tick();
    const count = electronState.windows.length;
    syncWidgetWindows(defaultSettings());
    await tick();
    expect(electronState.windows.length).toBe(count);
  });

  it("禁用组件后同步会关闭对应窗口，且不把组件标记为禁用（整体/禁用触发的关闭）", async () => {
    const { syncWidgetWindows } = await loadWidgetModule();
    syncWidgetWindows(defaultSettings());
    await tick();
    const weatherWindow = electronState.windows[1];
    expect(closedCallback(1)).toBeDefined();

    syncWidgetWindows(defaultSettings({ weather: false }));
    await tick();
    expect(weatherWindow.close).toHaveBeenCalled();
    await tick();
    expect(saveSettingsMock).not.toHaveBeenCalled();
  });

  it("桌历整体关闭时同步销毁全部组件窗且不改设置", async () => {
    const { syncWidgetWindows } = await loadWidgetModule();
    syncWidgetWindows(defaultSettings());
    await tick();
    syncWidgetWindows({ ...defaultSettings(), enabled: false });
    await tick();
    for (const window of electronState.windows) {
      expect(window.close).toHaveBeenCalled();
    }
    expect(saveSettingsMock).not.toHaveBeenCalled();
  });

  it("单独关闭某组件窗会持久化禁用该组件", async () => {
    const { syncWidgetWindows } = await loadWidgetModule();
    syncWidgetWindows(defaultSettings());
    await tick();
    closedCallback(0)?.();
    await tick();
    expect(saveSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({ widgets: expect.arrayContaining([expect.objectContaining({ id: "clock", enabled: false })]) })
    );
  });

  it("退出中关闭组件窗不改写设置", async () => {
    isDeskCalendarAppQuittingMock.mockReturnValue(true);
    const { syncWidgetWindows } = await loadWidgetModule();
    syncWidgetWindows(defaultSettings());
    await tick();
    closedCallback(0)?.();
    await tick();
    expect(saveSettingsMock).not.toHaveBeenCalled();
  });

  it("data:load 返回组件数据；settings:update 保存并广播；close 关闭对应窗口", async () => {
    const { syncWidgetWindows, registerDeskCalendarWidgetHandlers } = await loadWidgetModule();
    registerDeskCalendarWidgetHandlers();
    syncWidgetWindows(defaultSettings());
    await tick();

    const loadHandler = electronState.handlers.get("campusos:desk-calendar-widget:data:load")!;
    const weatherWebContents = { id: 1 } as unknown as Electron.WebContents;
    const data = await loadHandler({ sender: weatherWebContents } as never);
    expect(data).toMatchObject({ id: "weather", enabled: true, weather: { location: "Hangzhou" } });

    const updateHandler = electronState.handlers.get("campusos:desk-calendar-widget:settings:update")!;
    await updateHandler({ sender: weatherWebContents } as never, { countdowns: [] });
    expect(saveSettingsMock).toHaveBeenCalledWith({ countdowns: [] });
    expect(broadcastSettingsChangedMock).toHaveBeenCalled();

    const closeHandler = electronState.handlers.get("campusos:desk-calendar-widget:close")!;
    await closeHandler({ sender: weatherWebContents } as never);
    expect(electronState.windows[1].close).toHaveBeenCalled();
  });
});
