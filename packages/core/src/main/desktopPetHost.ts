import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAccountBrowserSession } from "./accountBrowserSession";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  clipboard,
  globalShortcut,
  ipcMain,
  nativeImage,
  screen,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type Rectangle,
  type WebContents
} from "electron";
import type {
  DesktopPetInput,
  DesktopPetSettings,
  DesktopPetState
} from "../../../shared/src/desktopPet";
import { DESKTOP_PET_DEFAULT_SETTINGS, DESKTOP_PET_FORMS } from "../../../shared/src/desktopPet";
import { assertTrustedRenderer } from "./ipcSecurity";
import { registerWindowIpcHandler, type IpcTrustPolicy } from "./trustedIpc";
import { createDesktopPetService, validateDesktopPetInput, type DesktopPetService } from "./desktopPetService";

const BASE_WIDTH = 340;
const BASE_HEIGHT = 460;
const CHANNEL = "campusos:desktop-pet:";
const mainBundleDirectory = dirname(fileURLToPath(import.meta.url));
const desktopPetPreloadPath = join(mainBundleDirectory, "../preload/desktopPet.cjs");
const desktopPetRendererPath = join(mainBundleDirectory, "../renderer/desktop-pet.html");

type DesktopPetParse = Parameters<typeof createDesktopPetService>[0]["parse"];
export interface DesktopPetHostOptions {
  parse: DesktopPetParse;
  onReview: (id?: string) => void | Promise<void>;
  onVisibilityChanged?: () => void;
}
export interface DesktopPetHost {
  restore: () => Promise<void>;
  showInteractive: () => Promise<void>;
  toggle: () => Promise<void>;
  isVisible: () => boolean;
  getState: () => DesktopPetState;
  dispose: () => void;
}

interface SavedPosition { x: number; y: number }
let activeHost: DesktopPetHost | null = null;

const settingsPath = (): string => join(app.getPath("userData"), "settings", "desktop-pet.json");
const positionPath = (): string => join(app.getPath("userData"), "settings", "desktop-pet-position.json");
const readJson = async (path: string): Promise<unknown> => {
  try { return JSON.parse(await readFile(path, "utf8")) as unknown; }
  catch (error) { if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
};
const writeJson = async (path: string, value: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), "utf8");
  await rename(temporary, path);
};
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const normalizeSettings = (value: unknown): DesktopPetSettings => {
  const result = { ...DESKTOP_PET_DEFAULT_SETTINGS };
  if (!isRecord(value)) return result;
  for (const key of ["enabled", "alwaysOnTop", "clickThrough"] as const) if (typeof value[key] === "boolean") result[key] = value[key];
  if (typeof value.scale === "number" && Number.isFinite(value.scale)) result.scale = Math.max(0.65, Math.min(1.5, value.scale));
  if (typeof value.shortcut === "string" && value.shortcut.length <= 80 && !/[\r\n\0]/.test(value.shortcut)) result.shortcut = value.shortcut.trim();
  if (value.appearance === "auto" || DESKTOP_PET_FORMS.some((form) => form === value.appearance)) result.appearance = value.appearance as DesktopPetSettings["appearance"];
  return result;
};
const dimensions = (scale: number): { width: number; height: number } => {
  const safeScale = Math.max(0.65, Math.min(1.5, Number.isFinite(scale) ? scale : 1));
  return { width: Math.round(BASE_WIDTH * safeScale), height: Math.round(BASE_HEIGHT * safeScale) };
};
const isSavedPosition = (value: unknown): value is SavedPosition => isRecord(value) && typeof value.x === "number" && Number.isFinite(value.x) && typeof value.y === "number" && Number.isFinite(value.y);
export const resolveDesktopPetBounds = (position: SavedPosition | null, scale: number, workAreas: readonly Rectangle[]): Rectangle => {
  const { width, height } = dimensions(scale);
  const primary = workAreas[0] ?? { x: 0, y: 0, width: 1280, height: 720 };
  const desired = position ?? { x: primary.x + primary.width - width - 28, y: primary.y + primary.height - height - 24 };
  const target = workAreas.find((area) => desired.x < area.x + area.width && desired.x + width > area.x && desired.y < area.y + area.height && desired.y + height > area.y) ?? primary;
  return {
    x: Math.min(target.x + Math.max(0, target.width - width), Math.max(target.x, Math.round(desired.x))),
    y: Math.min(target.y + Math.max(0, target.height - height), Math.max(target.y, Math.round(desired.y))),
    width,
    height
  };
};

