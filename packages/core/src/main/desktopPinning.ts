import { type BrowserWindow } from "electron";
import koffi from "koffi";

// Interactive calendars must stay above Explorer's input surface. A visible
// WorkerW child is still behind SHELLDLL_DefView/SysListView32 for mouse input.
// Keep Electron's top-level window, styles and DPI handling intact; only move
// our own window in z-order. Never reparent it or reorder Explorer's windows.
// GetWindow: NEXT is below, PREV is above. SetWindowPos inserts BELOW its anchor.
// https://learn.microsoft.com/windows/win32/api/winuser/nf-winuser-getwindow
const GW_HWNDFIRST = 0;
const GW_HWNDNEXT = 2;
const GW_HWNDPREV = 3;
const GWL_EXSTYLE = -20;
const WS_EX_TOPMOST = 0x8;
const HWND_TOP = 0;
const SWP_FLAGS = 0x1 | 0x2 | 0x10 | 0x200; // NOSIZE | NOMOVE | NOACTIVATE | NOOWNERZORDER
const RECOVERY_INTERVAL_MS = 500;

interface User32Api {
  setWindowPos: (window: number, after: number, x: number, y: number, width: number, height: number, flags: number) => boolean;
  getWindow: (window: number, command: number) => number;
  findWindow: (className: string, title: string | null) => number;
  findWindowEx: (parent: number, after: number, className: string, title: string | null) => number;
  isWindowVisible: (window: number) => boolean;
  getWindowLongPtr: (window: number, index: number) => number;
}

let api: User32Api | null = null;
const loadUser32 = (): User32Api | null => {
  if (api) return api;
  try {
    const user32 = koffi.load("user32.dll");
    api = {
      setWindowPos: user32.func("SetWindowPos", "bool", ["uintptr_t", "uintptr_t", "int", "int", "int", "int", "uint32"]),
      getWindow: user32.func("GetWindow", "uintptr_t", ["uintptr_t", "uint32"]),
      findWindow: user32.func("intptr_t __stdcall FindWindowW(const wchar_t* cls, const wchar_t* title)"),
      findWindowEx: user32.func("intptr_t __stdcall FindWindowExW(intptr_t parent, intptr_t after, const wchar_t* cls, const wchar_t* title)"),
      isWindowVisible: user32.func("IsWindowVisible", "bool", ["uintptr_t"]),
      getWindowLongPtr: user32.func("GetWindowLongPtrW", "intptr_t", ["uintptr_t", "int32"])
    };
    return api;
  } catch {
    return null; // Native support unavailable: retain the usable Electron window.
  }
};

const readWindowHandle = (window: BrowserWindow): number | null => {
  try {
    const handle = window.getNativeWindowHandle();
    if (handle.length !== 4 && handle.length !== 8) return null;
    const value = handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE());
    return value > 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
  } catch {
    return null;
  }
};

const findDesktopInputHost = (native: User32Api): number => {
  const progman = native.findWindow("Progman", null);
  if (!progman) return 0;
  // On the classic desktop the icon view belongs to a top-level WorkerW ABOVE
  // Progman; on raised desktops it belongs to Progman. Search the actual tree.
  // Bound the traversal and detect cycles if Explorer changes while enumerating.
  const visited = new Set<number>();
  let current = native.getWindow(progman, GW_HWNDFIRST);
  while (current && !visited.has(current) && visited.size < 1024) {
    visited.add(current);
    if (native.findWindowEx(current, 0, "SHELLDLL_DefView", null)) return current;
    current = native.getWindow(current, GW_HWNDNEXT);
  }
  return progman;
};

export const pinWindowToDesktopBottom = (window: BrowserWindow): void => {
  if (process.platform !== "win32") return;
  const native = loadUser32();
  const handle = readWindowHandle(window);
  if (!native || handle === null) return;

  const repin = (): void => {
    if (window.isDestroyed()) return;
    try {
      const desktop = findDesktopInputHost(native);
      if (!desktop) return;
      const aboveDesktop = native.getWindow(desktop, GW_HWNDPREV);
      if (aboveDesktop === handle) return; // Already correct: avoid repaint loops.
      // Using a topmost HWND as insertAfter would promote the calendar to topmost.
      const anchor = aboveDesktop && !(native.getWindowLongPtr(aboveDesktop, GWL_EXSTYLE) & WS_EX_TOPMOST)
        ? aboveDesktop : HWND_TOP;
      native.setWindowPos(handle, anchor, 0, 0, 0, 0, SWP_FLAGS);
    } catch {
      // Explorer/window destruction race; the next recovery pass reads fresh HWNDs.
    }
  };

  let shown = false;
  const onShow = (): void => { shown = true; repin(); };
  const recover = (): void => {
    // Do not expose a show:false window while its page/preload is still loading.
    if (!shown || window.isDestroyed()) return;
    try {
      if (!native.isWindowVisible(handle)) {
        // Show Desktop can hide the native HWND without updating Electron's cache.
        window.hide();
        window.showInactive();
      }
      repin(); // Also recover visible windows displaced by shell/wallpaper changes.
    } catch {
      // Window may have closed during this pass.
    }
  };
  window.on("show", onShow);
  window.on("focus", repin);
  const guard = setInterval(recover, RECOVERY_INTERVAL_MS);
  guard.unref();
  window.once("closed", () => {
    clearInterval(guard);
    window.removeListener("show", onShow);
    window.removeListener("focus", repin);
  });
  repin();
};
