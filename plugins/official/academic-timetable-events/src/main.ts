import type {
  AcademicCalendarConfigData,
  AcademicCalendarQuarter,
  AcademicTimetableData,
  AcademicTimetableSession,
  CalendarEventRecord,
  CalendarEventsData,
  CapabilityDataState,
  CapabilityPublication,
  CapabilityRecord,
  CampusPermission,
  PeriodTimeRecord,
  PluginCapability,
  PluginCapabilityBinding
} from "@campusos/shared";
import { manifest } from "./manifest";

interface FeatureRefreshResult {
  sourceId: typeof manifest.id;
  status: "live" | "cache" | "fallback" | "unavailable";
  updatedAt: string;
  message?: string;
}

interface RefreshRegistrationOptions {
  after?: readonly string[];
}

export interface AcademicTimetableEventsDependencies {
  loadTimetableRecords: (
    providerIds: readonly string[]
  ) => Promise<CapabilityRecord<AcademicTimetableData>[]>;
  loadCalendarConfig: () => Promise<CapabilityRecord<AcademicCalendarConfigData> | null>;
  publish: (
    publication: CapabilityPublication<CalendarEventsData>
  ) => Promise<void>;
  registerRefreshJob: (
    sourceId: string,
    job: () => Promise<FeatureRefreshResult>,
    options?: RefreshRegistrationOptions
  ) => () => void;
  now?: () => Date;
}

interface FeatureActivationContext {
  pluginId: string;
  grantedPermissions: readonly CampusPermission[];
  bindings: Readonly<Partial<Record<PluginCapability, PluginCapabilityBinding>>>;
}

const semesterNumberForSeason = (season: string): 1 | 2 | null => {
  const seasonName = season.split("|").at(-1);
  if (seasonName === "秋" || seasonName === "冬") return 1;
  if (seasonName === "春" || seasonName === "夏") return 2;
  return null;
};

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

interface SemesterWindow {
  academicYearStart: number;
  semesterNumber: 1 | 2;
  startDate: string;
  endDate: string;
}

const selectSemesterWindow = (
  quarters: readonly AcademicCalendarQuarter[],
  generatedAt: string
): SemesterWindow | null => {
  const bySemester = new Map<string, SemesterWindow>();
  for (const quarter of quarters) {
    const semesterNumber = semesterNumberForSeason(quarter.season);
    if (semesterNumber === null) continue;
    const key = `${quarter.academicYearStart}:${semesterNumber}`;
    const existing = bySemester.get(key);
    bySemester.set(key, {
      academicYearStart: quarter.academicYearStart,
      semesterNumber,
      startDate: existing && existing.startDate < quarter.startDate
        ? existing.startDate
        : quarter.startDate,
      endDate: existing && existing.endDate > quarter.endDate
        ? existing.endDate
        : quarter.endDate
    });
  }

  const windows = [...bySemester.values()].sort((left, right) =>
    left.startDate.localeCompare(right.startDate)
  );
  if (windows.length === 0) return null;
  const today = formatShanghaiDate(generatedAt);

  // Celechron lib/model/scholar.dart:97-110 and scholar_controller.dart:96-110
  // expose one Semester. CampusOS mechanically groups ZJU's two quarter
  // records into that Semester because the capability stores 秋/冬 and 春/夏 separately.
  return windows.find(
    (window) => window.startDate <= today && today <= window.endDate
  ) ?? windows.find((window) => window.startDate > today) ?? windows.at(-1) ?? null;
};

const resolvePeriodTime = (
  period: number,
  periodTimes: readonly PeriodTimeRecord[]
): PeriodTimeRecord | undefined =>
  periodTimes.find((record) => record.period === period);

const toDateOnly = (dateString: string): string => dateString.slice(0, 10);

const parseDateOnly = (value: string): Date | null => {
  const parts = value.split("-");
  const year = Number.parseInt(parts[0], 10);
  const month = Number.parseInt(parts[1], 10);
  const day = Number.parseInt(parts[2], 10);
  if (!year || !month || !day) return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.getTime()) ? null : date;
};

const addDays = (value: string, days: number): string | null => {
  const date = parseDateOnly(value);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return toDateOnly(date.toISOString());
};

