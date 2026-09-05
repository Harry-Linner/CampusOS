import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";

const CALENDAR = 100;
const APP = 200;
const ICON_HOST = 300;
const PROGMAN = 400;
const state = vi.hoisted(() => ({ order: [100, 200, 300, 400], visible: true, raised: false, desktop: true, topmostAnchor: false }));
const setWindowPos = vi.hoisted(() => vi.fn());
const setParent = vi.hoisted(() => vi.fn());

vi.mock("koffi", () => ({ default: {
  proto: () => ({}), pointer: () => ({}), register: (cb: unknown) => cb,
  load: () => ({ func: (signature: string) => {
    if (signature.includes("SetWindowPos")) return setWindowPos;
    if (signature.includes("SetParent")) return setParent;
    if (signature.includes("FindWindowExW")) return (parent: number, _after: number, cls: string) => {
      if (!state.desktop) return 0;
      if (state.raised && parent === 400) return cls === "WorkerW" ? 500 : cls === "SHELLDLL_DefView" ? 600 : 0;
      return parent === 300 && cls === "SHELLDLL_DefView" ? 600 : 0;
    };
    if (signature.includes("FindWindowW")) return () => state.desktop ? 400 : 0;
    if (signature.includes("IsWindowVisible")) return () => state.visible;
    if (signature.includes("GetWindowLongPtrW")) return () => state.topmostAnchor ? 8 : 0;
    if (signature === "GetWindow") return (hwnd: number, cmd: number) => {
      const index = state.order.indexOf(hwnd);
      if (cmd === 0) return state.order[0] ?? 0;
      if (cmd === 2) return state.order[index + 1] ?? 0;
      if (cmd === 3) return state.order[index - 1] ?? 0;
      return 0;
    };
    return () => 0;
  } })
} }));

import { pinWindowToDesktopBottom } from "./desktopPinning";

class TestWindow extends EventEmitter {
  destroyed = false;
  getNativeWindowHandle = () => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(CALENDAR)); return b; };
  isDestroyed = () => this.destroyed;
  hide = vi.fn(() => { state.visible = false; this.emit("hide"); });
  showInactive = vi.fn(() => { state.visible = true; this.emit("show"); });
  pin(): void { pinWindowToDesktopBottom(this as unknown as BrowserWindow); }
}

describe("interactive desktop pinning", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    Object.assign(state, { order: [CALENDAR, APP, ICON_HOST, PROGMAN], visible: true, raised: false, desktop: true, topmostAnchor: false });
    setWindowPos.mockReset(); setParent.mockReset();
  });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it.each([false, true])("keeps a top-level window above the icon host (raised=%s)", (raised) => {
    state.raised = raised;
    if (raised) state.order = [CALENDAR, APP, PROGMAN];
    const win = new TestWindow(); win.pin();
    expect(setParent).not.toHaveBeenCalled();
    expect(setWindowPos).toHaveBeenLastCalledWith(CALENDAR, APP, 0, 0, 0, 0, 0x213);
  });

  it("does not reorder an already correctly placed window", () => {
    state.order = [APP, CALENDAR, ICON_HOST, PROGMAN];
    const win = new TestWindow(); win.pin(); win.emit("focus");
    expect(setWindowPos).not.toHaveBeenCalled();
  });

  it("uses HWND_TOP when the desktop has no ordinary window above it", () => {
    state.order = [ICON_HOST, PROGMAN, CALENDAR];
    const win = new TestWindow(); win.pin();
    expect(setWindowPos).toHaveBeenLastCalledWith(CALENDAR, 0, 0, 0, 0, 0, 0x213);
  });

  it("does not inherit topmost status from a topmost predecessor", () => {
    state.order = [APP, ICON_HOST, PROGMAN, CALENDAR]; state.topmostAnchor = true;
    const win = new TestWindow(); win.pin();
    expect(setWindowPos).toHaveBeenLastCalledWith(CALENDAR, 0, 0, 0, 0, 0, 0x213);
  });

  it("waits for first show before recovering shell hiding and stops on close", () => {
    state.visible = false;
    const win = new TestWindow(); win.pin(); vi.advanceTimersByTime(1000);
    expect(win.showInactive).not.toHaveBeenCalled();
    win.showInactive(); state.visible = false;
    vi.advanceTimersByTime(500);
    expect(win.hide).toHaveBeenCalledTimes(1);
    expect(win.showInactive).toHaveBeenCalledTimes(2);
    win.destroyed = true; win.emit("closed");
    expect(vi.getTimerCount()).toBe(0);
    expect(win.listenerCount("focus")).toBe(0);
    expect(win.listenerCount("always-on-top-changed")).toBe(0);
  });

  it("repairs a visible window after Explorer reorders the desktop", () => {
    const win = new TestWindow(); win.pin(); win.emit("show"); setWindowPos.mockClear();
    state.order = [ICON_HOST, PROGMAN, CALENDAR]; vi.advanceTimersByTime(500);
    expect(setWindowPos).toHaveBeenLastCalledWith(CALENDAR, 0, 0, 0, 0, 0, 0x213);
  });

  it("leaves the window usable when Explorer is absent", () => {
    state.desktop = false;
    const win = new TestWindow(); win.pin();
    expect(setWindowPos).not.toHaveBeenCalled();
  });
});
