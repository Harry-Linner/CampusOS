import type {
  AcademicCalendarConfigData,
  AcademicCalendarQuarter,
  AcademicTimetableData,
  AcademicGradesData,
  AcademicPracticeData,
  AcademicExamsData,
  LearningAssignmentsData,
  CalendarEventKind,
  CalendarEventRecord,
  CalendarEventsData,
  CapabilityRecord,
  CampusCourseSession,
  CampusDeadline,
  CampusSourceId,
  CampusSourceSyncState,
  CampusWorkspaceSnapshot,
  LearningMaterialsData
} from "@campusos/shared";
import { firstWaveSourceCatalog } from "@campusos/shared";
import { SUMMER_TERM_FALLBACK_DAYS } from "@campusos/shared";
import { buildReminderQueue } from "../shared/campusWorkspace";

const HOUR_IN_MS = 60 * 60 * 1000;
const DAY_IN_MS = 24 * HOUR_IN_MS;

/** Keep old source IDs readable in persisted items while removing unimplemented connector rows. */
export const pruneUnsupportedWorkspaceSources = (snapshot: CampusWorkspaceSnapshot): CampusWorkspaceSnapshot => {
  const sources = new Set<string>(firstWaveSourceCatalog.map((source) => source.id));
  const sourceStates = snapshot.sourceStates.filter((source) => sources.has(source.sourceId));
  if (sourceStates.length === snapshot.sourceStates.length) return snapshot;
  return { ...snapshot, sourceStates, summary: { ...snapshot.summary, totalSources: sourceStates.length, readySources: sourceStates.filter((source) => source.status === "ready").length } };
};

/** Counts come from original capabilities, never from their calendar projections as well. */
export const mergeWorkspaceSourceStates = (
  snapshot: CampusWorkspaceSnapshot,
  records: readonly CapabilityRecord<unknown>[],
  academicProviderId: string,
  accountId: string | null
): CampusWorkspaceSnapshot => {
  const cleaned = pruneUnsupportedWorkspaceSources(snapshot);
  const definitions = {
    "academic.timetable@1": { sourceId: "academic-affairs", label: "课表", count: (data: unknown) => (data as AcademicTimetableData | null)?.terms.reduce((sum, term) => sum + term.sessions.length, 0) ?? 0 },
    "academic.exams@1": { sourceId: "academic-affairs", label: "考试", count: (data: unknown) => (data as AcademicExamsData | null)?.exams.length ?? 0 },
    "academic.grades@1": { sourceId: "academic-affairs", label: "成绩", count: (data: unknown) => (data as AcademicGradesData | null)?.grades.length ?? 0 },
    "practice.records@1": { sourceId: "academic-affairs", label: "素拓", count: (data: unknown) => (data as AcademicPracticeData | null)?.records.length ?? 0 },
    "learning.assignments@1": { sourceId: "learning-platform", label: "作业", count: (data: unknown) => (data as LearningAssignmentsData | null)?.assignments.length ?? 0 },
    "learning.materials@1": { sourceId: "learning-platform", label: "资料", count: (data: unknown) => (data as LearningMaterialsData | null)?.materials.length ?? 0 }
  } as const;
  const stateLabels = { live: "已同步", cache: "缓存", fallback: "部分可用", unavailable: "暂不可用" };
  const sourceStates = cleaned.sourceStates.map((source) => {
    // Account-null publications are never proof that an authenticated source is connected.
    if (!accountId) return source;
    const providerId = source.sourceId === "academic-affairs" ? academicProviderId : "org.campusos.zju-learning";
    const current = new Map<string, { record: CapabilityRecord<unknown>; label: string; count: number }>();
    for (const record of records) {
      if (record.accountId !== accountId || record.providerId !== providerId || !(record.capability in definitions)) continue;
      const definition = definitions[record.capability as keyof typeof definitions];
      if (definition.sourceId !== source.sourceId) continue;
      const previous = current.get(record.capability);
      if (!previous || record.updatedAt > previous.record.updatedAt) current.set(record.capability, { record, label: definition.label, count: definition.count(record.data) });
    }
    if (current.size === 0) return source;
    const entries = [...current];
    const itemCountsByCapability = Object.fromEntries(entries.map(([capability, item]) => [capability, item.count]));
    const projectionDiagnostics = records.filter((record) => record.capability === "calendar.events@1" && record.accountId === accountId)
      .flatMap((record) => {
        const data = record.data as CalendarEventsData | null;
        if (data?.sourceId !== source.sourceId) return [];
        return [
          ...(data.diagnostics ?? []),
          ...(data.omittedItems > 0 ? [`${data.omittedItems} 项缺少可信时间，未写入日历。`] : [])
        ];
      });
    const ready = entries.every(([, item]) => item.record.state === "live") && projectionDiagnostics.length === 0;
    return {
      ...source,
      status: ready ? "ready" as const : "partial" as const,
      connectionState: "connected" as const,
      configuredUsername: accountId,
      lastSyncedAt: entries.map(([, item]) => item.record.updatedAt).sort().at(-1)!,
      itemCount: Object.values(itemCountsByCapability).reduce((sum, count) => sum + count, 0),
      itemCountsByCapability,
      summary: [...entries.map(([, item]) => `${item.label} ${item.count} 项（${stateLabels[item.record.state]}）${item.record.message ? `：${item.record.message}` : ""}`), ...new Set(projectionDiagnostics)].join("；"),
      actionLabel: ready ? "数据已同步" : "可重新同步，暂不可用的数据保留上次记录"
    };
  });
  return { ...cleaned, sourceStates, summary: { ...cleaned.summary, totalSources: sourceStates.length, readySources: sourceStates.filter((source) => source.status === "ready").length } };
};

