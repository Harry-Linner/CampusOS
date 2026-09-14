import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  openAtLogin: false,
  stored: {} as Record<string, unknown>,
  saves: [] as Array<Record<string, unknown>>
}));

vi.mock("electron", () => ({
  app: {
    getLoginItemSettings: vi.fn(() => ({ openAtLogin: state.openAtLogin }))
  }
}));

vi.mock("./deskCalendarStateStore", () => ({
  DESK_CALENDAR_STATE_KEYS: { settings: "settings" },
  loadDesktopState: vi.fn(() => ({ ...state.stored })),
  saveDesktopState: vi.fn((_key: string, value: Record<string, unknown>) => {
    state.stored = { ...value };
    state.saves.push({ ...value });
  })
}));

import {
  enforceCampusAutoStartDependency,
  loadDeskCalendarSettings,
  saveDeskCalendarSettings
} from "./deskCalendarSettings";

beforeEach(() => {
  state.openAtLogin = false;
  state.stored = {};
  state.saves = [];
});

describe("desk calendar settings store", () => {
  it("returns defaults for an empty store", () => {
    expect(loadDeskCalendarSettings()).toMatchObject({
      showWeeks: true,
      showHolidays: true,
      showLunar: false,
      opacity: 0.98,
      bgColor: "",
      locked: false,
      autoStart: false,
      campusAutoStartEnabled: false,
      colors: { calendar: "", cell: "", todayBorder: "", lunar: "", holiday: "" }
    });
  });

  it("retires the removed topmost preference and keeps the rest", () => {
    state.stored = { alwaysOnTop: true, showLunar: true, opacity: 0.5 };

    const settings = loadDeskCalendarSettings();

    expect(settings).not.toHaveProperty("alwaysOnTop");
    expect(settings).toMatchObject({ showLunar: true, opacity: 0.5 });
    expect(state.saves).toHaveLength(1);
    expect(state.saves[0]).not.toHaveProperty("alwaysOnTop");
    expect(state.stored).not.toHaveProperty("alwaysOnTop");
  });

  it("only reports autoStart while CampusOS itself auto-starts", () => {
    state.stored = { autoStart: true };

    state.openAtLogin = false;
    expect(loadDeskCalendarSettings()).toMatchObject({ autoStart: false, campusAutoStartEnabled: false });

    state.openAtLogin = true;
    expect(loadDeskCalendarSettings()).toMatchObject({ autoStart: true, campusAutoStartEnabled: true });
  });

  it("merges a patch without dropping the stored colour overrides", () => {
    state.stored = { colors: { calendar: "#111", lunar: "#222" }, opacity: 0.4 };

    const next = saveDeskCalendarSettings({ opacity: 0.7, colors: { lunar: "#333" } } as never);

    expect(next.colors).toEqual({ calendar: "#111", cell: "", todayBorder: "", lunar: "#333", holiday: "" });
    expect(next.opacity).toBe(0.7);
    expect(state.stored).toMatchObject({ opacity: 0.7 });
  });

  it("clears the stored auto-start flag when CampusOS auto-start is off", () => {
    state.stored = { autoStart: true, showLunar: true };

    enforceCampusAutoStartDependency(false);
    expect(state.stored).toMatchObject({ autoStart: false, showLunar: true });

    state.saves = [];
    state.stored = { autoStart: true };
    enforceCampusAutoStartDependency(true);
    expect(state.saves).toHaveLength(0);
    expect(state.stored).toMatchObject({ autoStart: true });
  });
});