const dayOfWeekToNumber = (raw: number): number => {
  const normalized = Math.round(raw);
  if (normalized < 1 || normalized > 7) return 1;
  return normalized;
};

interface HalfWindow {
  kind: "first" | "second";
  startDate: string;
  endDate: string;
}

const buildHalfWindows = (
  quarters: readonly AcademicCalendarQuarter[],
  selectedSemester: SemesterWindow
): HalfWindow[] => {
  const seasons = selectedSemester.semesterNumber === 1
    ? (["1|秋", "1|冬"] as const)
    : (["2|春", "2|夏"] as const);
  const first = quarters.find(
    (quarter) =>
      quarter.academicYearStart === selectedSemester.academicYearStart &&
      quarter.season === seasons[0]
  );
  const second = quarters.find(
    (quarter) =>
      quarter.academicYearStart === selectedSemester.academicYearStart &&
      quarter.season === seasons[1]
  );
  if (!first || !second) return [];

  const dayBeforeSecond = addDays(second.classesBeginDate, -1);
  const firstEnd = dayBeforeSecond && dayBeforeSecond < first.endDate
    ? dayBeforeSecond
    : first.endDate;
  return [
    {
      kind: "first",
      startDate: first.classesBeginDate,
      endDate: firstEnd
    },
    {
      kind: "second",
      startDate: second.classesBeginDate,
      endDate: second.endDate
    }
  ];
};

const datesForHalf = (
  window: HalfWindow,
  dayOfWeek: number,
  weekPattern: AcademicTimetableSession["weekPattern"]
): string[] => {
  const start = parseDateOnly(window.startDate);
  const end = parseDateOnly(window.endDate);
  if (!start || !end || start > end) return [];

  const target = dayOfWeekToNumber(dayOfWeek);
  const startDay = start.getUTCDay() === 0 ? 7 : start.getUTCDay();
  const first = new Date(start);
  first.setUTCDate(first.getUTCDate() + ((target - startDay + 7) % 7));

  const dates: string[] = [];
  for (let current = first, week = 1; current <= end; week += 1) {
    if (weekPatternAllows(weekPattern, week)) {
      dates.push(toDateOnly(current.toISOString()));
    }
    current = new Date(current);
    current.setUTCDate(current.getUTCDate() + 7);
  }
  return dates;
};

const dateForExactWeek = (
  windows: readonly HalfWindow[],
  week: number,
  dayOfWeek: number
): string | null => {
  if (!Number.isInteger(week) || week < 1) return null;
  const halfIndex = week <= 8 ? 0 : 1;
  const window = windows[halfIndex];
  if (!window) return null;
  const weekInHalf = week <= 8 ? week : week - 8;
  const start = parseDateOnly(window.startDate);
  if (!start) return null;
  const startDay = start.getUTCDay() === 0 ? 7 : start.getUTCDay();
  const date = new Date(start);
  date.setUTCDate(
    date.getUTCDate() +
      ((dayOfWeekToNumber(dayOfWeek) - startDay + 7) % 7) +
      (weekInHalf - 1) * 7
  );
  const result = toDateOnly(date.toISOString());
  return result <= window.endDate ? result : null;
};

const sessionDates = (
  session: AcademicTimetableSession,
  windows: readonly HalfWindow[]
): string[] => {
  if (session.weeks && session.weeks.length > 0) {
    return session.weeks.flatMap((week) => {
      const date = dateForExactWeek(windows, week, session.dayOfWeek);
      return date ? [date] : [];
    });
  }

  return windows.flatMap((window) => {
    if (window.kind === "first" && !session.firstHalf) return [];
    if (window.kind === "second" && !session.secondHalf) return [];
    return datesForHalf(window, session.dayOfWeek, session.weekPattern);
  });
};

const sameRepeatPattern = (
  left: AcademicTimetableSession,
  right: AcademicTimetableSession
): boolean =>
  left.dayOfWeek === right.dayOfWeek &&
  left.weekPattern === right.weekPattern &&
  left.location === right.location;

