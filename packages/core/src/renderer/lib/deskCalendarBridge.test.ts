/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { CampusosBridge } from "../../shared/campusBridge";
import type { DeskCalendarControlBridge } from "@campusos/shared";
import {
  loadDeskCalendarSettings,
  setDeskCalendarEnabled,
  setDeskCalendarView,
  subscribeToDeskCalendarChanges
} from "./deskCalendarBridge";

const bridgeState = vi.hoisted(() => ({
  bridge: null as unknown as DeskCalendarControlBridge
}));

const installBridge = (bridge: DeskCalendarControlBridge): void => {
  bridgeState.bridge = bridge;
  (window as Window & { campusos?: CampusosBridge }).campusos = {
    shell: { platform: "win32", phase: "dev", storageMode: "sqlite" },
    workspace: {
      hydrate: vi.fn(),
      sync: vi.fn()
    },
    credentials: {
      academicAffairs: {} as CampusosBridge["credentials"]["academicAffairs"]
    },
    reminders: {} as CampusosBridge["reminders"],
    downloads: {} as CampusosBridge["downloads"],
    plugins: {} as CampusosBridge["plugins"],
    diagnostics: {} as CampusosBridge["diagnostics"],
    updates: {} as CampusosBridge["updates"],
    deskCalendar: bridge
  };
};

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as Window & { campusos?: CampusosBridge }).campusos;
});

describe("deskCalendarBridge", () => {
  it("delegates settings loading, enable toggling, and view switching", async () => {
    const loadSettings = vi.fn(async () => ({
      enabled: false,
      view: "month" as const,
      savedAt: "2026-08-15T00:00:00.000Z",
      storagePath: "C:/settings/desk-calendar.json"
    }));
    const setEnabled = vi.fn(async (enabled: boolean) => ({
      enabled,
      view: "month" as const,
      savedAt: "2026-08-15T00:00:00.000Z",
      storagePath: "C:/settings/desk-calendar.json"
    }));
    const setView = vi.fn(async (view: "month" | "week" | "day") => ({
      enabled: true,
      view,
      savedAt: "2026-08-15T00:00:00.000Z",
      storagePath: "C:/settings/desk-calendar.json"
    }));
    installBridge({ loadSettings, setEnabled, setView, subscribe: vi.fn() } as unknown as DeskCalendarControlBridge);

    await expect(loadDeskCalendarSettings()).resolves.toMatchObject({
      enabled: false,
      view: "month"
    });
    await setDeskCalendarEnabled(true);
    expect(setEnabled).toHaveBeenCalledWith(true);
    await setDeskCalendarView("day");
    expect(setView).toHaveBeenCalledWith("day");
  });

  it("subscribes to desk calendar changes", () => {
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(() => unsubscribe);
    installBridge({ subscribe } as unknown as DeskCalendarControlBridge);
    const listener = vi.fn();
    const result = subscribeToDeskCalendarChanges(listener);
    expect(subscribe).toHaveBeenCalledWith(listener);
    result();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("throws a user-facing error when the desk calendar bridge is unavailable", () => {
    delete (window as Window & { campusos?: CampusosBridge }).campusos;
    expect(() => loadDeskCalendarSettings()).toThrow("CampusOS 桌面日历服务不可用。");
    expect(() => setDeskCalendarView("month")).toThrow("CampusOS 桌面日历服务不可用。");
  });
});
