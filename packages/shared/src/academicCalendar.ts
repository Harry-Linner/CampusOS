/** 调休校历设置：法定节假日 + 补课（调休）标记。独立于桌面日历存储。 */
export interface AcademicCalendarHoliday {
  date: string;
  label: string;
}

export interface AcademicCalendarMakeupDay {
  date: string;
  weekday: number;
  source: "builtin" | "manual";
}

export interface AcademicCalendarSettings {
  statutoryHolidays: AcademicCalendarHoliday[];
  makeupDays: AcademicCalendarMakeupDay[];
  savedAt: string;
  storagePath: string;
}

export interface AcademicCalendarSettingsInput {
  statutoryHolidays?: AcademicCalendarHoliday[];
  makeupDays?: AcademicCalendarMakeupDay[];
  savedAt?: string;
}

export interface AcademicCalendarBridge {
  loadSettings: () => Promise<AcademicCalendarSettings>;
  saveSettings: (input: AcademicCalendarSettingsInput) => Promise<AcademicCalendarSettings>;
}

const isDateKey = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

export const normalizeAcademicCalendarSettings = (
  input: Partial<AcademicCalendarSettingsInput>,
  storagePath: string
): AcademicCalendarSettings => {
  const statutoryHolidays = Array.isArray(input.statutoryHolidays)
    ? input.statutoryHolidays
      .filter((h) => typeof h === "object" && h !== null && isDateKey(h.date) && typeof h.label === "string")
      .map((h) => ({ date: h.date, label: h.label.slice(0, 80) }))
    : [];
  const makeupDays = Array.isArray(input.makeupDays)
    ? input.makeupDays
      .filter((m) => typeof m === "object" && m !== null && isDateKey(m.date) && typeof m.weekday === "number" && m.weekday >= 1 && m.weekday <= 7)
      .map((m) => ({ date: m.date, weekday: m.weekday, source: m.source === "manual" ? ("manual" as const) : ("builtin" as const) }))
    : [];
  return {
    statutoryHolidays,
    makeupDays,
    savedAt: input.savedAt ?? new Date(0).toISOString(),
    storagePath
  };
};
