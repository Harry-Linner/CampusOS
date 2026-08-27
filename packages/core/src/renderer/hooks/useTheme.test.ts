/* @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTheme, resolveThemeMode, useTheme } from "./useTheme";

const STORAGE_KEY = "campusos.theme";

afterEach(() => {
  vi.restoreAllMocks();
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // Ignore
  }
  document.documentElement.removeAttribute("data-theme");
});

describe("resolveThemeMode", () => {
  it("passes explicit modes through unchanged", () => {
    expect(resolveThemeMode("light")).toBe("light");
    expect(resolveThemeMode("dark")).toBe("dark");
    expect(resolveThemeMode("high-contrast")).toBe("high-contrast");
  });

  it("resolves system mode from the prefers-color-scheme media query", () => {
    vi.spyOn(globalThis, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    expect(resolveThemeMode("system")).toBe("dark");
    vi.spyOn(globalThis, "matchMedia").mockReturnValue({ matches: false } as MediaQueryList);
    expect(resolveThemeMode("system")).toBe("light");
  });

  it("defaults system mode to light when matchMedia is unavailable", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(resolveThemeMode("system")).toBe("light");
  });
});

describe("applyTheme", () => {
  it("writes the resolved theme attribute and persists the raw mode", () => {
    vi.spyOn(globalThis, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    applyTheme("system");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(globalThis.localStorage?.getItem(STORAGE_KEY)).toBe("system");
  });

  it("writes explicit modes verbatim", () => {
    applyTheme("high-contrast");
    expect(document.documentElement.getAttribute("data-theme")).toBe("high-contrast");
  });
});

describe("useTheme", () => {
  it("subscribes to system color-scheme changes while in system mode", () => {
    const listeners: Array<() => void> = [];
    const addEventListener = vi.fn((_: string, listener: () => void) => { listeners.push(listener); });
    const removeEventListener = vi.fn();
    vi.spyOn(globalThis, "matchMedia").mockReturnValue({
      matches: false,
      addEventListener,
      removeEventListener
    } as unknown as MediaQueryList);

    const { result } = renderHook(() => useTheme());
    act(() => result.current.setTheme("system"));
    expect(addEventListener).toHaveBeenCalledWith("change", expect.any(Function));
    // Simulate the OS switching to dark: the listener re-applies the resolved theme.
    const media = globalThis.matchMedia("(prefers-color-scheme: dark)") as unknown as { matches: boolean };
    Object.defineProperty(media, "matches", { value: true });
    act(() => { listeners.forEach((listener) => listener()); });
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    act(() => result.current.setTheme("light"));
    expect(removeEventListener).toHaveBeenCalled();
  });
});