const mergeCourseSessions = (
  entries: readonly ExpandedSession[]
): ExpandedSession[] => {
  // Celechron lib/model/semester.dart:384-403 and course.dart:109-157.
  // CampusOS only adapts the mutable Dart model to immutable capability records.
  const courses = new Map<string, ExpandedSession[]>();
  for (const entry of entries) {
    const courseKey = [
      entry.providerId,
      entry.academicYearStart,
      entry.semesterNumber,
      entry.session.courseName
    ].join(":");
    const sessions = courses.get(courseKey) ?? [];
    const firstPeriod = entry.session.periods[0];
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

const sessionToEvent = (
  session: AcademicTimetableSession,
  providerId: string,
  date: string,
  periodTimes: readonly PeriodTimeRecord[]
): CalendarEventRecord | null => {
  const sortedPeriods = [...session.periods].sort((a, b) => a - b);
  if (sortedPeriods.length === 0) return null;

  const firstPeriod = resolvePeriodTime(sortedPeriods[0], periodTimes);
  const lastPeriod = resolvePeriodTime(
    sortedPeriods[sortedPeriods.length - 1],
    periodTimes
  );
  if (!firstPeriod || !lastPeriod) return null;

  return {
    id: `${manifest.id}:${providerId}:${session.sourceId}:${date}`,
    originId: session.sourceId,
    originCapability: "academic.timetable@1",
    sourceId: "academic-affairs",
    kind: "course",
    title: session.courseName,
    startAt: `${date}T${firstPeriod.start}:00+08:00`,
    endAt: `${date}T${lastPeriod.end}:00+08:00`,
    timezone: "Asia/Shanghai",
    location: session.location,
    courseName: session.courseName,
    note: session.teacher ? `教师：${session.teacher}` : null
  };
};

const weekPatternAllows = (
  pattern: AcademicTimetableSession["weekPattern"],
  week: number
): boolean => {
  if (pattern === "all") return true;
  if (pattern === "odd") return week % 2 === 1;
  if (pattern === "even") return week % 2 === 0;
  return true;
};

interface ExpandedSession {
  session: AcademicTimetableSession;
  providerId: string;
  academicYearStart: number;
  semesterNumber: 1 | 2;
}

export const deriveTimetableCalendarEvents = (
  timetableRecords: readonly CapabilityRecord<AcademicTimetableData>[],
  calendarConfig: AcademicCalendarConfigData | null,
  generatedAt: string
): CalendarEventsData => {
  if (!calendarConfig || calendarConfig.quarters.length === 0) {
    return {
      feedId: "timetable-events",
      sourceId: "academic-affairs",
      sourceLabel: "教务处网站",
      sourceUpdatedAt: generatedAt,
      upstreamCapability: "academic.timetable@1",
      upstreamProviderId: null,
      upstreamProviderIds: [],
      accountScoped: true,
      supportedKinds: ["course"],
      totalItems: 0,
      omittedItems: 0,
      events: []
    };
  }

  const periodTimes = calendarConfig.periodTimes;
  if (periodTimes.length === 0) return {
    feedId: "timetable-events",
    sourceId: "academic-affairs",
    sourceLabel: "教务处网站",
    sourceUpdatedAt: generatedAt,
    upstreamCapability: "academic.timetable@1",
    upstreamProviderId: null,
    upstreamProviderIds: [],
    accountScoped: true,
    supportedKinds: ["course"],
    totalItems: 0,
    omittedItems: 0,
    events: []
  };

  const selectedSemester = selectSemesterWindow(
    calendarConfig.quarters,
    generatedAt
  );

  // Flatten the selected semester's sessions with their provider context.
  const expanded: ExpandedSession[] = [];
  for (const record of timetableRecords) {
    const terms = record.data?.terms ?? [];
    for (const term of terms) {
      const semesterNumber = semesterNumberForSeason(term.season);
      if (
        selectedSemester === null ||
        term.academicYearStart !== selectedSemester.academicYearStart ||
        semesterNumber !== selectedSemester.semesterNumber
      ) {
        continue;
      }
      for (const session of term.sessions) {
        expanded.push({
          session,
          providerId: record.providerId,
          academicYearStart: term.academicYearStart,
          semesterNumber
        });
      }
    }
  }

  const halfWindows = selectedSemester
    ? buildHalfWindows(calendarConfig.quarters, selectedSemester)
    : [];
  const merged = mergeCourseSessions(expanded);
  const events: CalendarEventRecord[] = [];
  let totalAttempted = 0;
  for (const { session, providerId } of merged) {
    const dates = sessionDates(session, halfWindows);
    totalAttempted += dates.length;
    for (const date of dates) {
      const event = sessionToEvent(
        session,
        providerId,
        date,
        periodTimes
      );
      if (event) events.push(event);
    }
  }

  const providerIds = [
    ...new Set(timetableRecords.map((record) => record.providerId))
  ];
  const sourceUpdatedAt = timetableRecords
    .map((record) => record.updatedAt)
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort()
    .at(-1) ?? generatedAt;

  events.sort((left, right) =>
    left.startAt.localeCompare(right.startAt) || left.id.localeCompare(right.id)
  );

  return {
    feedId: "timetable-events",
    sourceId: "academic-affairs",
    sourceLabel: "教务处网站",
    sourceUpdatedAt,
    upstreamCapability: "academic.timetable@1",
    upstreamProviderId: providerIds.length === 1 ? providerIds[0] : null,
    upstreamProviderIds: providerIds,
    accountScoped: true,
    supportedKinds: ["course"],
    totalItems: totalAttempted,
    omittedItems: totalAttempted - events.length,
    events
  };
};

const aggregateState = (
  records: readonly CapabilityRecord<AcademicTimetableData>[]
): CapabilityDataState => {
  if (records.length === 0) return "unavailable";
  const states = records.map((record) => record.state);
  if (states.every((state) => state === "live")) return "live";
  if (states.every((state) => state === "unavailable")) return "unavailable";
  if (states.every((state) => state === "cache")) return "cache";
  return "fallback";
};

export const createAcademicTimetableEventsFeature = ({
  loadTimetableRecords,
  loadCalendarConfig,
  publish,
  registerRefreshJob,
  now = () => new Date()
}: AcademicTimetableEventsDependencies) => {
  let providerIds: readonly string[] = [];

  const refresh = async (): Promise<FeatureRefreshResult> => {
    const [timetableRecords, calendarConfigRecord] = await Promise.all([
      loadTimetableRecords(providerIds),
      loadCalendarConfig()
    ]);
    const updatedAt = now().toISOString();
    const state = aggregateState(timetableRecords);
    const message = timetableRecords.length === 0
      ? "尚未收到课表能力数据。"
      : timetableRecords.map((record) => record.message).find(Boolean);

    await publish({
      capability: "calendar.events@1",
      accountId:
        timetableRecords.find((record) => record.accountId !== null)?.accountId ?? null,
      state,
      updatedAt,
      data: deriveTimetableCalendarEvents(
        timetableRecords,
        calendarConfigRecord?.data ?? null,
        updatedAt
      ),
      message
    });

    return {
      sourceId: manifest.id,
      status: state,
      updatedAt,
      message
    };
  };

  return {
    manifest,
    activate: async (context: FeatureActivationContext) => {
      if (context.pluginId !== manifest.id) {
        throw new Error("课表事件插件收到错误的插件身份。");
      }
      const missingPermission = manifest.permissions.find(
        (permission) => !context.grantedPermissions.includes(permission)
      );
      if (missingPermission) {
        throw new Error(`课表事件插件缺少权限：${missingPermission}`);
      }
      const missingCapability = manifest.requires.find(
        (capability) => context.bindings[capability] === undefined
      );
      if (missingCapability) {
        throw new Error(`课表事件插件缺少能力绑定：${missingCapability}`);
      }

      const binding = context.bindings["academic.timetable@1"];
      providerIds =
        binding === undefined
          ? []
          : typeof binding === "string"
            ? [binding]
            : [...binding];

      const unregister = registerRefreshJob(
        manifest.id,
        refresh,
        { after: providerIds.filter((id) => id !== "core") }
      );
      try {
        await refresh();
      } catch (error) {
        unregister();
        throw error;
      }
      return { deactivate: unregister };
    }
  };
};
