import { app } from "electron";
import {
  DESK_CALENDAR_STATE_KEYS,
  loadDesktopState,
  saveDesktopState
} from "./deskCalendarStateStore";

/**
 * Desk-calendar preferences and the rules that guard them, persisted to the
 * SQLite `desktop_calendar_state` table. The window host owns rendering and IPC
 * and reads this module; it no longer owns the persistence rules.
 */
export interface DeskCalendarSettings {
  showWeeks: boolean;
  showHolidays: boolean;
  showLunar: boolean;
  showFestival: boolean;
  showJieqi: boolean;
  showJiyi: boolean;
  glass: boolean;
  bgColor: string;
  opacity: number;
  colors: { calendar: string; cell: string; todayBorder: string; lunar: string; holiday: string };
  autoStart: boolean;
  campusAutoStartEnabled: boolean;
  locked: boolean;
}

const DEFAULT_SETTINGS: DeskCalendarSettings = {
  showWeeks: true,
  showHolidays: true,
  showLunar: false,
  showFestival: false,
  showJieqi: false,
  showJiyi: false,
  glass: false,
  bgColor: "",
  opacity: 0.98,
  colors: { calendar: "", cell: "", todayBorder: "", lunar: "", holiday: "" },
  autoStart: false,
  campusAutoStartEnabled: false,
  locked: false
};

const isCampusAutoStartEnabled = (): boolean => {
  try { return app.getLoginItemSettings().openAtLogin; } catch { return false; }
};

export const loadDeskCalendarSettings = (): DeskCalendarSettings => {
  const parsed = loadDesktopState<Partial<DeskCalendarSettings> & { alwaysOnTop?: unknown }>(
    DESK_CALENDAR_STATE_KEYS.settings,
    {},
    "desk-calendar-settings.json"
  );
  // The calendar always stays below ordinary applications. Retire the old
  // opt-in topmost setting without losing the user's other saved preferences.
  if ("alwaysOnTop" in parsed) {
    delete parsed.alwaysOnTop;
    saveDesktopState(DESK_CALENDAR_STATE_KEYS.settings, parsed);
  }
  const campusAutoStartEnabled = isCampusAutoStartEnabled();
  return {
    ...DEFAULT_SETTINGS,
    ...parsed,
    autoStart: campusAutoStartEnabled && parsed.autoStart === true,
    campusAutoStartEnabled,
    colors: { ...DEFAULT_SETTINGS.colors, ...(parsed.colors ?? {}) }
  };
};

export const saveDeskCalendarSettings = (patch: Partial<DeskCalendarSettings>): DeskCalendarSettings => {
  const current = loadDeskCalendarSettings();
  const next: DeskCalendarSettings & { alwaysOnTop?: unknown } = {
    ...current,
    ...patch,
    colors: { ...current.colors, ...(patch.colors ?? {}) }
  };
  delete next.alwaysOnTop;
  next.campusAutoStartEnabled = isCampusAutoStartEnabled();
  if (!next.campusAutoStartEnabled) next.autoStart = false;
  saveDesktopState(DESK_CALENDAR_STATE_KEYS.settings, next);
  return next;
};

/**
 * The desk calendar may only auto-start while CampusOS itself does. Clearing the
 * stored flag here keeps the rule next to the data it protects; the window host
 * separately notifies the renderer.
 */
export const enforceCampusAutoStartDependency = (campusAutoStartEnabled: boolean): void => {
  const current = loadDesktopState<Partial<DeskCalendarSettings>>(
    DESK_CALENDAR_STATE_KEYS.settings,
    {},
    "desk-calendar-settings.json"
  );
  if (!campusAutoStartEnabled && current.autoStart === true) {
    saveDesktopState(DESK_CALENDAR_STATE_KEYS.settings, { ...current, autoStart: false });
  }
};
