import { createHash, randomUUID } from "node:crypto";
import type {
  CampusWorkspaceSnapshot,
  CalendarExportInput,
  LocalTaskInput,
  LocalTaskMutation,
  LocalTaskRecord,
  LocalTaskRepeatType,
  LocalTaskStatus,
  LocalTaskType
} from "@campusos/shared";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const SHANGHAI_TIME_ZONE = "Asia/Shanghai";
const SHANGHAI_OFFSET_MS = 8 * 60 * MINUTE_MS;

export interface TaskPeriod {
  id: string;
  taskId: string;
  title: string;
  description: string;
  location: string;
  startAt: string;
  endAt: string;
  type: LocalTaskType;
  status: LocalTaskStatus;
  blocksPlanning: boolean;
}

export interface TaskRefreshResult {
  tasks: LocalTaskRecord[];
  changed: boolean;
}

export interface ScheduleDomainOptions {
  now?: Date;
  idFactory?: () => string;
}

const getIdFactory = (options?: ScheduleDomainOptions): (() => string) =>
  options?.idFactory ?? randomUUID;

const parseDate = (value: string, field: string): Date => {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`${field} 不是有效时间。`);
  }
  return new Date(timestamp);
};

const toIso = (value: Date | number): string =>
  new Date(value).toISOString();

const getShanghaiDateParts = (value: Date): Record<string, string> => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHANGHAI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(value);
  return Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
  );
};

const fromShanghaiParts = (
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0
): Date => new Date(
  Date.UTC(year, month - 1, day, hour, minute, second, millisecond) - SHANGHAI_OFFSET_MS
);

const startOfDay = (value: Date): Date => {
  const parts = getShanghaiDateParts(value);
  return fromShanghaiParts(Number(parts.year), Number(parts.month), Number(parts.day));
};

const dateOnly = (value: Date): Date => startOfDay(value);

const dateOnlyIso = (value: string, field: string): string => {
  const parts = getShanghaiDateParts(parseDate(value, field));
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

const addDays = (value: Date, days: number): Date =>
  new Date(value.getTime() + days * DAY_MS);

const addNextPeriod = (
  start: Date,
  end: Date,
  repeatType: LocalTaskRepeatType,
  repeatPeriod: number,
  repeatWeekdays: number[] = []
): { start: Date; end: Date } => {
  if (repeatType === "days" || repeatType === "weeks") {
    const delta = Math.max(1, repeatPeriod) * (repeatType === "weeks" ? 7 : 1) * DAY_MS;
    return { start: new Date(start.getTime() + delta), end: new Date(end.getTime() + delta) };
  }

  if (repeatType === "weekdays") {
    const allowed = (repeatWeekdays.length > 0 ? repeatWeekdays : [1, 2, 3, 4, 5]).sort((left, right) => left - right);
    const parts = getShanghaiDateParts(start);
    const currentDay = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day))).getUTCDay();
    const nextOffset = allowed.map((weekday) => (weekday - currentDay + 7) % 7 || 7).sort((left, right) => left - right)[0] ?? 7;
    const nextStart = new Date(start.getTime() + nextOffset * DAY_MS);
    const delta = nextStart.getTime() - start.getTime();
    return { start: nextStart, end: new Date(end.getTime() + delta) };
  }

  if (repeatType === "month") {
    const parts = getShanghaiDateParts(start);
    let year = Number(parts.year);
    let month = Number(parts.month) + 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    const day = Number(parts.day);
    while (daysInMonth(year, month) < day) {
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
    }
    const nextStart = fromShanghaiParts(
      year,
      month,
      day,
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
      start.getUTCMilliseconds()
    );
    const delta = nextStart.getTime() - start.getTime();
    return { start: nextStart, end: new Date(end.getTime() + delta) };
  }

  if (repeatType === "year") {
    const parts = getShanghaiDateParts(start);
    let year = Number(parts.year) + 1;
    const month = Number(parts.month);
    const day = Number(parts.day);
    while (daysInMonth(year, month) < day) year += 1;
    const nextStart = fromShanghaiParts(
      year,
      month,
      day,
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
      start.getUTCMilliseconds()
    );
    const delta = nextStart.getTime() - start.getTime();
    return { start: nextStart, end: new Date(end.getTime() + delta) };
  }

  return { start, end };
};