const validateNativeImage = (raw: DesktopPetInput): DesktopPetInput => {
  const input = validateDesktopPetInput(raw);
  if (input.kind !== "image") return input;
  const bytes = Buffer.from(input.base64, "base64");
  const isPng = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const isWebp = bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  if (input.mime === "image/png" && !isPng || input.mime === "image/jpeg" && !isJpeg || input.mime === "image/webp" && !isWebp) throw new Error("图片格式与内容不一致。");
  const image = nativeImage.createFromBuffer(bytes);
  const size = image.getSize();
  if (image.isEmpty() || size.width < 1 || size.height < 1 || size.width > 8192 || size.height > 8192 || size.width * size.height > 32_000_000) throw new Error("图片无法读取或尺寸过大。");
  return input;
};

export const registerDesktopPetHost = (hostOptions: DesktopPetHostOptions): DesktopPetHost => {
  activeHost?.dispose();
  let petWindow: BrowserWindow | null = null;
  let panelWindow: BrowserWindow | null = null;
  let expectedPageUrl = "";
  let expectedPanelUrl = "";
  let panelView: "message" | "settings" = "message";
  let settings = { ...DESKTOP_PET_DEFAULT_SETTINGS };
  let shortcutRegistered = false;
  let ownedShortcut = "";
  let disposed = false;
  let launching: Promise<void> | null = null;
  let panelLaunching: Promise<void> | null = null;
  let settingsWrite = Promise.resolve();
  let positionWrite = Promise.resolve();
  const controlSubscribers = new Set<WebContents>();
  const getState = (): DesktopPetState => ({ settings: { ...settings }, jobs: service.list(), shortcutRegistered });
  const sendState = (): void => {
    const state = getState();
    if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send(`${CHANNEL}changed`, state);
    if (panelWindow && !panelWindow.isDestroyed()) panelWindow.webContents.send(`${CHANNEL}changed`, state);
    for (const contents of [...controlSubscribers]) {
      if (contents.isDestroyed()) controlSubscribers.delete(contents);
      else contents.send(`${CHANNEL}changed`, state);
    }
  };
  const service: DesktopPetService = createDesktopPetService({ parse: hostOptions.parse, onChanged: sendState });

  const assertPet = (event: IpcMainInvokeEvent | IpcMainEvent): void => {
    const trusted = [[petWindow, expectedPageUrl], [panelWindow, expectedPanelUrl]] as const;
    if (!trusted.some(([window, url]) => window && !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === event.sender.mainFrame && url && event.senderFrame.url === url)) throw new Error("不可信的桌宠窗口请求。");
  };
  const assertControlOrPet = (event: IpcMainInvokeEvent): "pet" | "control" => {
    try { assertPet(event); return "pet"; }
    catch { assertTrustedRenderer(event); controlSubscribers.add(event.sender); return "control"; }
  };
  const unregisterShortcut = (): void => {
    if (ownedShortcut) globalShortcut.unregister(ownedShortcut);
    ownedShortcut = "";
    shortcutRegistered = false;
  };
  const registerShortcut = (): void => {
    unregisterShortcut();
    if (!settings.enabled || !settings.shortcut) return;
    try { shortcutRegistered = globalShortcut.register(settings.shortcut, () => { void showInteractive().catch(() => undefined); }); }
    catch { shortcutRegistered = false; }
    if (shortcutRegistered) ownedShortcut = settings.shortcut;
  };
  const applySettings = (): void => {
    if (!petWindow || petWindow.isDestroyed()) return;
    petWindow.setAlwaysOnTop(settings.alwaysOnTop, settings.alwaysOnTop ? "floating" : "normal");
    petWindow.setIgnoreMouseEvents(settings.clickThrough, { forward: settings.clickThrough });
    panelWindow?.setAlwaysOnTop(settings.alwaysOnTop, settings.alwaysOnTop ? "floating" : "normal");
    const workAreas = screen.getAllDisplays().map((display) => display.workArea);
    const current = petWindow.getBounds();
    petWindow.setBounds(resolveDesktopPetBounds({ x: current.x + current.width - dimensions(settings.scale).width, y: current.y + current.height - dimensions(settings.scale).height }, settings.scale, workAreas));
  };
  const saveSettings = async (patch: unknown): Promise<DesktopPetState> => {
    if (!isRecord(patch)) throw new Error("桌宠设置格式无效。");
    const operation = settingsWrite.catch(() => undefined).then(async () => {
      if (disposed) throw new Error("桌宠宿主已关闭。");
      const wasEnabled = settings.enabled;
      const next = normalizeSettings({ ...settings, ...patch });
      await writeJson(settingsPath(), next);
      if (disposed) throw new Error("桌宠宿主已关闭。");
      settings = next;
      registerShortcut();
      if (settings.enabled) { await launch(); if (!wasEnabled) await showPanel(); }
      else {
        if (petWindow && !petWindow.isDestroyed()) petWindow.hide();
        if (panelWindow && !panelWindow.isDestroyed()) panelWindow.hide();
      }
      applySettings();
      hostOptions.onVisibilityChanged?.();
    });
    settingsWrite = operation;
    await operation;
    sendState();
    return getState();
  };
  const persistPosition = (): void => {
    if (!petWindow || petWindow.isDestroyed()) return;
    const { x, y } = petWindow.getBounds();
    positionWrite = positionWrite.then(() => writeJson(positionPath(), { x, y })).catch(() => undefined);
  };
  const launch = async (): Promise<void> => {
    if (disposed) throw new Error("桌宠宿主已关闭。");
    if (launching) return launching;
    launching = (async () => {
      if (petWindow && !petWindow.isDestroyed()) { petWindow.showInactive(); return; }
      const rawPosition = await readJson(positionPath());
      if (disposed) throw new Error("桌宠宿主已关闭。");
      const bounds = resolveDesktopPetBounds(isSavedPosition(rawPosition) ? rawPosition : null, settings.scale, screen.getAllDisplays().map((display) => display.workArea));
      const window = new BrowserWindow({ ...bounds, title: "CampusOS 桌宠", transparent: true, frame: false, resizable: false, maximizable: false, minimizable: false, fullscreenable: false, hasShadow: false, skipTaskbar: true, alwaysOnTop: settings.alwaysOnTop, show: false,
        webPreferences: { session: getAccountBrowserSession(), preload: desktopPetPreloadPath, contextIsolation: true, nodeIntegration: false, sandbox: true, autoplayPolicy: "no-user-gesture-required" } });
      petWindow = window;
      window.setMenu(null);
      window.on("page-title-updated", event => event.preventDefault());
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-navigate", (event) => event.preventDefault());
      window.webContents.on("will-redirect", (event) => event.preventDefault());
      window.on("move", persistPosition);
      window.on("show", () => hostOptions.onVisibilityChanged?.());
      window.on("hide", () => hostOptions.onVisibilityChanged?.());
      window.on("close", (event) => { if (!disposed) { event.preventDefault(); void saveSettings({ enabled: false }).catch(() => undefined); } });
      window.on("closed", () => { if (petWindow === window) { petWindow = null; expectedPageUrl = ""; hostOptions.onVisibilityChanged?.(); } });
      const rendererUrl = process.env.ELECTRON_RENDERER_URL;
      if (!app.isPackaged && rendererUrl) expectedPageUrl = new URL("desktop-pet.html", rendererUrl.endsWith("/") ? rendererUrl : `${rendererUrl}/`).href;
      else expectedPageUrl = pathToFileURL(desktopPetRendererPath).href;
      try {
        if (!app.isPackaged && rendererUrl) await window.loadURL(expectedPageUrl);
        else await window.loadFile(desktopPetRendererPath);
        if (disposed || window.isDestroyed() || petWindow !== window) throw new Error("桌宠宿主已关闭。");
        if (window.webContents.getURL() !== expectedPageUrl) throw new Error("桌宠页面地址与可信入口不一致。");
        applySettings();
        window.showInactive();
        sendState();
      } catch (error) { if (!window.isDestroyed()) window.destroy(); if (petWindow === window) { petWindow = null; expectedPageUrl = ""; } throw error; }
    })().finally(() => { launching = null; });
    return launching;
  };
  const showPanel = async (focus = true): Promise<void> => {
    if (disposed) throw new Error("桌宠宿主已关闭。");
    if (panelLaunching) await panelLaunching;
    if (disposed) throw new Error("桌宠宿主已关闭。");
    if (!panelWindow || panelWindow.isDestroyed()) {
      panelLaunching = (async () => {
        const pet = petWindow?.getBounds();
        const areas = screen.getAllDisplays().map(display => display.workArea);
        const area = areas.find(area => pet && pet.x >= area.x && pet.x < area.x + area.width && pet.y >= area.y && pet.y < area.y + area.height) ?? areas[0];
        const width = Math.min(380, area.width), height = Math.min(panelView === "settings" ? 560 : 240, area.height);
        const desiredX = pet ? pet.x - width - 12 : area.x + area.width - width;
        const bounds = { width, height, x: Math.max(area.x, Math.min(desiredX, area.x + area.width - width)), y: Math.max(area.y, Math.min(pet?.y ?? area.y, area.y + area.height - height)) };
        const window = new BrowserWindow({ ...bounds, useContentSize: true, title: "桌面助手", backgroundColor: "#f9fbff", transparent: false, frame: false, resizable: false, maximizable: false, minimizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: settings.alwaysOnTop, show: false,
          webPreferences: { session: getAccountBrowserSession(), preload: desktopPetPreloadPath, contextIsolation: true, nodeIntegration: false, sandbox: true } });
        panelWindow = window;
        window.setMenu(null);
        window.on("page-title-updated", event => event.preventDefault());
        window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        window.webContents.on("will-navigate", event => event.preventDefault());
        window.webContents.on("will-redirect", event => event.preventDefault());
        window.on("close", event => { if (!disposed) { event.preventDefault(); window.hide(); } });
        window.on("closed", () => { if (panelWindow === window) { panelWindow = null; expectedPanelUrl = ""; } });
        const rendererUrl = process.env.ELECTRON_RENDERER_URL;
        const url = !app.isPackaged && rendererUrl ? new URL("desktop-pet.html", rendererUrl.endsWith("/") ? rendererUrl : `${rendererUrl}/`) : pathToFileURL(desktopPetRendererPath);
        url.searchParams.set("panel", "1");
        expectedPanelUrl = url.href;
        try {
          await window.loadURL(expectedPanelUrl);
          if (disposed || window.isDestroyed() || panelWindow !== window) throw new Error("桌宠宿主已关闭。");
          if (window.webContents.getURL() !== expectedPanelUrl) throw new Error("桌宠面板地址与可信入口不一致。");
          sendState();
        } catch (error) { if (!window.isDestroyed()) window.destroy(); throw error; }
      })().finally(() => { panelLaunching = null; });
      await panelLaunching;
    }
    if (disposed) throw new Error("桌宠宿主已关闭。");
    if (!settings.enabled) return;
    if (focus) { panelWindow?.show(); panelWindow?.focus(); }
    else panelWindow?.showInactive();
  };
  const showInteractive = async (): Promise<void> => {
    if (!settings.enabled) await saveSettings({ enabled: true, clickThrough: false });
    else if (settings.clickThrough) await saveSettings({ clickThrough: false });
    else await launch();
    petWindow?.showInactive();
    await showPanel();
  };
  const toggle = async (): Promise<void> => {
    if (petWindow?.isVisible()) await saveSettings({ enabled: false });
    else await showInteractive();
  };
  const parseClipboard = (): string => {
    const text = clipboard.readText("clipboard").trim();
    if (text) return service.submit({ kind: "text", text });
    const image = clipboard.readImage("clipboard");
    if (!image.isEmpty()) return service.submit(validateNativeImage({ kind: "image", mime: "image/png", base64: image.toPNG().toString("base64") }));
    throw new Error("剪贴板里没有可解析的文字或图片。");
  };

  const handles = new Set<string>();
  const handle = (
    suffix: string,
    assertAllowed: IpcTrustPolicy,
    callback: (event: IpcMainInvokeEvent, ...args: any[]) => unknown
  ): void => {
    const name = `${CHANNEL}${suffix}`;
    ipcMain.removeHandler(name);
    registerWindowIpcHandler(name, assertAllowed, callback);
    handles.add(name);
  };
  handle("state", assertControlOrPet, () => getState());
  handle("show", assertControlOrPet, () => showInteractive());
  handle("panel:open", assertPet, () => showPanel());
  handle("panel:close", assertPet, event => { if (event.sender !== panelWindow?.webContents) throw new Error("不可信的桌宠面板请求。"); panelWindow.hide(); });
  handle("panel:view", assertPet, (event, view) => {
    if (event.sender !== panelWindow?.webContents) throw new Error("不可信的桌宠面板请求。");
    if (view !== "message" && view !== "settings") throw new Error("桌宠面板页面无效。");
    panelView = view;
    const current = panelWindow.getBounds();
    const areas = screen.getAllDisplays().map(display => display.workArea);
    const area = areas.find(area => current.x >= area.x && current.x < area.x + area.width && current.y >= area.y && current.y < area.y + area.height) ?? areas[0];
    const height = Math.min(view === "settings" ? 560 : 240, area.height);
    panelWindow.setBounds({ ...current, height, y: Math.max(area.y, Math.min(current.y, area.y + area.height - height)) });
  });
  handle("settings:save", assertControlOrPet, async (event, patch) => { return saveSettings(patch); });
  handle("job:get", assertTrustedRenderer, (event, id) => { controlSubscribers.add(event.sender); return typeof id === "string" ? service.get(id) : null; });
  handle("job:dismiss", assertControlOrPet, (event, id) => { if (typeof id === "string") service.dismiss(id); });
  handle("clipboard:parse", assertPet, () => parseClipboard());
  handle("submit", assertPet, (event, input) => { return service.submit(validateNativeImage(input as DesktopPetInput)); });
  handle("cancel", assertPet, (event, id) => { if (typeof id === "string") service.cancel(id); });
  handle("retry", assertPet, (event, id) => { if (typeof id === "string") service.retry(id); });
  handle("review", assertPet, async (event, id) => { const selected = typeof id === "string" ? id : undefined; if (selected && !service.get(selected)) throw new Error("桌宠消息不存在。"); await hostOptions.onReview(selected); });
  handle("move", assertPet, (event, delta) => {
    if (!isRecord(delta) || typeof delta.x !== "number" || !Number.isFinite(delta.x) || typeof delta.y !== "number" || !Number.isFinite(delta.y) || Math.abs(delta.x) > 500 || Math.abs(delta.y) > 500) throw new Error("桌宠移动距离无效。");
    if (!petWindow) return;
    const bounds = petWindow.getBounds();
    petWindow.setBounds(resolveDesktopPetBounds({ x: bounds.x + Math.round(delta.x), y: bounds.y + Math.round(delta.y) }, settings.scale, screen.getAllDisplays().map((display) => display.workArea)));
  });

  const restore = async (): Promise<void> => {
    settings = normalizeSettings(await readJson(settingsPath()));
    if (disposed) throw new Error("桌宠宿主已关闭。");
    registerShortcut();
    if (settings.enabled) { await launch(); await showPanel(false); }
  };
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    unregisterShortcut();
    service.dispose();
    for (const name of handles) ipcMain.removeHandler(name);
    if (petWindow && !petWindow.isDestroyed()) petWindow.destroy();
    if (panelWindow && !panelWindow.isDestroyed()) panelWindow.destroy();
    petWindow = null;
    panelWindow = null;
    controlSubscribers.clear();
    if (activeHost === api) activeHost = null;
  };
  const api: DesktopPetHost = { restore, showInteractive, toggle, isVisible: () => !!petWindow && !petWindow.isDestroyed() && petWindow.isVisible(), getState, dispose };
  activeHost = api;
  return api;
};
