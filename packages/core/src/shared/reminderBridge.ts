export interface ReminderSettingsInput {
  enabled: boolean;
  leadMinutes: number[];
  /** Optional for compatibility with reminder-settings.json written before v6. */
  gradeChangesEnabled?: boolean;
}

export interface ReminderSettingsRecord extends ReminderSettingsInput {
  /** Normalized to true by the main-process store, optional for legacy callers. */
  gradeChangesEnabled?: boolean;
  savedAt: string | null;
  storagePath: string | null;
}

export interface ReminderSchedulerState {
  enabled: boolean;
  supported: boolean;
  scheduledCount: number;
  nextFireAt: string | null;
  lastScheduledAt: string | null;
  transport: "electron";
}

export interface ReminderBridge {
  loadSettings: () => Promise<ReminderSettingsRecord>;
  saveSettings: (input: ReminderSettingsInput) => Promise<ReminderSettingsRecord>;
  loadScheduleState: () => Promise<ReminderSchedulerState>;
}

export const defaultReminderLeadMinutes = [15, 120] as const;

export const normalizeReminderLeadMinutes = (leadMinutes: number[]): number[] => {
  const normalized = Array.from(
    new Set(
      leadMinutes
        .map((value) => Math.trunc(value))
        .filter((value) => value > 0 && value <= 24 * 60)
    )
  ).sort((left, right) => left - right);

  return normalized.length > 0 ? normalized : [...defaultReminderLeadMinutes];
};

export const createDefaultReminderSettingsRecord = (
  storagePath: string | null
): ReminderSettingsRecord => ({
  enabled: true,
  leadMinutes: [...defaultReminderLeadMinutes],
  gradeChangesEnabled: true,
  savedAt: null,
  storagePath
});

export const createDefaultReminderSchedulerState = (
  transport: ReminderSchedulerState["transport"]
): ReminderSchedulerState => ({
  enabled: true,
  supported: transport === "electron",
  scheduledCount: 0,
  nextFireAt: null,
  lastScheduledAt: null,
  transport
});
