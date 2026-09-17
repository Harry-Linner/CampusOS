import { app, screen, type Rectangle } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDesktopRequest, validDesktopArguments, type DesktopConfiguration } from "../desktop/protocol";

// The inherited Node IPC pipe is the only control endpoint. No TCP port, named
// pipe, account profile or renderer-selected path is exposed to the desktop host.
export class DesktopProcess {
  private child: ChildProcess | null = null;
  private stopped = false;
  private stopPending: Promise<void> | null = null;
  private bounds: Rectangle;
  private physicalBounds: Rectangle;
  constructor(private configuration: DesktopConfiguration, private request: (channel: string, args: unknown[]) => Promise<unknown>, private geometry: (bounds: Rectangle) => void, private closed: (unexpected: boolean) => void) {
    this.bounds = configuration.bounds;
    this.physicalBounds = configuration.physicalBounds;
  }
  getBounds(): Rectangle { return this.bounds; }
  getPhysicalBounds(): Rectangle { return this.physicalBounds; }
  isDestroyed(): boolean { return this.stopped; }
  send(channel: string, payload?: unknown): void { this.post({ type: "push", channel, payload }); }
  private post(message: Record<string, unknown>): void {
    if (this.child?.connected) this.child.send(message, () => { /* exit races are handled by exit */ });
  }
  settings(opacity: number, locked: boolean): void { this.post({ type: "settings", opacity, locked }); }
  async start(): Promise<void> {
    const profile = await mkdtemp(join(app.getPath("temp"), "campusos-desktop-"));
    if (this.stopped) { await rm(profile, { recursive: true, force: true }); return; }
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    // The child has a separate, opt-in developer endpoint.
    if (!app.isPackaged && env.CAMPUSOS_DEV_CDP_PORT && !env.CAMPUSOS_DESKTOP_CDP_PORT) env.CAMPUSOS_DESKTOP_CDP_PORT = String(Number(env.CAMPUSOS_DEV_CDP_PORT) + 1);
    delete env.CAMPUSOS_DEV_CDP_PORT;
    const child = spawn(process.execPath, [...(app.isPackaged ? [] : [join(dirname(fileURLToPath(import.meta.url)), "main.js")]), "--campusos-desktop-host", `--user-data-dir=${profile}`], {
      env, windowsHide: true, stdio: ["ignore", "ignore", "pipe", "ipc"]
    });
    this.child = child;
    // Consume native diagnostics without logging calendar data or child payloads.
    child.stderr?.resume();
    await new Promise<void>((resolve, reject) => {
      let ready = false;
      const timeout = setTimeout(() => { reject(new Error("桌面日历启动超时。")); this.destroy(); }, 15000);
      child.on("message", (raw: unknown) => {
        if (!raw || typeof raw !== "object") return;
        const message = raw as Record<string, unknown>;
        if (message.type === "online") this.post({ type: "configure", configuration: this.configuration });
        if (message.type === "ready") { ready = true; clearTimeout(timeout); resolve(); }
        if (message.type === "failure") {
          if (typeof message.reason === "string" && /^[a-z-]{1,80}$/.test(message.reason)) process.stderr.write(`[CampusOS desktop] ${message.reason}\n`);
          clearTimeout(timeout);
          if (!ready) { reject(new Error("无法连接 Windows 桌面层，请重新打开桌面日历。")); void this.destroy(); }
          else this.post({ type: "stop" });
        }
        if (message.type === "close") this.destroy();
        if (message.type === "bounds" && Array.isArray(message.rect) && message.rect.length === 4 && message.rect.every((v) => typeof v === "number" && Number.isFinite(v))) {
          const [x, y, width, height] = message.rect as number[];
          if (width < 200 || height < 150 || width > 20000 || height > 20000) return;
          this.physicalBounds = { x, y, width, height };
          this.bounds = screen.screenToDipRect(null, { x, y, width, height });
          this.geometry(this.bounds);
        }
        if (message.type === "request" && Number.isSafeInteger(message.id) && isDesktopRequest(message.channel) && Array.isArray(message.args)) {
          const id = message.id;
          if (this.stopped || !validDesktopArguments(message.channel, message.args)) { this.post({ type: "response", id, error: "Invalid calendar request" }); return; }
          void this.request(message.channel, message.args).then(
            (value) => this.post({ type: "response", id, value }),
            () => this.post({ type: "response", id, error: "日历操作失败，请重试。" })
          );
        }
      });
      child.once("error", () => { clearTimeout(timeout); reject(new Error("桌面日历进程无法启动。")); });
      child.once("exit", () => {
        clearTimeout(timeout);
        if (!ready) reject(new Error("桌面日历进程提前退出。"));
        const unexpected = ready && !this.stopped;
        this.stopped = true;
        this.child = null;
        this.closed(unexpected);
        void rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined);
      });
    });
  }
  destroy(): Promise<void> {
    if (this.stopPending) return this.stopPending;
    this.stopped = true;
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    this.post({ type: "stop" });
    this.stopPending = new Promise<void>((resolve) => {
      const timeout = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill(); }, 4000);
      child.once("exit", () => { clearTimeout(timeout); resolve(); });
    });
    return this.stopPending;
  }
}
