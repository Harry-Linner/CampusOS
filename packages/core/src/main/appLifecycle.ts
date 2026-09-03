import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  Tray,
  type MenuItemConstructorOptions
} from "electron";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import type {
  AppLifecycleSettings,
  AppLifecycleSettingsPatch,
  CloseBehavior
} from "../shared/appLifecycleBridge";
import { assertTrustedRenderer } from "./ipcSecurity";
import {
  launchDeskCalendar,
  closeDeskCalendar,
  isDeskCalendarRunning,
  openDeskCalendarSettings
} from "./deskCalendarHost";

const SETTINGS_FILE = "app-lifecycle.json";
let settings: AppLifecycleSettings | null = null;
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let appIsQuitting = false;

const settingsPath = (): string => join(app.getPath("userData"), "settings", SETTINGS_FILE);

const defaults = (): AppLifecycleSettings => ({
  launchAtLogin: false,
  closeBehavior: "ask",
  notificationEnabled: false,
  notificationPrompted: false,
  updatedAt: new Date(0).toISOString()
});

const normalizeCloseBehavior = (value: unknown): CloseBehavior =>
  value === "hide-to-tray" || value === "quit" ? value : "ask";

const normalizeSettings = (value: unknown): AppLifecycleSettings => {
  const source = typeof value === "object" && value !== null ? value as Partial<AppLifecycleSettings> : {};
  return {
    launchAtLogin: source.launchAtLogin === true,
    closeBehavior: normalizeCloseBehavior(source.closeBehavior),
    notificationEnabled: source.notificationEnabled === true,
    notificationPrompted: source.notificationPrompted === true,
    updatedAt: typeof source.updatedAt === "string" && Number.isFinite(Date.parse(source.updatedAt))
      ? source.updatedAt
      : new Date(0).toISOString()
  };
};

const loadSettings = async (): Promise<AppLifecycleSettings> => {
  if (settings) return { ...settings };
  try {
    settings = normalizeSettings(JSON.parse(await readFile(settingsPath(), "utf8")));
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) {
      settings = defaults();
    } else {
      settings = defaults();
    }
  }
  app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin, args: settings.launchAtLogin ? ["--hidden"] : [] });
  return { ...settings };
};

const persistSettings = async (patch: AppLifecycleSettingsPatch): Promise<AppLifecycleSettings> => {
  const current = await loadSettings();
  const next = normalizeSettings({ ...current, ...patch, updatedAt: new Date().toISOString() });
  const target = settingsPath();
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(next, null, 2), "utf8");
  await rename(temporary, target);
  settings = next;
  if (patch.launchAtLogin !== undefined) {
    app.setLoginItemSettings({
      openAtLogin: next.launchAtLogin,
      args: next.launchAtLogin ? ["--hidden"] : []
    });
  }
  return { ...next };
};

export const showCampusMainWindow = (): void => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
};

const developmentTrayIconPath = (): string => {
  let currentPath = app.getAppPath();
  while (true) {
    const candidate = join(currentPath, "build", "icon.ico");
    if (existsSync(candidate)) return candidate;
    const parentPath = dirname(currentPath);
    if (parentPath === currentPath) break;
    currentPath = parentPath;
  }
  throw new Error("CampusOS tray icon is missing from the development workspace.");
};

const rebuildTrayMenu = async (): Promise<void> => {
  if (!tray) return;
  const template: MenuItemConstructorOptions[] = [
    { label: "打开 CampusOS", click: showCampusMainWindow },
    {
      label: "桌面日历",
      click: () => {
        if (isDeskCalendarRunning()) {
          void closeDeskCalendar().catch(() => undefined);
        } else {
          void launchDeskCalendar().catch((cause: unknown) => {
            void dialog.showErrorBox(
              "桌面日历启动失败",
              cause instanceof Error ? cause.message : "无法启动桌面日历。"
            );
          });
        }
      }
    },
    {
      label: "日历设置",
      click: () => {
        void openDeskCalendarSettings().catch((cause: unknown) => {
          void dialog.showErrorBox(
            "日历设置打开失败",
            cause instanceof Error ? cause.message : "无法打开日历设置。"
          );
        });
      }
    }
  ];
  template.push(
    { type: "separator" },
    {
      label: "退出 CampusOS",
      click: () => {
        appIsQuitting = true;
        app.quit();
      }
    }
  );
  tray.setContextMenu(Menu.buildFromTemplate(template));
};

export const attachMainWindowLifecycle = async (window: BrowserWindow): Promise<void> => {
  mainWindow = window;
  window.on("close", async (event) => {
    if (appIsQuitting) return;
    event.preventDefault();
    const current = await loadSettings();
    if (current.closeBehavior === "hide-to-tray") {
      window.hide();
      return;
    }
    if (current.closeBehavior === "quit") {
      appIsQuitting = true;
      app.quit();
      return;
    }
    const result = await dialog.showMessageBox(window, {
      type: "question",
      title: "关闭 CampusOS",
      message: "关闭主窗口后要做什么？",
      detail: "隐藏到托盘后，自动同步、提醒和桌面日历仍会继续工作。",
      buttons: ["隐藏到托盘", "退出 CampusOS", "取消"],
      defaultId: 0,
      cancelId: 2,
      checkboxLabel: "设为默认，以后不再询问",
      checkboxChecked: false,
      noLink: true
    });
    if (result.response === 2) return;
    const behavior: CloseBehavior = result.response === 0 ? "hide-to-tray" : "quit";
    if (result.checkboxChecked) await persistSettings({ closeBehavior: behavior });
    if (behavior === "hide-to-tray") window.hide();
    else {
      appIsQuitting = true;
      app.quit();
    }
  });
};

export const createCampusTray = async (): Promise<void> => {
  if (tray) return;
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, "icon.ico")
    : developmentTrayIconPath();
  tray = new Tray(iconPath);
  tray.setToolTip("CampusOS");
  tray.on("double-click", showCampusMainWindow);
  await rebuildTrayMenu();
};

export const getAppLifecycleSettings = (): Promise<AppLifecycleSettings> => loadSettings();

export const shouldStartHidden = (): boolean => process.argv.includes("--hidden");

export const markCampusAppQuitting = (): void => {
  appIsQuitting = true;
};

export const registerAppLifecycleHandlers = (): void => {
  ipcMain.handle("campusos:lifecycle:load", async (event) => {
    assertTrustedRenderer(event);
    return loadSettings();
  });
  ipcMain.handle("campusos:lifecycle:save", async (event, patch: AppLifecycleSettingsPatch) => {
    assertTrustedRenderer(event);
    return persistSettings(patch ?? {});
  });
};