export const createLiveWorkspaceSnapshot = ({
  generatedAt,
  accountId
}: {
  generatedAt: string;
  accountId: string;
}): CampusWorkspaceSnapshot => {
  const sourceStates: CampusSourceSyncState[] = firstWaveSourceCatalog.map(
    (source) => {
      const usesUnifiedAuthentication =
        source.id === "academic-affairs" || source.id === "learning-platform";

      return {
        sourceId: source.id,
        label: source.label,
        status: usesUnifiedAuthentication ? "partial" : "planned",
        connectionState: usesUnifiedAuthentication ? "connected" : "not-required",
        lastSyncedAt: generatedAt,
        itemCount: 0,
        summary: usesUnifiedAuthentication
          ? "已验证账号，正在等待真实数据源返回。"
          : "该数据源尚未接入真实连接器。",
        actionLabel: usesUnifiedAuthentication
          ? "正在刷新真实数据"
          : "等待连接器接入",
        configuredUsername: usesUnifiedAuthentication ? accountId : null
      };
    }
  );

  return {
    generatedAt,
    term: {
      label: "校历待同步",
      phase: "unavailable",
      currentWeek: null,
      progressPercent: 0
    },
    sourceStates,
    courses: [],
    todayCourses: [],
    deadlines: [],
    materialCourses: [],
    materials: [],
    downloads: [],
    reminders: [],
    summary: {
      readySources: 0,
      totalSources: sourceStates.length,
      downloadsInFlight: 0,
      materialsReady: 0,
      remindersQueued: 0,
      deadlinesDueSoon: 0
    }
  };
};