const normalizeStatus = (value: unknown): LocalTaskStatus => {
  const statuses: LocalTaskStatus[] = [
    "running",
    "suspended",
    "completed",
    "overdue",
    "deleted",
    "outdated"
  ];
  return statuses.includes(value as LocalTaskStatus)
    ? (value as LocalTaskStatus)
    : "running";
};

const normalizeType = (value: unknown): LocalTaskType =>
  value === "fixed" || value === "floating" || value === "fixedlegacy" ? value : "deadline";

const normalizeRepeatType = (value: unknown): LocalTaskRepeatType =>
  value === "days" || value === "weeks" || value === "weekdays" || value === "month" || value === "year"
    ? value
    : "norepeat";

const finiteNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

export const normalizeTaskRecord = (
  value: LocalTaskRecord,
  options?: ScheduleDomainOptions
): LocalTaskRecord => {
  const start = parseDate(value.startAt, "任务开始时间");
  const end = parseDate(value.endAt, "任务结束时间");
  if (!(start.getTime() < end.getTime())) {
    throw new Error("任务开始时间必须早于结束时间。");
  }
  const needed = Math.max(1, Math.round(finiteNumber(value.timeNeededMinutes, 60)));
  const spent = Math.min(
    needed,
    Math.max(0, Math.round(finiteNumber(value.timeSpentMinutes, 0)))
  );

  return {
    id: typeof value.id === "string" && value.id.length > 0 ? value.id : getIdFactory(options)(),
    status: normalizeStatus(value.status),
    description: typeof value.description === "string" ? value.description : "",
    timeSpentMinutes: spent,
    timeNeededMinutes: needed,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    location: typeof value.location === "string" ? value.location : "",
    title: typeof value.title === "string" && value.title.trim() ? value.title.trim() : "未命名任务",
    breakable: value.breakable !== false,
    type: normalizeType(value.type),
    repeatType: normalizeRepeatType(value.repeatType),
    repeatPeriod: Math.max(1, Math.round(finiteNumber(value.repeatPeriod, 1))),
    repeatEndsOn: dateOnlyIso(value.repeatEndsOn, "重复结束日期"),
    repeatWeekdays: Array.isArray(value.repeatWeekdays) ? value.repeatWeekdays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6) : [],
    blocksPlanning: value.blocksPlanning !== false,
    reminderMode: value.reminderMode === "none" || value.reminderMode === "at-time" || value.reminderMode === "lead" || value.reminderMode === "custom"
      ? value.reminderMode
      : "global",
    reminderLeadMinutes: Number.isFinite(value.reminderLeadMinutes)
      ? Math.max(0, Math.round(value.reminderLeadMinutes ?? 0))
      : null,
    reminderAt: typeof value.reminderAt === "string" && Number.isFinite(Date.parse(value.reminderAt))
      ? new Date(value.reminderAt).toISOString()
      : null,
    fromId: typeof value.fromId === "string" ? value.fromId : null,
    deletedAt: typeof value.deletedAt === "string" && Number.isFinite(Date.parse(value.deletedAt)) ? value.deletedAt : null,
    courseName: typeof value.courseName === "string" ? value.courseName : null,
    source: value.source && typeof value.source === "object" && value.source.kind === "ai-assistant" && typeof value.source.fingerprint === "string"
      ? {
        kind: "ai-assistant",
        fingerprint: value.source.fingerprint,
        provider: value.source.provider,
        model: value.source.model,
        importedAt: value.source.importedAt
      }
      : null
  };
};

export const createTaskRecord = (
  input: LocalTaskInput,
  options?: ScheduleDomainOptions
): LocalTaskRecord => {
  const idFactory = getIdFactory(options);
  const record = normalizeTaskRecord(
    {
      id: input.id ?? idFactory(),
      status: "running",
      ...input,
      fromId: null
    },
    { ...options, idFactory }
  );
  if (record.type === "fixedlegacy") {
    throw new Error("不能新建过去日程。");
  }
  return record;
};

