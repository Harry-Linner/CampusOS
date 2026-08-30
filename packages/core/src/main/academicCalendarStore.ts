import { app, ipcMain } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  AcademicCalendarSettings,
  AcademicCalendarSettingsInput
} from "@campusos/shared";
import { normalizeAcademicCalendarSettings } from "@campusos/shared";

const ACADEMIC_CALENDAR_FILE = "academic-calendar.json";

const getAcademicCalendarPath = (): string =>
  join(app.getPath("userData"), "settings", ACADEMIC_CALENDAR_FILE);

const ensureSettingsDir = async (storagePath: string): Promise<void> => {
  await mkdir(dirname(storagePath), { recursive: true });
};

const readStored = async (): Promise<AcademicCalendarSettings> => {
  const storagePath = getAcademicCalendarPath();
  try {
    const raw = await readFile(storagePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<AcademicCalendarSettingsInput>;
    return normalizeAcademicCalendarSettings(parsed, storagePath);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return normalizeAcademicCalendarSettings({}, storagePath);
    }
    throw error;
  }
};

export const loadAcademicCalendarSettings = async (): Promise<AcademicCalendarSettings> =>
  readStored();

export const saveAcademicCalendarSettings = async (
  input: AcademicCalendarSettingsInput
): Promise<AcademicCalendarSettings> => {
  const storagePath = getAcademicCalendarPath();
  const next = normalizeAcademicCalendarSettings(input, storagePath);
  const payload = {
    statutoryHolidays: next.statutoryHolidays,
    makeupDays: next.makeupDays,
    savedAt: new Date().toISOString()
  };
  await ensureSettingsDir(storagePath);
  await writeFile(storagePath, JSON.stringify(payload, null, 2), "utf8");
  return {
    ...next,
    savedAt: payload.savedAt,
    storagePath
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