export const createEmptyWorkspaceSnapshot = ({
  generatedAt
}: {
  generatedAt: string;
}): CampusWorkspaceSnapshot => {
  const sourceStates: CampusSourceSyncState[] = firstWaveSourceCatalog.map(
    (source) => {
      const requiresCredentials =
        source.id === "academic-affairs" || source.id === "learning-platform";
      return {
        sourceId: source.id,
        label: source.label,
        status: "planned",
        connectionState: requiresCredentials ? "needs-credentials" : "not-required",
        lastSyncedAt: generatedAt,
        itemCount: 0,
        summary: requiresCredentials
          ? "请先在设置页连接统一身份认证。"
          : "该数据源尚未接入真实连接器。",
        actionLabel: requiresCredentials
          ? "前往设置页连接统一身份认证"
          : "等待连接器接入",
        configuredUsername: null
      };
    }
  );

  return {
    generatedAt,
    term: {
      label: "尚未连接教务日历",
      phase: "unavailable",
      currentWeek: null,
      progressPercent: 0
    },
    sourceStates,
    courses: [],
    todayCourses: [],
    deadlines: [],
    materialCourses: [],
    materials: [],
    downloads: [],
    reminders: [],
    summary: {
      readySources: 0,
      totalSources: sourceStates.length,
      downloadsInFlight: 0,
      materialsReady: 0,
      remindersQueued: 0,
      deadlinesDueSoon: 0
    }
  };
};

export const findAcademicCalendarRecord = (
  records: CapabilityRecord<AcademicCalendarConfigData>[],
  providerId: string
): CapabilityRecord<AcademicCalendarConfigData> | null =>
  records.find(
    (record) => record.providerId === providerId && record.accountId === null
  ) ?? null;

export const findLearningMaterialsRecord = (
  records: CapabilityRecord<LearningMaterialsData>[],
  providerId: string,
  accountId: string | null
): CapabilityRecord<LearningMaterialsData> | null =>
  records.find(
    (record) =>
      record.providerId === providerId &&
      record.accountId === accountId
  ) ?? null;

export const mergeLearningMaterialsIntoWorkspace = (
  snapshot: CampusWorkspaceSnapshot,
  record: CapabilityRecord<LearningMaterialsData> | null
): CampusWorkspaceSnapshot => {
  const materialCourses = record?.data?.courses
    .filter((course) => course.semesterName !== null)
    .map((course) => ({
      id: course.sourceId,
      name: course.name,
      semester: course.semesterName!
    })) ?? [];
  const materials = record?.data?.materials
    .map((material) => ({
      id: material.sourceId,
      title: material.fileName,
      courseName: material.courseName,
      semester: material.semesterName,
      sourceId: "learning-platform" as const,
      updatedAt: material.updatedAt ?? record.updatedAt,
      sizeBytes: material.size ?? undefined,
      downloadUrl: material.downloadUrl,
      downloadFallbackUrl: material.downloadFallbackUrl
    })) ?? [];
  return {
    ...snapshot,
    materialCourses,
    materials,
    summary: {
      ...snapshot.summary,
      materialsReady: materials.length
    }
  };
};

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