export const applyTaskMutation = (
  tasks: LocalTaskRecord[],
  mutation: LocalTaskMutation
): LocalTaskRecord[] => {
  const target = tasks.find((task) => task.id === mutation.id);
  if (!target) throw new Error("任务不存在。");
  const seriesId = target.type === "fixedlegacy" ? target.fromId : target.id;
  const scope = mutation.scope ?? "single";
  const matchesSeries = (task: LocalTaskRecord): boolean =>
    task.id === mutation.id || (seriesId !== null && (task.id === seriesId || task.fromId === seriesId));

  if (mutation.action === "purge") {
    const retained = tasks.filter((task) => {
      if (!matchesSeries(task)) return true;
      if (scope === "series") return mutation.includeCompleted !== false || task.status !== "completed";
      return task.id !== mutation.id;
    });
    if (retained.length === tasks.length) throw new Error("任务不存在。");
    return retained;
  }

  return tasks.map((task) => {
    const isTarget = task.id === mutation.id;
    const isSeriesMember = matchesSeries(task);
    const shouldApply = mutation.action === "restore"
      ? isTarget
      : mutation.status === "deleted" && (
        scope === "series" ? isSeriesMember : scope === "future" ? isTarget || (seriesId !== null && task.fromId === seriesId && Date.parse(task.startAt) >= Date.parse(target.startAt)) : isTarget
      );
    if (!shouldApply) return task;
    const next = { ...task };
    if (mutation.action === "restore") {
      next.status = next.type === "deadline" && Date.parse(next.endAt) < Date.now() ? "overdue" : next.type === "fixedlegacy" ? "outdated" : "running";
      next.deletedAt = null;
    } else if (mutation.status) {
      next.status = mutation.status;
      next.deletedAt = mutation.status === "deleted" ? new Date().toISOString() : null;
    }
    if (mutation.timeSpentMinutes !== undefined) {
      next.timeSpentMinutes = Math.min(next.timeNeededMinutes, Math.max(0, Math.round(mutation.timeSpentMinutes)));
    }
    if (next.status === "completed") next.timeSpentMinutes = next.timeNeededMinutes;
    return next;
  });
};
const taskChanged = (left: LocalTaskRecord[], right: LocalTaskRecord[]): boolean =>
  JSON.stringify(left) !== JSON.stringify(right);

export const refreshLocalTasks = (
  source: LocalTaskRecord[],
  now = new Date(),
  options?: ScheduleDomainOptions
): TaskRefreshResult => {
  const idFactory = getIdFactory(options);
  const cutoff = now.getTime() - 30 * DAY_MS;
  const current = source
    .map((task) => normalizeTaskRecord(task, { ...options, idFactory }))
    .filter((task) => task.status !== "deleted" || !task.deletedAt || Date.parse(task.deletedAt) >= cutoff);
  const existingFixedIds = new Set<string>();
  const historical: LocalTaskRecord[] = [];

  for (const task of current) {
    if (task.status === "deleted") continue;
    if (task.type === "floating") {
      continue;
    }

    if (task.type === "deadline") {
      if (task.timeSpentMinutes >= task.timeNeededMinutes) {
        task.status = "completed";
      } else if (task.status !== "completed" && Date.parse(task.endAt) < now.getTime()) {
        task.status = "overdue";
      }
      continue;
    }

    if (task.type !== "fixed") continue;
    existingFixedIds.add(task.id);
    const repeatEnd = dateOnly(parseDate(task.repeatEndsOn, "重复结束日期"));
    let start = parseDate(task.startAt, "任务开始时间");
    let end = parseDate(task.endAt, "任务结束时间");
    const customReminderOffsetMs = task.reminderMode === "custom" && task.reminderAt
      ? Date.parse(task.reminderAt) - start.getTime()
      : null;
    task.status = dateOnly(start).getTime() > repeatEnd.getTime() ? "outdated" : "running";

    let guard = 0;
    while (end.getTime() < now.getTime() && task.status !== "outdated") {
      const legacy: LocalTaskRecord = {
        ...task,
        id: idFactory(),
        status: "outdated",
        type: "fixedlegacy",
        title: `${task.title}（过去日程）`,
        repeatType: "norepeat",
        repeatPeriod: 1,
        repeatEndsOn: toIso(dateOnly(end)).slice(0, 10),
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        fromId: task.id,
        deletedAt: null
      };
      historical.push(legacy);
      if (task.repeatType === "norepeat") {
        task.status = "outdated";
        break;
      }
      const next = addNextPeriod(start, end, task.repeatType, task.repeatPeriod, task.repeatWeekdays ?? []);
      start = next.start;
      end = next.end;
      task.startAt = start.toISOString();
      task.endAt = end.toISOString();
      if (customReminderOffsetMs !== null) {
        task.reminderAt = new Date(start.getTime() + customReminderOffsetMs).toISOString();
      }
      task.status = dateOnly(start).getTime() > repeatEnd.getTime() ? "outdated" : "running";
      if (++guard > 20_000) throw new Error("重复任务实例数量超过安全上限。");
    }
  }

  const result = current
    .concat(historical)
    .filter((task) => task.type !== "fixedlegacy" || existingFixedIds.has(task.fromId ?? ""))
    .sort((left, right) =>
      Date.parse(left.endAt) - Date.parse(right.endAt) || left.id.localeCompare(right.id)
    );
  return { tasks: result, changed: taskChanged(source, result) };
};

