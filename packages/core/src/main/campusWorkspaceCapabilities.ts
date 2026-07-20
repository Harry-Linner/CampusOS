import type {
  AcademicCalendarConfigData,
  AcademicCalendarQuarter,
  CalendarEventKind,
  CalendarEventRecord,
  CalendarEventsData,
  CapabilityRecord,
  CampusCourseSession,
  CampusDeadline,
  CampusSourceId,
  CampusWorkspaceSnapshot
} from "@campusos/shared";
import { buildReminderQueue } from "../shared/campusWorkspace";

const HOUR_IN_MS = 60 * 60 * 1000;
const DAY_IN_MS = 24 * HOUR_IN_MS;

export const findAcademicCalendarRecord = (
  records: CapabilityRecord<AcademicCalendarConfigData>[],
  providerId: string
): CapabilityRecord<AcademicCalendarConfigData> | null =>
  records.find(
    (record) => record.providerId === providerId && record.accountId === null
  ) ?? null;

export const findCalendarEventRecords = (
  records: CapabilityRecord<CalendarEventsData>[],
  providerIds: readonly string[],
  accountId: string | null
): CapabilityRecord<CalendarEventsData>[] =>
  providerIds.flatMap((providerId) => {
    const record =
      records.find(
        (candidate) =>
          accountId !== null &&
          candidate.providerId === providerId &&
          candidate.accountId === accountId
      ) ??
      records.find(
        (candidate) =>
          candidate.providerId === providerId && candidate.accountId === null
      );
    return record ? [record] : [];
  });

const formatShanghaiDate = (isoDateTime: string): string => {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    })
      .formatToParts(new Date(isoDateTime))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  return `${values.year}-${values.month}-${values.day}`;
};

const dateOnlyTimestamp = (value: string): number =>
  Date.parse(`${value}T00:00:00Z`);

const formatQuarterLabel = (quarter: AcademicCalendarQuarter): string =>
  `${quarter.academicYearStart}-${quarter.academicYearStart + 1} ${quarter.season.slice(2)}学期`;

export const mergeAcademicCalendarIntoWorkspace = (
  snapshot: CampusWorkspaceSnapshot,
  record: CapabilityRecord<AcademicCalendarConfigData> | null
): CampusWorkspaceSnapshot => {
  if (!record) return snapshot;
  if (!record.data || record.data.quarters.length === 0) {
    return {
      ...snapshot,
      term: {
        label: "校历不可用",
        phase: "unavailable",
        currentWeek: null,
        progressPercent: 0
      }
    };
  }

  const today = formatShanghaiDate(snapshot.generatedAt);
  const todayTimestamp = dateOnlyTimestamp(today);
  const quarters = [...record.data.quarters].sort(
    (left, right) =>
      dateOnlyTimestamp(left.classesBeginDate) -
      dateOnlyTimestamp(right.classesBeginDate)
  );
  const active = quarters.find(
    (quarter) =>
      quarter.classesBeginDate <= today && today <= quarter.endDate
  );
  if (active) {
    const start = dateOnlyTimestamp(active.classesBeginDate);
    const end = dateOnlyTimestamp(active.endDate);
    const elapsedDays = Math.floor((todayTimestamp - start) / DAY_IN_MS);
    const totalDays = Math.max(1, Math.floor((end - start) / DAY_IN_MS) + 1);
    return {
      ...snapshot,
      term: {
        label: formatQuarterLabel(active),
        phase: "active",
        currentWeek: Math.floor(elapsedDays / 7) + 1,
        progressPercent: Math.min(
          100,
          Math.max(0, Math.round(((elapsedDays + 1) / totalDays) * 100))
        )
      }
    };
  }

  const upcoming = quarters.find(
    (quarter) => quarter.classesBeginDate > today
  );
  if (upcoming) {
    return {
      ...snapshot,
      term: {
        label: formatQuarterLabel(upcoming),
        phase: "upcoming",
        currentWeek: null,
        progressPercent: 0
      }
    };
  }

  return {
    ...snapshot,
    term: {
      label: "校历待更新",
      phase: "unavailable",
      currentWeek: null,
      progressPercent: 0
    }
  };
};

const isAbsoluteDateTime = (value: string): boolean =>
  /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) &&
  Number.isFinite(Date.parse(value));

