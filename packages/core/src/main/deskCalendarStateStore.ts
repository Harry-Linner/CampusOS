import { app } from "electron";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CalendarEventPersonalization } from "@campusos/shared";
import { getOfficialDatabaseService } from "./officialDatabaseService";

export const DESK_CALENDAR_STATE_KEYS = {
  settings: "desk-calendar-settings",
  geometries: "desk-calendar-geometries",
  visibility: "desk-calendar-visibility",
  personalizations: "calendar-event-personalizations"
} as const;

const legacyPath = (name: string): string => join(app.getPath("userData"), "settings", name);

export const loadDesktopState = <T>(key: string, fallback: T, legacyFile?: string): T => {
  const database = getOfficialDatabaseService();
  const stored = database.loadDesktopCalendarState(key);
  if (stored) return stored.value as T;
  if (legacyFile) {
    try {
      const parsed = JSON.parse(readFileSync(legacyPath(legacyFile), "utf8")) as T;
      database.saveDesktopCalendarState(key, parsed, new Date().toISOString());
      return parsed;
    } catch {
      // Missing or malformed legacy JSON falls through to the normalized default.
    }
  }
  return fallback;
};

export const saveDesktopState = (key: string, value: unknown): void => {
  getOfficialDatabaseService().saveDesktopCalendarState(key, value, new Date().toISOString());
};

export type CalendarEventPersonalizationMap = Record<string, CalendarEventPersonalization>;

export const loadCalendarEventPersonalizations = (): CalendarEventPersonalizationMap =>
  loadDesktopState(DESK_CALENDAR_STATE_KEYS.personalizations, {});

export const saveCalendarEventPersonalization = (
  eventId: string,
  input: { note?: string; reminderLeadMinutes?: number | null }
): CalendarEventPersonalization => {
  if (!eventId.trim()) throw new Error("事件不存在。");
  const records = loadCalendarEventPersonalizations();
  const next: CalendarEventPersonalization = {
    note: typeof input.note === "string" ? input.note.slice(0, 4_000) : (records[eventId]?.note ?? ""),
    reminderLeadMinutes: input.reminderLeadMinutes === null
      ? null
      : Number.isFinite(input.reminderLeadMinutes)
        ? Math.max(0, Math.round(input.reminderLeadMinutes ?? 0))
        : (records[eventId]?.reminderLeadMinutes ?? null),
    updatedAt: new Date().toISOString()
  };
  saveDesktopState(DESK_CALENDAR_STATE_KEYS.personalizations, { ...records, [eventId]: next });
  return next;
};
