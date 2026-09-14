import type { AcademicCalendarConfigData, UnifiedCalendarData } from "@campusos/shared";
import { getOfficialCapabilityRepository } from "./officialCapabilityRepository";
import { loadAcademicCalendarSettings } from "./academicCalendarStore";

const DAY_MS = 24 * 60 * 60 * 1000;
const dateAtUtc = (date: string): number => Date.parse(`${date}T00:00:00Z`);
const dateKey = (timestamp: number): string => new Date(timestamp).toISOString().slice(0, 10);

const naturalWeekNumber = (date: string): number => {
  const value = new Date(dateAtUtc(date));
  const weekday = (value.getUTCDay() + 6) % 7;
  value.setUTCDate(value.getUTCDate() - weekday + 3);
  const firstThursday = new Date(Date.UTC(value.getUTCFullYear(), 0, 4));
  const firstWeekday = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstWeekday + 3);
  return 1 + Math.round((value.getTime() - firstThursday.getTime()) / (7 * DAY_MS));
};

/**
 * Calendar precedence is applied in one main-process service:
 * user holiday/makeup overrides > official university week calendar > bundled
 * lunar/festival display in the renderer > Monday-based ISO natural-week fallback.
 */
export const loadUnifiedCalendarData = async (
  today: string,
  range?: { startAt?: string; endAt?: string }
): Promise<UnifiedCalendarData> => {
  const [manual, records] = await Promise.all([
    loadAcademicCalendarSettings(),
    getOfficialCapabilityRepository().read<AcademicCalendarConfigData>("academic.calendar-config@1")
  ]);
  const official = records.find((record) => record.data?.quarters?.length)?.data ?? null;
  const weeks: Record<string, number> = {};
  for (const quarter of official?.quarters ?? []) {
    const begin = dateAtUtc(quarter.classesBeginDate);
    const end = dateAtUtc(quarter.endDate);
    if (!Number.isFinite(begin) || !Number.isFinite(end) || begin > end) continue;
    for (let cursor = begin; cursor <= end; cursor += DAY_MS) {
      weeks[dateKey(cursor)] = Math.floor((cursor - begin) / (7 * DAY_MS)) + 1;
    }
  }
  const requestedStart = Date.parse(range?.startAt ?? `${today}T00:00:00Z`);
  const requestedEnd = range?.endAt
    ? Date.parse(range.endAt)
    : requestedStart + DAY_MS;
  if (Number.isFinite(requestedStart) && Number.isFinite(requestedEnd) && requestedStart < requestedEnd) {
    const boundedEnd = Math.min(requestedEnd, requestedStart + 800 * DAY_MS);
    for (let cursor = requestedStart; cursor < boundedEnd; cursor += DAY_MS) {
      const key = dateKey(cursor);
      if (weeks[key] === undefined) weeks[key] = naturalWeekNumber(key);
    }
  }
  const manualByDate = new Map<string, { date: string; label: string; holiday: boolean }>();
  for (const holiday of manual.statutoryHolidays) {
    manualByDate.set(holiday.date, { date: holiday.date, label: holiday.label, holiday: true });
  }
  for (const makeup of manual.makeupDays) {
    manualByDate.set(makeup.date, { date: makeup.date, label: "补班", holiday: false });
  }
  return {
    holidays: [...manualByDate.values()].sort((left, right) => left.date.localeCompare(right.date)),
    weeks,
    currentWeek: weeks[today] ?? null
  };
};
