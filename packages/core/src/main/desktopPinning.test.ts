import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";

// 基础/回退路径：无 proto/register/pointer 回调能力，WorkerW 嵌入不可用 → 回退 GW_HWNDNEXT。
const setWindowPos = vi.fn(() => true);
const setParent = vi.fn((_: number, parent: number) => {
  nativeState.parent = parent;
  return 1;
});
const setWindowLongPtr = vi.fn(() => 1);
const nativeState = {
  workerEnabled: false,
  parent: 0,
  enumCallback: null as null | ((window: number) => number)
};

vi.mock("koffi", () => ({
  default: {
    proto: () => ({}),
    pointer: () => ({}),
    register: (callback: (window: number) => number) => {
      nativeState.enumCallback = callback;
      return callback;
    },
    load: () => ({
      func: (signature: string) => {
        if (signature.includes("SetWindowPos")) return setWindowPos;
        if (signature.includes("FindWindowW")) return () => 0xffff; // Progman
        if (signature.includes("FindWindowExW")) return (parent: number, _after: number, cls: string) => {
          if (!nativeState.workerEnabled || parent !== 0xffff) return 0;
          return cls === "WorkerW" ? 0x200 : cls === "SHELLDLL_DefView" ? 0x300 : 0;
        };
        if (signature.includes("SendMessageTimeoutW")) return () => 1;
        if (signature.includes("EnumWindows")) return () => 1;
        if (signature.includes("SetParent")) return setParent;
        if (signature.includes("GetAncestor")) return () => nativeState.parent;
        if (signature.includes("GetWindowLongPtrW")) return (_hwnd: number, index: number) => index === -16 ? 0x80000000 : 0x00080000;
        if (signature.includes("SetWindowLongPtrW")) return setWindowLongPtr;
        if (signature.includes("ShowWindow")) return () => true;
        if (signature.includes("GetWindowRect")) return (hwnd: number, rect: Buffer) => {
          const values = hwnd === 0x51a5c ? [100, 200, 500, 600] : [-1920, 0, 1920, 1080];
          values.forEach((value, index) => rect.writeInt32LE(value, index * 4));
          return true;
        };
        if (signature.includes("GetSystemMetrics")) return (index: number) => index === 76 ? -1920 : 0;
        // GetWindow(Progman, GW_HWNDNEXT=2) → 桌面上方锚点
        return (hWnd: number, cmd: number) => (cmd === 2 ? 0xfffe : 0);
      }
    })
  }
}));

import { pinWindowToDesktopBottom } from "./desktopPinning";

type WindowStub = {
  getNativeWindowHandle: () => Buffer;
  isAlwaysOnTop: () => boolean;
  on: (event: string, callback: () => void) => void;
};

const createWindowStub = ({ handleBytes = 8, hwnd = 0x51a5c }: { handleBytes?: number; hwnd?: number } = {}): BrowserWindow => {
  const handle = Buffer.alloc(handleBytes);
  if (handleBytes >= 8) handle.writeBigUInt64LE(BigInt(hwnd), 0);
  const listeners: Record<string, Array<() => void>> = {};
  const stub: WindowStub = {
    getNativeWindowHandle: () => handle,
    isAlwaysOnTop: () => false,
    on: (event, callback) => {
      (listeners[event] ??= []).push(callback);
    }
  };
  (stub as unknown as { __listeners: Record<string, Array<() => void>> }).__listeners = listeners;
  return stub as unknown as BrowserWindow;
};

describe("pinWindowToDesktopBottom", () => {
  afterEach(() => {
    setWindowPos.mockClear();
    setWindowPos.mockImplementation(() => true);
    setParent.mockClear();
    setWindowLongPtr.mockClear();
    nativeState.workerEnabled = false;
    nativeState.parent = 0;
    vi.restoreAllMocks();
  });

  it("presses the window to just above the desktop layer on registration and again on focus", () => {
    const win = createWindowStub();
    pinWindowToDesktopBottom(win);
    expect(setWindowPos).toHaveBeenCalledTimes(1);
    expect(setWindowPos).toHaveBeenCalledWith(0x51a5c, 0xfffe, 0, 0, 0, 0, 0x213);

    const listeners = (win as unknown as { __listeners: Record<string, Array<() => void>> }).__listeners;
    listeners.focus?.[0]?.();
    expect(setWindowPos).toHaveBeenCalledTimes(2);
  });

  it("ignores windows with unusable native handles without throwing", () => {
    const win = createWindowStub({ handleBytes: 4 });
    expect(() => pinWindowToDesktopBottom(win)).not.toThrow();
    expect(setWindowPos).not.toHaveBeenCalled();
  });

  it("uses virtual-screen coordinates for a raised desktop WorkerW", () => {
    nativeState.workerEnabled = true;
    const win = createWindowStub();
    pinWindowToDesktopBottom(win);

    expect(setParent).toHaveBeenCalledWith(0x51a5c, 0xffff);
    expect(setWindowLongPtr).toHaveBeenCalledWith(0x51a5c, -16, 0x40000000);
    expect(setWindowPos).toHaveBeenCalledWith(0x51a5c, 0x300, 2020, 200, 400, 400, 0x70);
  });

  it("restores the top-level parent and styles before falling back after an attach failure", () => {
    nativeState.workerEnabled = true;
    setWindowPos.mockImplementation((hwnd: number) => !(hwnd === 0x51a5c && nativeState.parent !== 0));
    const win = createWindowStub();
    pinWindowToDesktopBottom(win);

    expect(setParent).toHaveBeenLastCalledWith(0x51a5c, 0);
    expect(setWindowLongPtr).toHaveBeenCalledWith(0x51a5c, -16, 0x80000000);
    expect(setWindowLongPtr).toHaveBeenCalledWith(0x51a5c, -20, 0x00080000);
    expect(setWindowPos).toHaveBeenCalledWith(0x51a5c, 0xfffe, 0, 0, 0, 0, 0x213);
  });
});
