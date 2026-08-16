import type {
  AcademicCalendarQuarter,
  AcademicTimetableSeason,
  AcademicTimetableSession
} from "./pluginCapabilities";

export type AcademicSemesterNumber = 1 | 2;

export interface AcademicSemesterWindow {
  academicYearStart: number;
  semesterNumber: AcademicSemesterNumber;
  startDate: string;
  endDate: string;
}

export interface AcademicTimetableSessionContext {
  session: AcademicTimetableSession;
  providerId: string;
  academicYearStart: number;
  semesterNumber: AcademicSemesterNumber;
}

export const academicSemesterNumberForSeason = (
  season: AcademicTimetableSeason | string
): AcademicSemesterNumber | null => {
  const seasonName = season.split("|").at(-1);
  if (seasonName === "秋" || seasonName === "冬") return 1;
  if (seasonName === "春" || seasonName === "夏") return 2;
  return null;
};

export const academicSemesterKey = (
  academicYearStart: number,
  semesterNumber: AcademicSemesterNumber
): string => `${academicYearStart}:${semesterNumber}`;

export const formatAcademicSemesterLabel = (
  academicYearStart: number,
  semesterNumber: AcademicSemesterNumber
): string => `${academicYearStart}-${academicYearStart + 1} ${
  semesterNumber === 1 ? "秋冬学期" : "春夏学期（含短学期）"
}`;

const formatShanghaiDate = (dateTime: string): string => {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    })
      .formatToParts(new Date(dateTime))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  return `${values.year}-${values.month}-${values.day}`;
};

export const buildAcademicSemesterWindows = (
  quarters: readonly AcademicCalendarQuarter[]
): AcademicSemesterWindow[] => {
  const bySemester = new Map<string, AcademicSemesterWindow>();
  for (const quarter of quarters) {
    const semesterNumber = academicSemesterNumberForSeason(quarter.season);
    if (semesterNumber === null) continue;
    const key = academicSemesterKey(quarter.academicYearStart, semesterNumber);
    const existing = bySemester.get(key);
    bySemester.set(key, {
      academicYearStart: quarter.academicYearStart,
      semesterNumber,
      startDate:
        existing && existing.startDate < quarter.startDate
          ? existing.startDate
          : quarter.startDate,
      endDate:
        existing && existing.endDate > quarter.endDate
          ? existing.endDate
          : quarter.endDate
    });
  }

  return [...bySemester.values()].sort((left, right) =>
    left.startDate.localeCompare(right.startDate)
  );
};

export const selectAcademicSemesterWindow = (
  quarters: readonly AcademicCalendarQuarter[],
  generatedAt: string
): AcademicSemesterWindow | null => {
  const windows = buildAcademicSemesterWindows(quarters);
  if (windows.length === 0) return null;
  const today = formatShanghaiDate(generatedAt);

  // Celechron lib/model/scholar.dart:97-110 exposes one current Semester.
  // CampusOS mechanically groups ZJU's two quarter records into that Semester.
  const active = windows.find(
    (window) => window.startDate <= today && today <= window.endDate
  );
  if (active) return active;

  // Celechron lib/model/scholar.dart:97-110 keeps its second loaded semester
  // current only while the latest period ended within the previous 14 days.
  // CampusOS mechanically applies that boundary to the spring-summer window so
  // 小学期 remains visible briefly after classes end, without hiding the next
  // complete autumn-winter semester for the rest of the summer break.
  const recentSpringSummer = windows
    .filter((window) => window.semesterNumber === 2 && window.endDate < today)
    .sort((left, right) => right.endDate.localeCompare(left.endDate))[0];
  if (recentSpringSummer) {
    const daysSinceEnd = Math.round(
      (Date.parse(today) - Date.parse(recentSpringSummer.endDate)) /
        (24 * 60 * 60 * 1000)
    );
    if (daysSinceEnd <= SUMMER_TERM_FALLBACK_DAYS) {
      return recentSpringSummer;
    }
  }

  return (
    windows.find((window) => window.startDate > today) ??
    windows.at(-1) ??
    null
  );
};

/** Celechron 对照：最近一学期结束后 14 天内仍视为当前学期。 */
export const SUMMER_TERM_FALLBACK_DAYS = 14;

const sameRepeatPattern = (
  left: AcademicTimetableSession,
  right: AcademicTimetableSession
): boolean =>
  left.dayOfWeek === right.dayOfWeek &&
  left.weekPattern === right.weekPattern &&
  left.location === right.location;

export const mergeAcademicTimetableSessions = (
  entries: readonly AcademicTimetableSessionContext[]
): AcademicTimetableSessionContext[] => {
  // Celechron lib/model/semester.dart:384-403 and course.dart:109-157.
  // The context fields only preserve provider and semester provenance.
  const courses = new Map<string, AcademicTimetableSessionContext[]>();
  for (const entry of entries) {
    const courseIdentity = entry.session.courseId?.trim()
      ? `id:${entry.session.courseId.trim()}`
      : `name:${entry.session.courseName}`;
    const courseKey = [
      entry.providerId,
      entry.academicYearStart,
      entry.semesterNumber,
      courseIdentity
    ].join(":");
    const sessions = courses.get(courseKey) ?? [];
    const firstPeriod = entry.session.periods[0];
    if (firstPeriod === undefined) continue;

    const duplicate = sessions.find(
      (current) =>
        sameRepeatPattern(current.session, entry.session) &&
        current.session.periods.includes(firstPeriod)
    );
    if (duplicate) {
      duplicate.session.firstHalf ||= entry.session.firstHalf;
      duplicate.session.secondHalf ||= entry.session.secondHalf;
      continue;
    }

    const adjacent = sessions.find(
      (current) =>
        sameRepeatPattern(current.session, entry.session) &&
        current.session.periods.at(-1)! + 1 === firstPeriod
    );
    if (adjacent) {
      adjacent.session.periods.push(...entry.session.periods);
      continue;
    }

    sessions.push({
      ...entry,
      session: {
        ...entry.session,
        periods: [...entry.session.periods],
        ...(entry.session.weeks ? { weeks: [...entry.session.weeks] } : {})
      }
    });
    courses.set(courseKey, sessions);
  }
  return [...courses.values()].flat();
};
