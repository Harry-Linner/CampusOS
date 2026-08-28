import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";

const setWindowPos = vi.fn(() => true);

vi.mock("koffi", () => ({
  default: {
    load: () => ({
      func: (signature: string) => {
        if (signature.includes("SetWindowPos")) return setWindowPos;
        if (signature.includes("FindWindowW")) return () => 0xffff; // Progman
        // GetWindow(Progman, GW_HWNDNEXT=2) → 桌面上方锚点
        return (hWnd: number, cmd: number) => (cmd === 2 ? 0xfffe : 0);
      }
    })
  }
}));

import { pinWindowToDesktopBottom } from "./desktopPinning";

type WindowStub = {
  getNativeWindowHandle: () => Buffer;
  on: (event: string, callback: () => void) => void;
};

const createWindowStub = ({ handleBytes = 8, hwnd = 0x51a5c }: { handleBytes?: number; hwnd?: number } = {}): BrowserWindow => {
  const handle = Buffer.alloc(handleBytes);
  if (handleBytes >= 8) handle.writeBigUInt64LE(BigInt(hwnd), 0);
  const listeners: Record<string, Array<() => void>> = {};
  const stub: WindowStub = {
    getNativeWindowHandle: () => handle,
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
});
