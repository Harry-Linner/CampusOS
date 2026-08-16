import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electronState = vi.hoisted(() => ({
  userDataPath: "",
  appPath: "",
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  loginItemSettings: vi.fn(),
  quit: vi.fn(),
  showMessageBox: vi.fn(),
  trayImagePaths: [] as string[],
  trayInstances: [] as Array<{
    setToolTip: ReturnType<typeof vi.fn>;
    setContextMenu: ReturnType<typeof vi.fn>;
    listeners: Map<string, () => void>;
  }>,
  menuTemplate: [] as Array<{
    label?: string;
    click?: () => void | Promise<void>;
    enabled?: boolean;
    submenu?: Array<{ label?: string; click?: () => void | Promise<void> }>;
  }>
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => electronState.userDataPath),
    getAppPath: vi.fn(() => electronState.appPath),
    isPackaged: false,
    setLoginItemSettings: electronState.loginItemSettings,
    quit: electronState.quit
  },
  BrowserWindow: class {},
  dialog: {
    showMessageBox: electronState.showMessageBox
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      electronState.handlers.set(channel, handler);
    })
  },
  Menu: {
    buildFromTemplate: vi.fn((template: typeof electronState.menuTemplate) => {
      electronState.menuTemplate = template;
      return template;
    })
  },
  Tray: vi.fn().mockImplementation((imagePath: string) => {
    electronState.trayImagePaths.push(imagePath);
    const instance = {
      setToolTip: vi.fn(),
      setContextMenu: vi.fn(),
      listeners: new Map<string, () => void>(),
      on: vi.fn((event: string, listener: () => void) => {
        instance.listeners.set(event, listener);
      })
    };
    electronState.trayInstances.push(instance);
    return instance;
  })
}));

const deskCalendarState = vi.hoisted(() => ({
  enabled: false,
  view: "month",
  setEnabled: vi.fn(async (enabled: boolean) => {
    deskCalendarState.enabled = enabled;
  }),
  setView: vi.fn(async (view: string) => {
    deskCalendarState.view = view;
  }),
  settingsChangedListener: vi.fn()
}));

vi.mock("./deskCalendarWindow", () => ({
  getDeskCalendarSettings: vi.fn(async () => ({ enabled: deskCalendarState.enabled, view: deskCalendarState.view })),
  setDeskCalendarEnabled: deskCalendarState.setEnabled,
  setDeskCalendarView: deskCalendarState.setView,
  setDeskCalendarSettingsChangedListener: deskCalendarState.settingsChangedListener
}));

vi.mock("./ipcSecurity", () => ({
  assertTrustedRenderer: vi.fn()
}));

const temporaryDirectories: string[] = [];

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  electronState.handlers.clear();
  electronState.appPath = join(process.cwd(), "out", "main");
  electronState.trayInstances.length = 0;
  electronState.trayImagePaths.length = 0;
  electronState.menuTemplate = [];
  deskCalendarState.enabled = false;
  deskCalendarState.view = "month";
});

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

const createStorageRoot = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "campusos-lifecycle-"));
  temporaryDirectories.push(directory);
  electronState.userDataPath = directory;
  return directory;
};

const handlerFor = (channel: string): ((...args: unknown[]) => unknown) => {
  const handler = electronState.handlers.get(channel);
  if (!handler) throw new Error(`handler not registered: ${channel}`);
  return handler;
};

const createWindow = () => {
  const listeners = new Map<string, (event: { preventDefault: ReturnType<typeof vi.fn> }) => Promise<void>>();
  return {
    listeners,
    on: vi.fn((event: string, listener: (event: { preventDefault: ReturnType<typeof vi.fn> }) => Promise<void>) => {
      listeners.set(event, listener);
    }),
    hide: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    restore: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => true)
  };
};

describe("app lifecycle", () => {
  it("loads defaults and persists lifecycle settings through IPC", async () => {
    const storageRoot = await createStorageRoot();
    const lifecycle = await import("./appLifecycle");
    lifecycle.registerAppLifecycleHandlers();

    const initial = await handlerFor("campusos:lifecycle:load")({});
    expect(initial).toMatchObject({
      launchAtLogin: false,
      closeBehavior: "ask",
      notificationEnabled: true,
      notificationPrompted: false
    });

    const saved = await handlerFor("campusos:lifecycle:save")({}, {
      launchAtLogin: true,
      notificationEnabled: false,
      notificationPrompted: true
    });
    expect(saved).toMatchObject({ launchAtLogin: true, notificationEnabled: false });
    expect(electronState.loginItemSettings).toHaveBeenLastCalledWith({
      openAtLogin: true,
      args: ["--hidden"]
    });
    await expect(readFile(join(storageRoot, "settings", "app-lifecycle.json"), "utf8"))
      .resolves.toContain('"notificationPrompted": true');
    await expect(lifecycle.getAppLifecycleSettings()).resolves.toMatchObject({ launchAtLogin: true });
  });

  it("asks once on close and remembers the selected tray behavior", async () => {
    await createStorageRoot();
    electronState.showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: true });
    const lifecycle = await import("./appLifecycle");
    const window = createWindow();
    await lifecycle.attachMainWindowLifecycle(window as never);

    const preventDefault = vi.fn();
    await window.listeners.get("close")?.({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(window.hide).toHaveBeenCalledOnce();
    await expect(lifecycle.getAppLifecycleSettings()).resolves.toMatchObject({
      closeBehavior: "hide-to-tray"
    });
  });

  it("builds tray actions and supports hidden startup and explicit quit", async () => {
    await createStorageRoot();
    const lifecycle = await import("./appLifecycle");
    const window = createWindow();
    await lifecycle.attachMainWindowLifecycle(window as never);
    await lifecycle.createCampusTray();

    expect(electronState.trayImagePaths[0]).toBe(
      join(process.cwd(), "..", "..", "build", "icon.ico")
    );
    expect(electronState.trayImagePaths[0]).not.toBe(process.execPath);

    electronState.trayInstances[0]?.listeners.get("double-click")?.();
    expect(window.restore).toHaveBeenCalledOnce();
    expect(window.show).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();

    await electronState.menuTemplate.find((item) => item.label === "显示桌面日历")?.click?.();
    expect(deskCalendarState.setEnabled).toHaveBeenCalledWith(true);

    const viewMenu = electronState.menuTemplate.find((item) => item.label === "桌面日历视图");
    await viewMenu?.submenu?.find((item) => item.label === "周视图")?.click?.();
    expect(deskCalendarState.setView).toHaveBeenCalledWith("week");

    await lifecycle.setSchedulePluginEnabled(false);
    expect(deskCalendarState.setEnabled).toHaveBeenCalledWith(false);
    expect(electronState.menuTemplate.some((item) => item.label === "桌面日历视图")).toBe(false);

    electronState.menuTemplate.find((item) => item.label === "退出 CampusOS")?.click?.();
    expect(electronState.quit).toHaveBeenCalledOnce();

    process.argv.push("--hidden");
    try {
      expect(lifecycle.shouldStartHidden()).toBe(true);
    } finally {
      process.argv.splice(process.argv.lastIndexOf("--hidden"), 1);
    }

    lifecycle.markCampusAppQuitting();
    const preventDefault = vi.fn();
    await window.listeners.get("close")?.({ preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
  });
});
