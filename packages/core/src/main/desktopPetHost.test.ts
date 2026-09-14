import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const electronState = vi.hoisted(() => ({
  userData: "",
  handlers: new Map<string, (event: any, ...args: any[]) => unknown>(),
  windows: [] as any[],
  clipboardText: "",
  clipboardPng: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]),
  clipboardImageEmpty: true,
  shortcutCallbacks: new Map<string, () => void>(),
  shortcutRegisterResult: true,
  redirectUrl: "",
  loadGate: null as Promise<void> | null
}));
const trustedRenderer = vi.hoisted(() => vi.fn((event: { trusted?: boolean }) => { if (!event.trusted) throw new Error("untrusted"); }));
vi.mock("./ipcSecurity", () => ({ assertTrustedRenderer: trustedRenderer }));

vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  class FakeWindow extends EventEmitter {
    destroyed = false; visible = false; ignored = false;
    bounds: { x: number; y: number; width: number; height: number };
    webContents = Object.assign(new EventEmitter(), {
      mainFrame: { url: "" }, send: vi.fn(), setWindowOpenHandler: vi.fn(), getURL: () => this.webContents.mainFrame.url,
      isDestroyed: () => this.destroyed
    });
    constructor(readonly options: Record<string, any>) { super(); this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height }; electronState.windows.push(this); }
    setMenu = vi.fn(); setAlwaysOnTop = vi.fn(); setIgnoreMouseEvents = vi.fn((value: boolean) => { this.ignored = value; });
    setBounds = vi.fn((value: typeof this.bounds) => { this.bounds = value; this.emit("move"); }); getBounds = () => this.bounds;
    isDestroyed = () => this.destroyed; isVisible = () => this.visible; showInactive = vi.fn(() => { this.visible = true; }); show = vi.fn(() => { this.visible = true; }); hide = vi.fn(() => { this.visible = false; }); focus = vi.fn();
    loadURL = vi.fn(async (url: string) => { this.webContents.mainFrame.url = electronState.redirectUrl || url; await electronState.loadGate; });
    loadFile = vi.fn(async (path: string) => { this.webContents.mainFrame.url = `file:///${path.replace(/\\/g, "/")}`; });
    destroy = () => { this.destroyed = true; this.visible = false; this.emit("closed"); };
  }
  return {
    app: { isPackaged: false, getAppPath: () => electronState.userData, getPath: () => electronState.userData },
    session: { defaultSession: {} },
    BrowserWindow: vi.fn((options: Record<string, any>) => new FakeWindow(options)),
    clipboard: {
      readText: vi.fn(() => electronState.clipboardText),
      readImage: vi.fn(() => ({ isEmpty: () => electronState.clipboardImageEmpty, toPNG: () => electronState.clipboardPng }))
    },
    globalShortcut: {
      register: vi.fn((shortcut: string, callback: () => void) => { if (!electronState.shortcutRegisterResult) return false; electronState.shortcutCallbacks.set(shortcut, callback); return true; }),
      unregister: vi.fn((shortcut: string) => { electronState.shortcutCallbacks.delete(shortcut); })
    },
    ipcMain: { removeHandler: vi.fn((channel: string) => electronState.handlers.delete(channel)), handle: vi.fn((channel: string, callback: any) => electronState.handlers.set(channel, callback)) },
    nativeImage: { createFromBuffer: vi.fn(() => ({ isEmpty: () => false, getSize: () => ({ width: 640, height: 480 }) })) },
    screen: { getAllDisplays: vi.fn(() => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }]) }
  };
});

import { registerDesktopPetHost, resolveDesktopPetBounds, type DesktopPetHost } from "./desktopPetHost";
import { BrowserWindow, clipboard, globalShortcut } from "electron";

const parse = vi.fn(async () => ({ result: { intent: "general", sourceText: "x", source: { app: "manual" }, schemaVersion: 3, promptVersion: "test", intents: [], unresolvedQuestions: [] }, settings: { configured: true, provider: "openai", protocol: "openai-responses", baseUrl: "https://api.openai.com/v1", model: "test", savedAt: null, encrypted: true } } as any));
const review = vi.fn();
let host: DesktopPetHost;
const tempDirs: string[] = [];
const handler = (suffix: string) => {
  const value = electronState.handlers.get(`campusos:desktop-pet:${suffix}`);
  if (!value) throw new Error(`missing ${suffix}`);
  return value;
};
const mainEvent = () => ({ trusted: true, sender: { isDestroyed: () => false, send: vi.fn(), mainFrame: {} }, senderFrame: {} });
const petEvent = () => {
  const window = electronState.windows.find(window => window.options.transparent);
  return { sender: window.webContents, senderFrame: window.webContents.mainFrame };
};