const periodForDay = (
  start: Date,
  end: Date,
  date: Date
): { start: Date; end: Date } | null => {
  const dayStart = startOfDay(date);
  const dayEnd = addDays(dayStart, 1);
  const left = Math.max(start.getTime(), dayStart.getTime());
  const right = Math.min(end.getTime(), dayEnd.getTime());
  return left < right ? { start: new Date(left), end: new Date(right) } : null;
};

const buildTaskInstances = (
  task: LocalTaskRecord,
  rangeStart: Date,
  rangeEnd: Date
): TaskPeriod[] => {
  const result: TaskPeriod[] = [];
  if (task.type === "floating") return result;
  const start = parseDate(task.startAt, "任务开始时间");
  const end = parseDate(task.endAt, "任务结束时间");
  const addInstance = (instanceStart: Date, instanceEnd: Date, suffix: string): void => {
    if (instanceEnd.getTime() <= rangeStart.getTime() || instanceStart.getTime() >= rangeEnd.getTime()) return;
    for (
      let cursor = startOfDay(instanceStart);
      cursor.getTime() < instanceEnd.getTime();
      cursor = addDays(cursor, 1)
    ) {
      const chopped = periodForDay(instanceStart, instanceEnd, cursor);
      if (!chopped) continue;
      result.push({
        id: `${task.id}${suffix}-${cursor.toISOString().slice(0, 10)}`,
        taskId: task.id,
        title: task.title,
        description: task.description,
        location: task.location,
        startAt: chopped.start.toISOString(),
        endAt: chopped.end.toISOString(),
        type: task.type,
        status: task.status,
        blocksPlanning: task.blocksPlanning
      });
    }
  };

  if (task.type === "deadline") {
    addInstance(start, end, "");
    return result;
  }

  let instanceStart = start;
  let instanceEnd = end;
  const repeatEnd = dateOnly(parseDate(task.repeatEndsOn, "重复结束日期"));
  let guard = 0;
  while (instanceStart.getTime() <= rangeEnd.getTime() && dateOnly(instanceStart).getTime() <= repeatEnd.getTime()) {
    addInstance(instanceStart, instanceEnd, `-${instanceStart.toISOString()}`);
    if (task.repeatType === "norepeat") break;
    const next = addNextPeriod(instanceStart, instanceEnd, task.repeatType, task.repeatPeriod, task.repeatWeekdays ?? []);
    instanceStart = next.start;
    instanceEnd = next.end;
    if (++guard > 20_000) break;
  }
  return result;
};

export const getTaskCalendarPeriods = (
  tasks: LocalTaskRecord[],
  rangeStart: Date,
  rangeEnd: Date
): TaskPeriod[] => tasks.filter((task) => task.status !== "deleted").flatMap((task) => buildTaskInstances(task, rangeStart, rangeEnd));

const toIcalLocal = (value: Date): string => {
  const parts = getShanghaiDateParts(value);
  return `${parts.year}${parts.month}${parts.day}T${parts.hour}${parts.minute}${parts.second}`;
};

const toIcalUtc = (value: Date): string =>
  value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

const escapeIcal = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/([,;])/g, "\\$1");

const stableUid = (value: string): string =>
  `${createHash("sha1").update(value, "utf8").digest("hex")}@campusos`;

