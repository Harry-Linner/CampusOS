import { app, ipcMain } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getReminderSchedulerState } from "./reminderScheduler";
import type {
  ReminderSchedulerState,
  ReminderSettingsInput,
  ReminderSettingsRecord
} from "../shared/reminderBridge";
import {
  createDefaultReminderSettingsRecord,
  normalizeReminderLeadMinutes
} from "../shared/reminderBridge";

const REMINDER_SETTINGS_FILE = "reminder-settings.json";

interface StoredReminderSettingsPayload {
  enabled: boolean;
  leadMinutes: number[];
  savedAt: string;
}

const getReminderSettingsPath = (): string =>
  join(app.getPath("userData"), "preferences", REMINDER_SETTINGS_FILE);

const ensureReminderSettingsDir = async (storagePath: string): Promise<void> => {
  await mkdir(dirname(storagePath), { recursive: true });
};

const toReminderSettingsRecord = (
  payload: StoredReminderSettingsPayload,
  storagePath: string
): ReminderSettingsRecord => ({
  enabled: payload.enabled,
  leadMinutes: normalizeReminderLeadMinutes(payload.leadMinutes),
  savedAt: payload.savedAt,
  storagePath
});

const readStoredReminderSettings = async (): Promise<{
  payload: StoredReminderSettingsPayload;
  storagePath: string;
} | null> => {
  const storagePath = getReminderSettingsPath();

  try {
    const raw = await readFile(storagePath, "utf8");
    const payload = JSON.parse(raw) as StoredReminderSettingsPayload;

    return {
      payload,
      storagePath
    };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }

    throw error;
  }
};

export const readReminderSettingsRecord =
  async (): Promise<ReminderSettingsRecord> => {
    const stored = await readStoredReminderSettings();

    if (!stored) {
      return createDefaultReminderSettingsRecord(getReminderSettingsPath());
    }

    return toReminderSettingsRecord(stored.payload, stored.storagePath);
  };

export const saveReminderSettingsRecord = async (
  input: ReminderSettingsInput
): Promise<ReminderSettingsRecord> => {
  const storagePath = getReminderSettingsPath();
  const payload: StoredReminderSettingsPayload = {
    enabled: input.enabled,
    leadMinutes: normalizeReminderLeadMinutes(input.leadMinutes),
    savedAt: new Date().toISOString()
  };

  await ensureReminderSettingsDir(storagePath);
  await writeFile(storagePath, JSON.stringify(payload, null, 2), "utf8");

  return toReminderSettingsRecord(payload, storagePath);
};

export const loadReminderSchedulerState =
  async (): Promise<ReminderSchedulerState> => getReminderSchedulerState();

export const registerReminderSettingsHandlers = (): void => {
  ipcMain.handle("campusos:reminders:settings:load", async () =>
    readReminderSettingsRecord()
  );
  ipcMain.handle(
    "campusos:reminders:settings:save",
    async (_event, input: ReminderSettingsInput) => saveReminderSettingsRecord(input)
  );
  ipcMain.handle("campusos:reminders:schedule-state:load", async () =>
    loadReminderSchedulerState()
  );
};