beforeEach(async () => {
  host?.dispose();
  const directory = await mkdtemp(join(process.env.TEMP ?? process.cwd(), "campusos-pet-host-"));
  tempDirs.push(directory); electronState.userData = directory; electronState.handlers.clear(); electronState.windows.length = 0;
  electronState.clipboardText = ""; electronState.clipboardImageEmpty = true; electronState.shortcutCallbacks.clear(); electronState.shortcutRegisterResult = true;
  electronState.redirectUrl = "";
  electronState.loadGate = null;
  process.env.ELECTRON_RENDERER_URL = "http://127.0.0.1:5173/";
  parse.mockClear(); review.mockClear(); trustedRenderer.mockClear();
  host = registerDesktopPetHost({ parse, onReview: review });
});
afterEach(async () => { host.dispose(); delete process.env.ELECTRON_RENDERER_URL; await new Promise((resolve) => setTimeout(resolve, 30)); await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }))); });

describe("desktop pet host", () => {
  it("does not resurrect a window when disposed during its page load", async () => {
    let finishLoad!: () => void;
    electronState.loadGate = new Promise<void>(resolve => { finishLoad = resolve; });
    const launching = host.showInteractive();
    const failed = expect(launching).rejects.toThrow(/已关闭/);
    await vi.waitFor(() => expect(electronState.windows).toHaveLength(1));
    host.dispose();
    finishLoad();
    await failed;
    expect(electronState.windows.every(window => window.destroyed && !window.visible)).toBe(true);
    expect(electronState.windows).toHaveLength(1);
  });

  it("launches a fixed panel independently and closes it without disabling the pet", async () => {
    await handler("settings:save")(mainEvent(), { enabled: true });
    expect(electronState.windows).toHaveLength(2);
    const pet = electronState.windows.find(window => window.options.transparent);
    const panel = electronState.windows.find(window => !window.options.transparent);
    const event = { sender: panel.webContents, senderFrame: panel.webContents.mainFrame };
    expect(panel.options).toMatchObject({ width: 380, height: 240, resizable: false });
    await handler("panel:view")(event, "settings");
    const panelBounds = { ...panel.bounds };
    expect(panelBounds).toMatchObject({ width: 380, height: 560 });
    await handler("settings:save")(mainEvent(), { scale: 0.65 });
    expect(panel.bounds).toEqual(panelBounds);
    expect(pet.bounds.width).toBe(221);
    await handler("panel:close")(event);
    expect(panel.visible).toBe(false);
    expect(pet.visible).toBe(true);
    expect(host.getState().settings.enabled).toBe(true);
    await host.showInteractive();
    expect(panel.visible).toBe(true);
    await host.toggle();
    expect(pet.visible).toBe(false);
    expect(panel.visible).toBe(false);
    expect(host.getState().settings.enabled).toBe(false);
    await host.toggle();
    expect(panel.visible).toBe(true);
    expect(pet.visible).toBe(true);
  });

  it("recovers malformed optional settings and position without preventing startup", async () => {
    await mkdir(join(electronState.userData, "settings"), { recursive: true });
    await writeFile(join(electronState.userData, "settings", "desktop-pet.json"), "{broken");
    await writeFile(join(electronState.userData, "settings", "desktop-pet-position.json"), "{broken");
    await expect(host.restore()).resolves.toBeUndefined();
    expect(host.getState().settings.enabled).toBe(false);
    await expect(handler("settings:save")(mainEvent(), { enabled: true })).resolves.toMatchObject({ settings: { enabled: true } });
  });

  it("rejects a redirected entry and prevents later redirects", async () => {
    electronState.redirectUrl = "https://attacker.invalid/desktop-pet.html";
    await expect(handler("settings:save")(mainEvent(), { enabled: true })).rejects.toThrow(/可信入口/);
    expect(electronState.windows.at(-1).destroyed).toBe(true);
    electronState.redirectUrl = "";
    await handler("settings:save")(mainEvent(), { enabled: true });
    const event = { preventDefault: vi.fn() };
    electronState.windows.at(-1).webContents.emit("will-redirect", event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });
  it("restores legacy appearance as auto and only persists built-in forms", async () => {
    await host.restore();
    expect(host.getState().settings).toMatchObject({ appearance: "auto" });
    await handler("settings:save")(mainEvent(), { appearance: "back" });
    expect(JSON.parse(await readFile(join(electronState.userData, "settings", "desktop-pet.json"), "utf8"))).toMatchObject({ appearance: "back" });
    await host.restore();
    expect(host.getState().settings).toMatchObject({ appearance: "back" });
    for (const appearance of ["https://attacker.invalid/pet.png", "__proto__", {}, null]) {
      await handler("settings:save")(mainEvent(), { appearance });
      expect(host.getState().settings).toMatchObject({ appearance: "auto" });
    }
  });

  it("fully recovers a pet saved on a disconnected display", () => {
    expect(resolveDesktopPetBounds({ x: 5000, y: 5000 }, 3, [{ x: 0, y: 0, width: 800, height: 600 }])).toEqual({ x: 290, y: 0, width: 510, height: 690 });
  });

  it("restores an enabled pet with secure window settings and its own shortcut", async () => {
    await mkdir(join(electronState.userData, "settings"), { recursive: true });
    await writeFile(join(electronState.userData, "settings", "desktop-pet.json"), JSON.stringify({ enabled: true, scale: 1.25, shortcut: "Control+Shift+P" }));
    await host.restore();
    const created = vi.mocked(BrowserWindow).mock.calls.filter(call => call[0]?.transparent).at(-1)?.[0] as any;
    expect(created).toMatchObject({ transparent: true, frame: false, resizable: false, skipTaskbar: true, width: 425, height: 575 });
    expect(created.webPreferences).toMatchObject({ contextIsolation: true, nodeIntegration: false, sandbox: true });
    expect(globalShortcut.register).toHaveBeenCalledWith("Control+Shift+P", expect.any(Function));
    expect(host.getState().shortcutRegistered).toBe(true);
  });

  it("accepts exact pet calls, rejects hostile calls, and validates native image content", async () => {
    await handler("settings:save")(mainEvent(), { enabled: true });
    await handler("submit")(petEvent(), { kind: "text", text: "明天交报告" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(parse).toHaveBeenCalledOnce();
    expect(() => handler("submit")({ sender: {}, senderFrame: {} }, { kind: "text", text: "stolen" })).toThrow(/不可信/);
    expect(() => handler("submit")(petEvent(), { kind: "image", mime: "image/jpeg", base64: electronState.clipboardPng.toString("base64") })).toThrow(/格式/);
  });

  it("reads the clipboard only after an explicit invocation and prefers nonempty text", async () => {
    await handler("settings:save")(mainEvent(), { enabled: true });
    electronState.clipboardText = "  复制来的消息  ";
    expect(clipboard.readText).not.toHaveBeenCalled();
    const id = await handler("clipboard:parse")(petEvent());
    expect(typeof id).toBe("string");
    expect(clipboard.readText).toHaveBeenCalledWith("clipboard");
    expect(clipboard.readImage).not.toHaveBeenCalled();
    expect(() => handler("clipboard:parse")(mainEvent())).toThrow(/不可信/);
  });

  it("switches click-through on and the shortcut restores interaction", async () => {
    await handler("settings:save")(mainEvent(), { enabled: true, clickThrough: true });
    const window = electronState.windows.find(window => window.options.transparent);
    expect(window.ignored).toBe(true);
    electronState.shortcutCallbacks.get(host.getState().settings.shortcut)?.();
    // The shortcut handler re-enables interaction asynchronously; poll instead of
    // sleeping a fixed 30 ms, which failed on slower CI runners.
    await vi.waitFor(() => expect(window.ignored).toBe(false));
    expect(host.getState().settings.clickThrough).toBe(false);
  });

  it("persists settings and unregisters only the shortcut it owns", async () => {
    await handler("settings:save")(mainEvent(), { enabled: true, scale: 9, shortcut: "Alt+Shift+C" });
    const saved = JSON.parse(await readFile(join(electronState.userData, "settings", "desktop-pet.json"), "utf8"));
    expect(saved).toMatchObject({ enabled: true, scale: 1.5, shortcut: "Alt+Shift+C" });
    host.dispose();
    expect(globalShortcut.unregister).toHaveBeenLastCalledWith("Alt+Shift+C");
  });

  it("retains a parsed job until the main view fetches and dismisses it", async () => {
    await handler("settings:save")(mainEvent(), { enabled: true });
    const id = await handler("submit")(petEvent(), { kind: "text", text: "周五答辩" }) as string;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(() => handler("job:get")(petEvent(), id)).toThrow(/untrusted/);
    expect(await handler("job:get")(mainEvent(), id)).toMatchObject({ id, status: "ready" });
    await handler("review")(petEvent(), id);
    expect(review).toHaveBeenCalledWith(id);
    await handler("job:dismiss")(mainEvent(), id);
    expect(await handler("job:get")(mainEvent(), id)).toBeNull();
  });
});
