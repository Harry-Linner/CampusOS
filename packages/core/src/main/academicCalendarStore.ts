import { app, ipcMain } from "electron";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AcademicCalendarSettings,
  AcademicCalendarSettingsInput
} from "@campusos/shared";
import { normalizeAcademicCalendarSettings } from "@campusos/shared";
import { getOfficialDatabaseService } from "./officialDatabaseService";

const ACADEMIC_CALENDAR_FILE = "academic-calendar.json";

const getAcademicCalendarPath = (): string =>
  join(app.getPath("userData"), "settings", ACADEMIC_CALENDAR_FILE);

const STATE_KEY = "academic-calendar-settings";

const readStored = async (): Promise<AcademicCalendarSettings> => {
  const storagePath = getAcademicCalendarPath();
  const database = getOfficialDatabaseService();
  const stored = database.loadDesktopCalendarState(STATE_KEY);
  if (stored) {
    return normalizeAcademicCalendarSettings({
      ...(stored.value as Partial<AcademicCalendarSettingsInput>),
      savedAt: stored.savedAt
    }, database.databasePath);
  }
  try {
    const raw = await readFile(storagePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<AcademicCalendarSettingsInput>;
    const migrated = normalizeAcademicCalendarSettings(parsed, database.databasePath);
    const savedAt = typeof parsed.savedAt === "string" && Number.isFinite(Date.parse(parsed.savedAt))
      ? parsed.savedAt
      : new Date().toISOString();
    database.saveDesktopCalendarState(STATE_KEY, {
      statutoryHolidays: migrated.statutoryHolidays,
      makeupDays: migrated.makeupDays
    }, savedAt);
    return { ...migrated, savedAt };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return normalizeAcademicCalendarSettings({}, database.databasePath);
    }
    throw error;
  }
};

export const loadAcademicCalendarSettings = async (): Promise<AcademicCalendarSettings> =>
  readStored();

export const saveAcademicCalendarSettings = async (
  input: AcademicCalendarSettingsInput
): Promise<AcademicCalendarSettings> => {
  const database = getOfficialDatabaseService();
  const next = normalizeAcademicCalendarSettings(input, database.databasePath);
  const payload = {
    statutoryHolidays: next.statutoryHolidays,
    makeupDays: next.makeupDays,
    savedAt: new Date().toISOString()
  };
  database.saveDesktopCalendarState(STATE_KEY, {
    statutoryHolidays: payload.statutoryHolidays,
    makeupDays: payload.makeupDays
  }, payload.savedAt);
  return {
    ...next,
    savedAt: payload.savedAt,
    storagePath: database.databasePath
  };
};

export const registerAcademicCalendarHandlers = (): void => {
  ipcMain.handle("campusos:academic-calendar:settings:load", async () =>
    loadAcademicCalendarSettings()
  );
  ipcMain.handle(
    "campusos:academic-calendar:settings:save",
    async (_event, input: unknown) => {
      const candidate = typeof input === "object" && input !== null
        ? input as AcademicCalendarSettingsInput
        : {};
      return saveAcademicCalendarSettings(candidate);
    }
  );
};
