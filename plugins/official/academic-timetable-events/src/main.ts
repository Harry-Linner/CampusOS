import type {
  AcademicCalendarConfigData,
  AcademicCalendarQuarter,
  AcademicCalendarTermRules,
  AcademicSemesterWindow,
  AcademicTimetableData,
  AcademicTimetableSession,
  AcademicTimetableSessionContext,
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
import {
  academicSemesterKey,
  academicSemesterNumberForSeason,
  buildAcademicSemesterWindows,
  mergeAcademicTimetableSessions
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
  selectedSemester: AcademicSemesterWindow
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

/**
 * 展开校历里的「不排课」区间为逐日集合。
 */
const expandClosedDates = (rules: AcademicCalendarTermRules): Set<string> => {
  const closed = new Set<string>();
  for (const range of rules.closedRanges) {
    let cursor: string | null = range.startDate;
    while (cursor !== null && cursor <= range.endDate) {
      closed.add(cursor);
      cursor = addDays(cursor, 1);
    }
  }
  return closed;
};

/**
 * 把官方校历规则应用到某次课排出的日期上：
 *
 * - 放假日（法定节假日、校运动会、学生节、考试与停课考试）不排课；
 * - 调课日（「A 与 B 对调」「C 补 D 的课」）把该日的课改到目标日，目标日不再按原星期排课；
 * - 单双周沿用被调日的周次（调课在展开前已经按被调日筛选过）。
 */
const applyCalendarRules = (
  dates: readonly string[],
  rules: AcademicCalendarTermRules | undefined
): string[] => {
  if (!rules || (rules.closedRanges.length === 0 && rules.movedDays.length === 0)) {
    return [...dates];
  }
  const closed = expandClosedDates(rules);
  const movedFrom = new Map(rules.movedDays.map((day) => [day.fromDate, day.toDate]));
  const movedTo = new Set(rules.movedDays.map((day) => day.toDate));
  const result = new Set<string>();
  for (const date of dates) {
    const target = movedFrom.get(date);
    if (target !== undefined) {
      result.add(target);
      continue;
    }
    if (closed.has(date) || movedTo.has(date)) continue;
    result.add(date);
  }
  return [...result].sort();
};

const dateForExactWeek = (
  windows: readonly HalfWindow[],
  week: number,
  dayOfWeek: number
): string | null => {
  if (!Number.isInteger(week) || week < 1) return null;
  const target = dayOfWeekToNumber(dayOfWeek);
  if (week > 16) {
    // Custom repeats continue after the normal 16-week calendar, using the
    // eighth Sunday's anchor.
    const secondStart = parseDateOnly(windows[1]?.startDate ?? "");
    if (!secondStart) return null;
    const firstSundayOffset = (7 - (secondStart.getUTCDay() || 7) + 7) % 7;
    const anchor = new Date(secondStart);
    anchor.setUTCDate(anchor.getUTCDate() + firstSundayOffset + 49);
    anchor.setUTCDate(anchor.getUTCDate() + (week - 17) * 7 + target);
    return toDateOnly(anchor.toISOString());
  }

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
      ((target - startDay + 7) % 7) +
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
    if (session.weeks.length < 3) return [];
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
    // Celechron semester.dart:231 keeps teacher in description. CampusOS's user-
    // requested presentation separates teacher metadata from the editable note.
    instructor: session.teacher || null,
    note: null
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

  // Flatten every term's sessions with their provider context. The projection
  // deliberately covers more than the current term: the user-facing requirement
  // is that courses from every term — including past and future semesters —
  // stay visible in the calendar.
  const expanded: AcademicTimetableSessionContext[] = [];
  for (const record of timetableRecords) {
    const terms = record.data?.terms ?? [];
    for (const term of terms) {
      const semesterNumber = academicSemesterNumberForSeason(term.season);
      if (semesterNumber === null) continue;
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

  const windowByTerm = new Map<string, AcademicSemesterWindow>();
  for (const semesterWindow of buildAcademicSemesterWindows(calendarConfig.quarters)) {
    windowByTerm.set(
      academicSemesterKey(
        semesterWindow.academicYearStart,
        semesterWindow.semesterNumber
      ),
      semesterWindow
    );
  }

  const merged = mergeAcademicTimetableSessions(expanded);
  const termRulesByYear = new Map(
    (calendarConfig.termRules ?? []).map((rules) => [rules.academicYearStart, rules])
  );
  const events: CalendarEventRecord[] = [];
  const missingPeriods = new Set<number>();
  let totalAttempted = 0;
  for (const { session, providerId, academicYearStart, semesterNumber } of merged) {
    if (!session.confirmed) continue;
    const termWindow = windowByTerm.get(
      academicSemesterKey(academicYearStart, semesterNumber)
    );
    // Terms without a matching official-calendar window cannot be anchored to
    // absolute dates; they remain listed in the schedule's "全部课程" view.
    if (!termWindow) continue;
    const halfWindows = buildHalfWindows(calendarConfig.quarters, termWindow);
    if (halfWindows.length === 0) continue;
    const dates = applyCalendarRules(
      sessionDates(session, halfWindows),
      termRulesByYear.get(academicYearStart)
    );
    totalAttempted += dates.length;
    if (dates.length > 0) {
      for (const period of session.periods) {
        if (!resolvePeriodTime(period, periodTimes)) missingPeriods.add(period);
      }
    }
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
    diagnostics: [...missingPeriods].sort((a, b) => a - b).map((period) => `第 ${period} 节缺少已核实的上课时间，相关课程仍可在课表中查看。`),
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
    const data = deriveTimetableCalendarEvents(timetableRecords, calendarConfigRecord?.data ?? null, updatedAt);
    const upstreamState = aggregateState(timetableRecords);
    const state = upstreamState === "live" && (data.omittedItems > 0 || (data.diagnostics?.length ?? 0) > 0) ? "fallback" : upstreamState;
    const upstreamMessage = timetableRecords.length === 0
      ? "尚未收到课表能力数据。"
      : timetableRecords.map((record) => record.message).find(Boolean);
    const message = [upstreamMessage, ...(data.diagnostics ?? [])].filter(Boolean).join("；") || undefined;

    await publish({
      capability: "calendar.events@1",
      accountId:
        timetableRecords.find((record) => record.accountId !== null)?.accountId ?? null,
      state,
      updatedAt,
      data,
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