const formatSemesterLabel = (
  quarter: AcademicCalendarQuarter,
  quarters: readonly AcademicCalendarQuarter[]
): string => {
  const season = quarter.season.split("|").at(-1);
  const semesterSeasons = season === "\u79cb" || season === "\u51ac"
    ? ["\u79cb", "\u51ac"]
    : season === "\u6625" || season === "\u590f"
      ? ["\u6625", "\u590f"]
      : season
        ? [season]
        : [];
  const hasFullSemester = semesterSeasons.every((candidate) =>
    quarters.some(
      (item) =>
        item.academicYearStart === quarter.academicYearStart &&
        item.season.split("|").at(-1) === candidate
    )
  );
  const label = hasFullSemester ? semesterSeasons.join("") : season ?? "";
  return `${quarter.academicYearStart}-${quarter.academicYearStart + 1} ${label}学期`;
};

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
        label: formatSemesterLabel(active, quarters),
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

  // The latest semester stays current
  // only for 14 days after its final period. That boundary is applied
  // to 2|夏 so 小学期 remains visible briefly, then exposes the next complete
  // autumn-winter semester for the remaining summer break.
  const recentSpringSummerEnd = quarters
    .filter(
      (quarter) =>
        quarter.season.split("|").at(-1) === "夏" && quarter.endDate < today
    )
    .map((quarter) => dateOnlyTimestamp(quarter.endDate))
    .sort((left, right) => right - left)[0];
  const recentSpringSummerDays = Number.isFinite(recentSpringSummerEnd)
    ? Math.floor((todayTimestamp - recentSpringSummerEnd) / DAY_IN_MS)
    : Number.POSITIVE_INFINITY;
  if (recentSpringSummerDays >= 0 && recentSpringSummerDays <= SUMMER_TERM_FALLBACK_DAYS) {
    const summerQuarter = quarters.find(
      (quarter) =>
        quarter.season.split("|").at(-1) === "夏" &&
        dateOnlyTimestamp(quarter.endDate) === recentSpringSummerEnd
    );
    if (summerQuarter) {
      return {
        ...snapshot,
        term: {
          label: formatSemesterLabel(summerQuarter, quarters),
          phase: "active",
          currentWeek: null,
          progressPercent: 0
        }
      };
    }
  }

  if (upcoming) {
    return {
      ...snapshot,
      term: {
        label: formatSemesterLabel(upcoming, quarters),
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
  return null;
};

const isDeadlineRepresented = (
  deadline: CampusDeadline,
  supportedKinds: ReadonlySet<CalendarEventKind>
): boolean =>
  (deadline.kind === "exam" && supportedKinds.has("exam")) ||
  (deadline.kind === "assignment" && supportedKinds.has("assignment"));

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
  now: number,
  today: string
): CampusDeadline | null => {
  const kind = deadlineKindForEvent(event.kind);
  if (!kind || !isAbsoluteDateTime(event.startAt)) return null;
  // Expired todos are removed before projection, using the requested
  // Shanghai calendar-day boundary.
  if (formatShanghaiDate(event.startAt) < today) {
    return null;
  }
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

export const pruneWorkspaceDeadlinesBeforeToday = (
  snapshot: CampusWorkspaceSnapshot,
  nowIso: string,
  reminderLeadMinutes: number[]
): CampusWorkspaceSnapshot => {
  const today = formatShanghaiDate(nowIso);
  const now = Date.parse(nowIso);
  const deadlines = snapshot.deadlines.filter(
    (deadline) =>
      isAbsoluteDateTime(deadline.dueAt) &&
      formatShanghaiDate(deadline.dueAt) >= today
  );
  const reminders = buildReminderQueue(
    snapshot.courses,
    deadlines,
    reminderLeadMinutes,
    nowIso
  );
  const deadlinesDueSoon = deadlines.filter((deadline) => {
    const remaining = Date.parse(deadline.dueAt) - now;
    return remaining >= 0 && remaining <= 36 * HOUR_IN_MS;
  }).length;

  if (
    deadlines.length === snapshot.deadlines.length &&
    JSON.stringify(reminders) === JSON.stringify(snapshot.reminders) &&
    snapshot.summary.remindersQueued === reminders.length &&
    snapshot.summary.deadlinesDueSoon === deadlinesDueSoon
  ) {
    return snapshot;
  }

  return {
    ...snapshot,
    deadlines,
    reminders,
    summary: {
      ...snapshot.summary,
      remindersQueued: reminders.length,
      deadlinesDueSoon
    }
  };
};

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
  let calendarEvents = snapshot.calendarEvents ? [...snapshot.calendarEvents] : [];
  const sourceStates = [...snapshot.sourceStates];
  const retainedDegradedSources = new Set<CampusSourceId>();
  const now = Date.parse(snapshot.generatedAt);
  const today = formatShanghaiDate(snapshot.generatedAt);

  for (const [sourceId, sourceRecords] of recordsBySource) {
    const supportedKinds = new Set(
      sourceRecords.flatMap((record) => record.data.supportedKinds)
    );
    // 降级 feed（cache/fallback/unavailable）产出空结果时不得清空已有事件。
    // 实测 2026-09-13：课表刷新失败发布 data:null，投影产出 0 条课程事件，
    // 整源替换把已有的 171 个课程事件全部删除，学业课表与日程同时变空。
    const feedIsAuthoritative = sourceRecords.every(
      (record) => record.state === "live"
    );
    const incomingEventIds = new Set(
      sourceRecords
        .flatMap((record) => record.data.events)
        .filter(
          (event) =>
            event.sourceId === sourceId && supportedKinds.has(event.kind)
        )
        .map((event) => event.id)
    );
    const retainedEventCount = calendarEvents.filter(
      (event) =>
        event.sourceId === sourceId && supportedKinds.has(event.kind)
    ).length;
    if (
      incomingEventIds.size === 0 &&
      retainedEventCount > 0 &&
      !feedIsAuthoritative
    ) {
      retainedDegradedSources.add(sourceId);
      const retained = sourceStates.find((state) => state.sourceId === sourceId);
      if (retained && !retained.retainedDegradedAt) {
        retained.retainedDegradedAt = retained.lastSyncedAt;
      }
      continue;
    }
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
    calendarEvents = calendarEvents.filter(
      (event) => event.sourceId !== sourceId || !supportedKinds.has(event.kind)
    );
    calendarEvents.push(...events);
    const newCourses = events
      .map(toCourse)
      .filter((course): course is CampusCourseSession => course !== null);
    const newDeadlines = events
      .map((event) => toDeadline(event, now, today))
      .filter((deadline): deadline is CampusDeadline => deadline !== null);
    const acceptedEventCount = newCourses.length + newDeadlines.length;
    // 区分两种丢弃：缺可信绝对时间（数据问题）与已过截止日（按规则不列入待办）。
    const untrustedEventCount = events.filter(
      (event) => !isAbsoluteDateTime(event.startAt)
    ).length;
    const expiredEventCount = events.filter(
      (event) =>
        isAbsoluteDateTime(event.startAt) &&
        deadlineKindForEvent(event.kind) !== null &&
        formatShanghaiDate(event.startAt) < today
    ).length;
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
      ) + untrustedEventCount;
    const existingState = sourceStates.find(
      (source) => source.sourceId === sourceId
    );
    const previousFeedCounts = existingState?.itemCountsByCapability ?? {};
    const currentFeedCounts = sourceRecords.reduce<Record<string, number>>(
      (counts, record) => {
        counts[record.capability] =
          (counts[record.capability] ?? 0) + record.data.totalItems;
        return counts;
      },
      {}
    );
    const previousReplacedCount = Object.entries(currentFeedCounts).reduce(
      (total, [capability]) => total + (previousFeedCounts[capability] ?? 0),
      0
    );
    const fallbackReplacedCount =
      Object.keys(previousFeedCounts).length === 0
        ? removedCourseCount + removedDeadlineCount
        : previousReplacedCount;
    const retainedItemCount = Math.max(
      0,
      (existingState?.itemCount ?? 0) - fallbackReplacedCount
    );
    const itemCountsByCapability = {
      ...previousFeedCounts,
      ...currentFeedCounts
    };
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
        retainedItemCount + totalItems
      ),
      itemCountsByCapability,
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
      configuredUsername: accountId ?? existingState?.configuredUsername ?? null,
      // 投影时被丢弃的条目数（缺可信时间等），供界面如实提示。
      omittedItemCount: omittedItems,
      // 已过截止日而未列入待办的条目数（按规则丢弃）。
      expiredItemCount: expiredEventCount
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

  // 保留上次事件的来源要在界面上说明，不能静默沿用旧数据。
  for (const sourceId of retainedDegradedSources) {
    const index = sourceStates.findIndex((state) => state.sourceId === sourceId);
    if (index < 0) continue;
    sourceStates[index] = {
      ...sourceStates[index],
      summary: `${sourceStates[index].summary}本轮数据源降级且未返回事件，已保留上次事件。`
    };
  }

  courses = sortCourses(courses);
  deadlines = sortDeadlines(deadlines);
  const reminders = buildReminderQueue(
    courses,
    deadlines,
    reminderLeadMinutes,
    snapshot.generatedAt
  );
  const todayCourses = courses.filter(
    (course) => formatShanghaiDate(course.startAt) === today
  );

  return {
    ...snapshot,
    sourceStates,
    courses,
    todayCourses,
    deadlines,
    calendarEvents: [...new Map(calendarEvents.map((event) => [event.id, event])).values()],
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