const deadlineKindForEvent = (
  kind: CalendarEventKind
): CampusDeadline["kind"] | null => {
  if (kind === "exam") return "exam";
  if (kind === "assignment") return "assignment";
  if (kind === "task") return "workflow";
  return null;
};

const isDeadlineRepresented = (
  deadline: CampusDeadline,
  supportedKinds: ReadonlySet<CalendarEventKind>
): boolean =>
  (deadline.kind === "exam" && supportedKinds.has("exam")) ||
  (deadline.kind === "assignment" && supportedKinds.has("assignment")) ||
  (deadline.kind === "workflow" && supportedKinds.has("task"));

const toCourse = (event: CalendarEventRecord): CampusCourseSession | null => {
  if (
    event.kind !== "course" ||
    !isAbsoluteDateTime(event.startAt) ||
    !event.endAt ||
    !isAbsoluteDateTime(event.endAt) ||
    Date.parse(event.endAt) <= Date.parse(event.startAt)
  ) {
    return null;
  }
  return {
    id: event.id,
    title: event.title,
    location: event.location ?? "地点未提供",
    startAt: event.startAt,
    endAt: event.endAt,
    sourceId: event.sourceId,
    note: event.note ?? undefined
  };
};

const toDeadline = (
  event: CalendarEventRecord,
  now: number
): CampusDeadline | null => {
  const kind = deadlineKindForEvent(event.kind);
  if (!kind || !isAbsoluteDateTime(event.startAt)) return null;
  const remaining = Date.parse(event.startAt) - now;
  return {
    id: event.id,
    title: event.title,
    dueAt: event.startAt,
    sourceId: event.sourceId,
    kind,
    priority:
      kind === "assignment" && remaining >= 0 && remaining <= 36 * HOUR_IN_MS
        ? "urgent"
        : kind === "workflow"
          ? "routine"
          : "important",
    courseName: event.courseName ?? undefined,
    note: event.note ?? undefined
  };
};

