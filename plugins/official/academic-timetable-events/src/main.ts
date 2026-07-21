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

const findQuarterForSeason = (
  quarters: readonly AcademicCalendarQuarter[],
  academicYearStart: number,
  season: string
): AcademicCalendarQuarter | undefined =>
  quarters.find(
    (quarter) =>
      quarter.academicYearStart === academicYearStart &&
      quarter.season === season
  );

const resolvePeriodTime = (
  period: number,
  periodTimes: readonly PeriodTimeRecord[]
): PeriodTimeRecord | undefined =>
  periodTimes.find((record) => record.period === period);

const toDateOnly = (dateString: string): string => dateString.slice(0, 10);

/**
 * Compute the calendar date for a given week and day-of-week relative to a
 * quarter's classes-begin Monday.
 *
 * week-1 Monday = classesBeginDate
 * target date = classesBeginDate + (week - 1) * 7 + (dayOfWeek - 1) days
 *
 * Uses local date arithmetic to avoid UTC offset issues with Asia/Shanghai.
 */
const computeSessionDate = (
  classesBeginDate: string,
  week: number,
  dayOfWeek: number
): string | null => {
  const parts = classesBeginDate.split("-");
  const year = Number.parseInt(parts[0], 10);
  const month = Number.parseInt(parts[1], 10);
  const day = Number.parseInt(parts[2], 10);
  if (!year || !month || !day) return null;

  const base = new Date(year, month - 1, day);
  if (Number.isNaN(base.getTime())) return null;
  base.setDate(base.getDate() + (week - 1) * 7 + (dayOfWeek - 1));

  return toDateOnly(
    `${String(base.getFullYear()).padStart(4, "0")}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`
  );
};

const sessionToEvent = (
  session: AcademicTimetableSession,
  providerId: string,
  classesBeginDate: string,
  week: number,
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

  const date = computeSessionDate(classesBeginDate, week, dayOfWeekToNumber(session.dayOfWeek));
  if (!date) return null;

  return {
    id: `${manifest.id}:${providerId}:${session.sourceId}:w${week}`,
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

/**
 * Normalize dayOfWeek: the timetable API may return 1=Monday or use a
 * different convention. This function expects 1=Monday through 7=Sunday.
 */
const dayOfWeekToNumber = (raw: number): number => {
  const normalized = Math.round(raw);
  if (normalized < 1 || normalized > 7) return 1;
  return normalized;
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
  season: string;
  academicYearStart: number;
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

  // Flatten all sessions with their provider context
  const expanded: ExpandedSession[] = [];
  for (const record of timetableRecords) {
    const terms = record.data?.terms ?? [];
    for (const term of terms) {
      const seasonParts = term.season.split("|");
      const season = seasonParts[1] ?? term.season;
      for (const session of term.sessions) {
        expanded.push({
          session,
          providerId: record.providerId,
          season,
          academicYearStart: term.academicYearStart
        });
      }
    }
  }

  const events: CalendarEventRecord[] = [];
  for (const { session, providerId, season, academicYearStart } of expanded) {
    const seasonKey =
      season === "秋" ? "1|秋" :
      season === "冬" ? "1|冬" :
      season === "春" ? "2|春" :
      season === "夏" ? "2|夏" :
      season;

    const quarter = findQuarterForSeason(
      calendarConfig.quarters,
      academicYearStart,
      seasonKey
    );
    if (!quarter) continue;

    // Determine which weeks to expand
    const weeks: number[] = session.weeks && session.weeks.length > 0
      ? session.weeks
      : Array.from(
          { length: 16 },
          (_, index) => index + 1
        ).filter((week) => weekPatternAllows(session.weekPattern, week));

    for (const week of weeks) {
      const event = sessionToEvent(
        session,
        providerId,
        quarter.classesBeginDate,
        week,
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

  // totalItems: count all session×week combinations that were attempted
  let totalAttempted = 0;
  for (const { session } of expanded) {
    const weeks = session.weeks && session.weeks.length > 0
      ? session.weeks.length
      : [...Array(16).keys()].filter(
          (w) => weekPatternAllows(session.weekPattern, w + 1)
        ).length;
    totalAttempted += weeks;
  }

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
