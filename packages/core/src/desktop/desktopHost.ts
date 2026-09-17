import { app, BrowserWindow, ipcMain } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { DESKTOP_REQUESTS, DESKTOP_EVENTS, PREFIX, type DesktopConfiguration } from "./protocol";

if (!app.isPackaged && process.env.CAMPUSOS_DESKTOP_CDP_PORT) app.commandLine.appendSwitch("remote-debugging-port", process.env.CAMPUSOS_DESKTOP_CDP_PORT);

let window: BrowserWindow | null = null;
let helper: ChildProcessWithoutNullStreams | null = null;
let configuration: DesktopConfiguration | null = null;
let stopping = false;
let sequence = 0;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
function post(message: unknown): void { if (process.connected) process.send?.(message, () => undefined); }
function native(command: string): void { if (helper?.stdin.writable) helper.stdin.write(command + "\n"); }
async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error("桌面日历已关闭。")); }
  pending.clear();
  const child = helper;
  if (child && child.exitCode === null && child.signalCode === null) {
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => { child.kill(); resolve(); }, 2000);
      child.once("exit", () => { clearTimeout(timeout); resolve(); });
      child.stdin.end();
    });
  }
  window?.destroy();
  app.exit();
}
function trusted(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): void {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame?.url !== configuration?.url) throw new Error("Unknown desktop frame");
}
for (const suffix of DESKTOP_REQUESTS) {
  ipcMain.handle(PREFIX + suffix, (event, ...args: unknown[]) => {
    trusted(event);
    if (stopping || !process.connected || pending.size >= 64) throw new Error("桌面日历连接不可用。");
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error("日历操作超时。")); }, 30000);
      pending.set(id, { resolve, reject, timer });
      post({ type: "request", id, channel: PREFIX + suffix, args });
    });
  });
}
for (const suffix of DESKTOP_EVENTS) {
  ipcMain.on(PREFIX + suffix, (event, value: unknown) => {
    trusted(event);
    if (suffix === "close") { post({ type: "close" }); return; }
    if (suffix === "transparency") {
      if (typeof value === "number" && value >= 0.3 && value <= 1) window?.setOpacity(value);
      return;
    }
    if (!configuration?.locked) native(suffix);
  });
}

async function start(config: DesktopConfiguration): Promise<void> {
  configuration = config;
  await app.whenReady();
  if (stopping) return;
  const win = new BrowserWindow({
    ...config.bounds, title: "CampusOS 桌面日历", transparent: true, frame: false,
    resizable: false, movable: false, hasShadow: false, skipTaskbar: true, show: false,
    focusable: false,
    webPreferences: { preload: config.preload, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
  });
  window = win;
  win.setMenu(null);
  win.setOpacity(config.opacity);
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => { if (url !== config.url) event.preventDefault(); });
  win.webContents.on("will-redirect", (event) => event.preventDefault());
  win.webContents.on("render-process-gone", () => { post({ type: "failure" }); void stop(); });
  win.on("closed", () => { window = null; void stop(); });
  await win.loadURL(config.url);
  win.showInactive();
  const rect = config.physicalBounds;
  helper = spawn(config.helper, [win.getNativeWindowHandle().readBigUInt64LE().toString(), String(rect.x), String(rect.y), String(rect.width), String(rect.height)], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  helper.stdin.on("error", () => { if (!stopping) { post({ type: "failure" }); void stop(); } });
  helper.stderr.resume();
  createInterface({ input: helper.stdout }).on("line", (line) => {
    if (line === "ready") post({ type: "ready" });
    else if (line.startsWith("double-click=")) {
      const duration = Number(line.slice(13));
      if (duration >= 1 && duration <= 5000) win.webContents.send(PREFIX + "input-settings", duration);
    }
    else if (line.startsWith("wheel=")) {
      const values = line.slice(6).split(",").map(Number);
      if (values.length === 5 && values.every(Number.isFinite) && values[3] > 0 && values[4] > 0) win.webContents.send(PREFIX + "wheel", values);
    } else if (line.startsWith("bounds=")) post({ type: "bounds", rect: line.slice(7).split(",").map(Number) });
    else if (line.startsWith("failure=")) { post({ type: "failure", reason: line.slice(8) }); void stop(); }
  });
  helper.on("error", () => { post({ type: "failure" }); void stop(); });
  helper.on("exit", (code) => { if (!stopping) { post({ type: "failure", reason: "native-host-exited", code }); void stop(); } });
}

process.on("message", (raw: unknown) => {
  if (!raw || typeof raw !== "object") return;
  const message = raw as Record<string, unknown>;
  if (message.type === "configure" && !configuration) void start(message.configuration as DesktopConfiguration).catch(() => { post({ type: "failure" }); void stop(); });
  if (message.type === "stop") void stop();
  if (message.type === "response" && typeof message.id === "number") {
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id); clearTimeout(item.timer);
    if (message.error) item.reject(new Error(String(message.error))); else item.resolve(message.value);
  }
  if (message.type === "push" && typeof message.channel === "string" && [PREFIX + "changed", PREFIX + "settings-changed"].includes(message.channel)) window?.webContents.send(message.channel, message.payload);
  if (message.type === "settings" && configuration && typeof message.opacity === "number" && typeof message.locked === "boolean") {
    configuration.locked = message.locked;
    window?.setOpacity(message.opacity);
    if (message.locked) native("drag-end");
  }
});
process.on("disconnect", () => { void stop(); });
app.on("window-all-closed", () => { void stop(); });
post({ type: "online" });