const latestTimestamp = (
  records: CapabilityRecord<CalendarEventsData>[]
): string =>
  [...records]
    .sort(
      (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    )[0].updatedAt;

const buildFeedSummary = (
  records: CapabilityRecord<CalendarEventsData>[],
  eventCount: number,
  omittedCount: number
): string => {
  const unavailableMessages = records
    .filter((record) => record.state === "unavailable" && record.message)
    .map((record) => record.message as string);
  const mode = records.every((record) => record.state === "live")
    ? "实时"
    : "缓存或降级";
  const omitted = omittedCount > 0
    ? `；另有 ${omittedCount} 项没有可信绝对时间，未写入日历`
    : "";
  const unavailable = unavailableMessages.length > 0
    ? `；${[...new Set(unavailableMessages)].join("；")}`
    : "";
  return `${mode}事件已接入，${eventCount} 项进入日历${omitted}${unavailable}。`;
};

const sortCourses = (courses: CampusCourseSession[]): CampusCourseSession[] =>
  [...courses].sort(
    (left, right) => Date.parse(left.startAt) - Date.parse(right.startAt)
  );

const sortDeadlines = (deadlines: CampusDeadline[]): CampusDeadline[] =>
  [...deadlines].sort(
    (left, right) => Date.parse(left.dueAt) - Date.parse(right.dueAt)
  );

export const mergeCalendarEventsIntoWorkspace = (
  snapshot: CampusWorkspaceSnapshot,
  records: CapabilityRecord<CalendarEventsData>[],
  reminderLeadMinutes: number[]
): CampusWorkspaceSnapshot => {
  const usableRecords = records.filter(
    (record): record is CapabilityRecord<CalendarEventsData> & {
      data: CalendarEventsData;
    } => record.data !== null
  );
  if (usableRecords.length === 0) return snapshot;

  const recordsBySource = new Map<
    CampusSourceId,
    (CapabilityRecord<CalendarEventsData> & { data: CalendarEventsData })[]
  >();
  for (const record of usableRecords) {
    const group = recordsBySource.get(record.data.sourceId) ?? [];
    group.push(record);
    recordsBySource.set(record.data.sourceId, group);
  }

  let courses = [...snapshot.courses];
  let deadlines = [...snapshot.deadlines];
  const sourceStates = [...snapshot.sourceStates];
  const now = Date.parse(snapshot.generatedAt);

  for (const [sourceId, sourceRecords] of recordsBySource) {
    const supportedKinds = new Set(
      sourceRecords.flatMap((record) => record.data.supportedKinds)
    );
    const removedCourseCount = courses.filter(
      (course) =>
        course.sourceId === sourceId && supportedKinds.has("course")
    ).length;
    const removedDeadlineCount = deadlines.filter(
      (deadline) =>
        deadline.sourceId === sourceId &&
        isDeadlineRepresented(deadline, supportedKinds)
    ).length;
    courses = courses.filter(
      (course) =>
        course.sourceId !== sourceId || !supportedKinds.has("course")
    );
    deadlines = deadlines.filter(
      (deadline) =>
        deadline.sourceId !== sourceId ||
        !isDeadlineRepresented(deadline, supportedKinds)
    );

    const events = [
      ...new Map(
        sourceRecords
          .flatMap((record) => record.data.events)
          .filter(
            (event) =>
              event.sourceId === sourceId && supportedKinds.has(event.kind)
          )
          .map((event) => [event.id, event])
      ).values()
    ];
    const newCourses = events
      .map(toCourse)
      .filter((course): course is CampusCourseSession => course !== null);
    const newDeadlines = events
      .map((event) => toDeadline(event, now))
      .filter((deadline): deadline is CampusDeadline => deadline !== null);
    const acceptedEventCount = newCourses.length + newDeadlines.length;
    const invalidEventCount = events.length - acceptedEventCount;
    courses.push(...newCourses);
    deadlines.push(...newDeadlines);

    const totalItems = sourceRecords.reduce(
      (total, record) => total + record.data.totalItems,
      0
    );
    const omittedItems =
      sourceRecords.reduce(
        (total, record) => total + record.data.omittedItems,
        0
      ) + invalidEventCount;
    const existingState = sourceStates.find(
      (source) => source.sourceId === sourceId
    );
    const accountScoped = sourceRecords.some(
      (record) => record.data.accountScoped
    );
    const accountId = sourceRecords.find(
      (record) => record.accountId !== null
    )?.accountId ?? null;
    const sourceState = {
      sourceId,
      label: sourceRecords[0].data.sourceLabel,
      status: sourceRecords.every((record) => record.state === "live")
        ? ("ready" as const)
        : ("partial" as const),
      connectionState: accountScoped
        ? accountId === null
          ? ("needs-credentials" as const)
          : ("connected" as const)
        : ("not-required" as const),
      lastSyncedAt: latestTimestamp(sourceRecords),
      itemCount: Math.max(
        0,
        (existingState?.itemCount ?? 0) -
          removedCourseCount -
          removedDeadlineCount +
          totalItems
      ),
      summary: buildFeedSummary(
        sourceRecords,
        acceptedEventCount,
        omittedItems
      ),
      actionLabel: sourceRecords.some(
        (record) => record.state === "unavailable"
      )
        ? accountScoped && accountId === null
          ? "先在设置页连接统一身份认证"
          : "检查数据源或稍后重试"
        : sourceRecords.every((record) => record.state === "live")
          ? "日历事件已实时刷新"
          : "当前使用上次成功的事件数据",
      configuredUsername: accountId ?? existingState?.configuredUsername ?? null
    };
    const existingIndex = sourceStates.findIndex(
      (source) => source.sourceId === sourceId
    );
    if (existingIndex >= 0) {
      sourceStates[existingIndex] = sourceState;
    } else {
      sourceStates.push(sourceState);
    }
  }

  courses = sortCourses(courses);
  deadlines = sortDeadlines(deadlines);
  const reminders = buildReminderQueue(
    courses,
    deadlines,
    reminderLeadMinutes,
    snapshot.generatedAt
  );
  const today = formatShanghaiDate(snapshot.generatedAt);
  const todayCourses = courses.filter(
    (course) => formatShanghaiDate(course.startAt) === today
  );

  return {
    ...snapshot,
    sourceStates,
    courses,
    todayCourses,
    deadlines,
    reminders,
    summary: {
      ...snapshot.summary,
      readySources: sourceStates.filter((source) => source.status === "ready")
        .length,
      totalSources: sourceStates.length,
      remindersQueued: reminders.length,
      deadlinesDueSoon: deadlines.filter((deadline) => {
        const remaining = Date.parse(deadline.dueAt) - now;
        return remaining >= 0 && remaining <= 36 * HOUR_IN_MS;
      }).length
    }
  };
};