interface IcalEvent {
  id: string;
  title: string;
  description?: string;
  location?: string;
  startAt: string;
  endAt: string;
}

export const createIcalContent = (
  snapshot: CampusWorkspaceSnapshot,
  tasks: LocalTaskRecord[],
  input: CalendarExportInput,
  now = new Date()
): { content: string; eventCount: number } => {
  const events: IcalEvent[] = [];
  const canonicalEventIds = new Set(
    snapshot.calendarEvents?.map((event) => event.id) ?? []
  );
  for (const event of snapshot.calendarEvents ?? []) {
    if (event.kind === "exam" && input.includeExams === false) continue;
    if (event.kind === "task" && input.includeTasks === false) continue;
    const startMs = Date.parse(event.startAt);
    const endMs = event.endAt
      ? Date.parse(event.endAt)
      : startMs + 60 * MINUTE_MS;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
    const isDueAtEvent = event.kind === "assignment" || event.kind === "task";
    const startAt = isDueAtEvent
      ? new Date(startMs - 60 * MINUTE_MS).toISOString()
      : new Date(startMs).toISOString();
    events.push({
      id: `calendar:${event.id}`,
      title: event.title,
      description: event.note ?? undefined,
      location: event.location ?? undefined,
      startAt,
      endAt: isDueAtEvent ? new Date(startMs).toISOString() : new Date(endMs).toISOString()
    });
  }
  for (const course of snapshot.courses) {
    if (canonicalEventIds.has(course.id)) continue;
    events.push({
      id: `course:${course.id}`,
      title: course.title,
      description: course.note,
      location: course.location,
      startAt: course.startAt,
      endAt: course.endAt
    });
  }
  for (const deadline of snapshot.deadlines) {
    if (canonicalEventIds.has(deadline.id)) continue;
    if (input.includeExams === false && deadline.kind === "exam") continue;
    const start = new Date(Date.parse(deadline.dueAt) - 60 * MINUTE_MS);
    events.push({
      id: `deadline:${deadline.id}`,
      title: deadline.title,
      description: deadline.note,
      location: "",
      startAt: start.toISOString(),
      endAt: deadline.dueAt
    });
  }
  if (input.includeTasks !== false) {
    const taskPeriods = getTaskCalendarPeriods(
      tasks,
      addDays(startOfDay(now), -365),
      addDays(startOfDay(now), 1095)
    );
    for (const task of taskPeriods) {
      events.push({
        id: `task:${task.id}`,
        title: task.title,
        description: task.description,
        location: task.location,
        startAt: task.startAt,
        endAt: task.endAt
      });
    }
  }
  events.sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt) || left.id.localeCompare(right.id));
  const generatedAt = toIcalUtc(now);
  const lines = [
    "BEGIN:VCALENDAR",
    `X-WR-CALNAME:${escapeIcal(input.termLabel || `CampusOS ${input.academicYearStart ?? ""}`)}`,
    "PRODID:-//CampusOS//Schedule 1.0//CN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VTIMEZONE",
    "TZID:Asia/Shanghai",
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:+0800",
    "TZOFFSETTO:+0800",
    "END:STANDARD",
    "END:VTIMEZONE"
  ];
  for (const event of events) {
    const identity = `${event.id}|${event.title}|${event.startAt}|${event.endAt}|${event.location ?? ""}`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${stableUid(identity)}`,
      `DTSTAMP:${generatedAt}`,
      `DTSTART;TZID=Asia/Shanghai:${toIcalLocal(new Date(event.startAt))}`,
      `DTEND;TZID=Asia/Shanghai:${toIcalLocal(new Date(event.endAt))}`,
      `SUMMARY:${escapeIcal(event.title)}`,
      ...(event.description ? [`DESCRIPTION:${escapeIcal(event.description)}`] : []),
      ...(event.location ? [`LOCATION:${escapeIcal(event.location)}`] : []),
      "SEQUENCE:0",
      "TRANSP:OPAQUE",
      "BEGIN:VALARM",
      "TRIGGER:-PT15M",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeIcal(event.title)}`,
      "END:VALARM",
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return { content: `${lines.join("\r\n")}\r\n`, eventCount: events.length };
};
