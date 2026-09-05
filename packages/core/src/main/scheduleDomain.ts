import { createHash, randomUUID } from "node:crypto";
import type {
  CampusWorkspaceSnapshot,
  CalendarExportInput,
  LocalTaskInput,
  LocalTaskMutation,
  LocalTaskOccurrenceOverride,
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
  occurrenceId: string;
  occurrenceKey: string;
  occurrenceIndex: number;
  occurrenceStartAt: string;
  occurrenceEndAt: string;
  seriesGroupId: string;
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
  value === "fixed" || value === "fixedlegacy" ? value : "deadline";

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

  const repeatEndsOn = typeof value.repeatEndsOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.repeatEndsOn)
    ? value.repeatEndsOn
    : dateOnlyIso(value.endAt, "重复结束日期");
  const repeatEndMode = value.repeatEndMode === "never" || value.repeatEndMode === "count"
    ? value.repeatEndMode
    : "date";
  const occurrenceOverrides = value.occurrenceOverrides && typeof value.occurrenceOverrides === "object"
    ? Object.fromEntries(Object.entries(value.occurrenceOverrides).flatMap(([key, override]) => {
      if (!/^\d+$/.test(key) || !override || typeof override !== "object") return [];
      const candidate = override as LocalTaskOccurrenceOverride;
      return [[key, {
        ...(candidate.status === "running" || candidate.status === "suspended" || candidate.status === "completed" || candidate.status === "deleted" ? { status: candidate.status } : {}),
        ...(Number.isFinite(candidate.timeSpentMinutes) ? { timeSpentMinutes: Math.max(0, Math.round(candidate.timeSpentMinutes ?? 0)) } : {}),
        ...(typeof candidate.title === "string" ? { title: candidate.title } : {}),
        ...(typeof candidate.description === "string" ? { description: candidate.description } : {}),
        ...(typeof candidate.location === "string" ? { location: candidate.location } : {}),
        ...(typeof candidate.startAt === "string" && Number.isFinite(Date.parse(candidate.startAt)) ? { startAt: new Date(candidate.startAt).toISOString() } : {}),
        ...(typeof candidate.endAt === "string" && Number.isFinite(Date.parse(candidate.endAt)) ? { endAt: new Date(candidate.endAt).toISOString() } : {}),
        ...(candidate.reminderMode ? { reminderMode: candidate.reminderMode } : {}),
        ...(candidate.reminderLeadMinutes === null || Number.isFinite(candidate.reminderLeadMinutes) ? { reminderLeadMinutes: candidate.reminderLeadMinutes ?? null } : {}),
        ...(candidate.reminderAt === null
          ? { reminderAt: null }
          : typeof candidate.reminderAt === "string" && Number.isFinite(Date.parse(candidate.reminderAt))
            ? { reminderAt: new Date(candidate.reminderAt).toISOString() }
            : {}),
        ...(typeof candidate.deletedAt === "string" && Number.isFinite(Date.parse(candidate.deletedAt)) ? { deletedAt: candidate.deletedAt } : {})
      } satisfies LocalTaskOccurrenceOverride]];
    }))
    : {};

  const normalizedId = typeof value.id === "string" && value.id.length > 0 ? value.id : getIdFactory(options)();
  return {
    id: normalizedId,
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
    repeatEndsOn,
    repeatWeekdays: Array.isArray(value.repeatWeekdays) ? value.repeatWeekdays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6) : [],
    repeatEndMode,
    repeatCount: repeatEndMode === "count" ? Math.max(1, Math.round(finiteNumber(value.repeatCount, 1))) : null,
    seriesGroupId: typeof value.seriesGroupId === "string" && value.seriesGroupId ? value.seriesGroupId : normalizedId,
    occurrenceOverrides,
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

  if (mutation.occurrenceKey !== undefined && target.type === "fixed" && target.repeatType !== "norepeat") {
    if (scope === "series" && mutation.status === "deleted") {
      return tasks.map((task) => task.seriesGroupId === (target.seriesGroupId ?? target.id)
        ? { ...task, status: "deleted", deletedAt: new Date().toISOString() }
        : task);
    }
    if (scope === "future" && mutation.status === "deleted") {
      const occurrence = getTaskOccurrenceBounds(target, mutation.occurrenceKey);
      if (!occurrence) throw new Error("任务实例不存在。");
      const previous = addDays(startOfDay(new Date(occurrence.startAt)), -1);
      const parts = getShanghaiDateParts(previous);
      return tasks.map((task) => task.id === target.id ? {
        ...task,
        repeatEndMode: "date" as const,
        repeatEndsOn: `${parts.year}-${parts.month}-${parts.day}`
      } : task);
    }
    return tasks.map((task) => {
      if (task.id !== target.id) return task;
      const prior = task.occurrenceOverrides?.[mutation.occurrenceKey ?? ""] ?? {};
      const nextOverride: LocalTaskOccurrenceOverride = { ...prior };
      if (mutation.action === "restore") {
        nextOverride.status = "running";
        nextOverride.deletedAt = null;
      } else if (mutation.status) {
        nextOverride.status = mutation.status;
        nextOverride.deletedAt = mutation.status === "deleted" ? new Date().toISOString() : null;
      }
      if (mutation.timeSpentMinutes !== undefined) {
        nextOverride.timeSpentMinutes = Math.min(task.timeNeededMinutes, Math.max(0, Math.round(mutation.timeSpentMinutes)));
      }
      if (nextOverride.status === "completed") nextOverride.timeSpentMinutes = task.timeNeededMinutes;
      return {
        ...task,
        occurrenceOverrides: { ...(task.occurrenceOverrides ?? {}), [mutation.occurrenceKey ?? ""]: nextOverride }
      };
    });
  }

  return tasks.map((task) => {
    const isTarget = task.id === mutation.id;
    const isSeriesMember = matchesSeries(task);
    // 非"删除"的状态变更（completed/suspended/running）与 timeSpentMinutes 一律作用于直接目标；
    // 删除保留 scope（single/future/series）语义；restore 作用于直接目标。
    const shouldApply = mutation.action === "restore"
      ? isTarget
      : mutation.status === "deleted"
        ? (scope === "series" ? isSeriesMember : scope === "future" ? isTarget || (seriesId !== null && task.fromId === seriesId && Date.parse(task.startAt) >= Date.parse(target.startAt)) : isTarget)
        : isTarget;
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
  for (const task of current) {
    if (task.status === "deleted") continue;
    if (task.type === "deadline") {
      if (task.timeSpentMinutes >= task.timeNeededMinutes) {
        task.status = "completed";
      } else if (task.status !== "completed" && Date.parse(task.endAt) < now.getTime()) {
        task.status = "overdue";
      }
      continue;
    }

    if (task.type === "fixed" && task.status !== "suspended") {
      task.status = "running";
    }
  }

  const result = current
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
  const start = parseDate(task.startAt, "任务开始时间");
  const end = parseDate(task.endAt, "任务结束时间");
  const addInstance = (instanceStart: Date, instanceEnd: Date, occurrenceIndex: number): void => {
    const occurrenceKey = String(occurrenceIndex);
    const occurrenceId = `${task.id}:${occurrenceKey}`;
    const override = task.occurrenceOverrides?.[occurrenceKey];
    const resolvedStart = override?.startAt ? parseDate(override.startAt, "实例开始时间") : instanceStart;
    const resolvedEnd = override?.endAt ? parseDate(override.endAt, "实例结束时间") : instanceEnd;
    if (resolvedEnd <= resolvedStart) return;
    if (override?.status === "deleted") return;
    if (resolvedEnd.getTime() <= rangeStart.getTime() || resolvedStart.getTime() >= rangeEnd.getTime()) return;
    for (
      let cursor = startOfDay(resolvedStart);
      cursor.getTime() < resolvedEnd.getTime();
      cursor = addDays(cursor, 1)
    ) {
      const chopped = periodForDay(resolvedStart, resolvedEnd, cursor);
      if (!chopped) continue;
      result.push({
        id: `${occurrenceId}-${cursor.toISOString().slice(0, 10)}`,
        taskId: task.id,
        title: override?.title ?? task.title,
        description: override?.description ?? task.description,
        location: override?.location ?? task.location,
        startAt: chopped.start.toISOString(),
        endAt: chopped.end.toISOString(),
        type: task.type,
        status: override?.status ?? (task.type === "fixed" && resolvedEnd.getTime() < Date.now() ? "outdated" : task.status),
        blocksPlanning: task.blocksPlanning,
        occurrenceId,
        occurrenceKey,
        occurrenceIndex,
        occurrenceStartAt: resolvedStart.toISOString(),
        occurrenceEndAt: resolvedEnd.toISOString(),
        seriesGroupId: task.seriesGroupId ?? task.id
      });
    }
  };

  if (task.type === "deadline") {
    addInstance(start, end, 0);
    return result;
  }

  const duration = end.getTime() - start.getTime();
  const endMode = task.repeatType === "norepeat" ? "count" : (task.repeatEndMode ?? "date");
  const maxCount = task.repeatType === "norepeat" ? 1 : endMode === "count" ? Math.max(1, task.repeatCount ?? 1) : Number.POSITIVE_INFINITY;
  const endDate = endMode === "date" ? dateOnly(parseDate(task.repeatEndsOn, "重复结束日期")) : null;
  const accepts = (candidate: Date, index: number): boolean => index < maxCount && (!endDate || dateOnly(candidate).getTime() <= endDate.getTime());
  let occurrenceIndex = 0;
  const emit = (candidate: Date): boolean => {
    if (!accepts(candidate, occurrenceIndex)) return false;
    addInstance(candidate, new Date(candidate.getTime() + duration), occurrenceIndex);
    occurrenceIndex += 1;
    return candidate.getTime() <= rangeEnd.getTime();
  };

  if (task.repeatType === "weeks" || task.repeatType === "weekdays") {
    const anchorParts = getShanghaiDateParts(start);
    const anchorWeekday = new Date(Date.UTC(Number(anchorParts.year), Number(anchorParts.month) - 1, Number(anchorParts.day))).getUTCDay();
    const weekdays = [...new Set(task.repeatWeekdays?.length ? task.repeatWeekdays : task.repeatType === "weekdays" ? [1, 2, 3, 4, 5] : [anchorWeekday])].sort((a, b) => a - b);
    const mondayOffset = anchorWeekday === 0 ? -6 : 1 - anchorWeekday;
    const weekAnchor = addDays(start, mondayOffset);
    for (let week = 0, guard = 0; guard < 20_000; week += Math.max(1, task.repeatPeriod), guard += 1) {
      let continued = false;
      for (const weekday of weekdays) {
        const offset = weekday === 0 ? 6 : weekday - 1;
        const candidate = addDays(weekAnchor, week * 7 + offset);
        if (candidate < start) continue;
        if (!accepts(candidate, occurrenceIndex)) return result;
        continued = emit(candidate) || continued;
      }
      if (!continued && addDays(weekAnchor, week * 7).getTime() > rangeEnd.getTime()) break;
    }
    return result;
  }

  for (let cycle = 0, guard = 0; guard < 20_000; cycle += 1, guard += 1) {
    let candidate = start;
    if (cycle > 0 && task.repeatType === "days") candidate = addDays(start, cycle * Math.max(1, task.repeatPeriod));
    else if (cycle > 0 && task.repeatType === "month") {
      const parts = getShanghaiDateParts(start);
      const totalMonth = Number(parts.month) - 1 + cycle * Math.max(1, task.repeatPeriod);
      const year = Number(parts.year) + Math.floor(totalMonth / 12);
      const month = totalMonth % 12 + 1;
      candidate = fromShanghaiParts(year, month, Math.min(Number(parts.day), daysInMonth(year, month)), Number(parts.hour), Number(parts.minute), Number(parts.second), start.getUTCMilliseconds());
    } else if (cycle > 0 && task.repeatType === "year") {
      const parts = getShanghaiDateParts(start);
      const year = Number(parts.year) + cycle * Math.max(1, task.repeatPeriod);
      const month = Number(parts.month);
      candidate = fromShanghaiParts(year, month, Math.min(Number(parts.day), daysInMonth(year, month)), Number(parts.hour), Number(parts.minute), Number(parts.second), start.getUTCMilliseconds());
    }
    if (!accepts(candidate, occurrenceIndex)) break;
    emit(candidate);
    if (candidate.getTime() > rangeEnd.getTime() || task.repeatType === "norepeat") break;
  }
  return result;
};

/** Resolve an occurrence by its stable series index without depending on the active view range. */
export function getTaskOccurrenceBounds(
  task: LocalTaskRecord,
  occurrenceKey: string
): { startAt: string; endAt: string } | null {
  if (!/^\d+$/.test(occurrenceKey)) return null;
  const targetIndex = Number(occurrenceKey);
  if (!Number.isSafeInteger(targetIndex) || targetIndex < 0 || targetIndex >= 20_000) return null;
  const start = parseDate(task.startAt, "任务开始时间");
  const end = parseDate(task.endAt, "任务结束时间");
  const duration = end.getTime() - start.getTime();
  const endMode = task.repeatType === "norepeat" ? "count" : (task.repeatEndMode ?? "date");
  const maxCount = task.repeatType === "norepeat" ? 1 : endMode === "count" ? Math.max(1, task.repeatCount ?? 1) : Number.POSITIVE_INFINITY;
  const endDate = endMode === "date" ? dateOnly(parseDate(task.repeatEndsOn, "重复结束日期")) : null;
  let index = 0;
  const inspect = (candidate: Date): { found?: { startAt: string; endAt: string }; stop: boolean } => {
    if (index >= maxCount || (endDate && dateOnly(candidate).getTime() > endDate.getTime())) return { stop: true };
    if (index === targetIndex) {
      return {
        found: { startAt: candidate.toISOString(), endAt: new Date(candidate.getTime() + duration).toISOString() },
        stop: true
      };
    }
    index += 1;
    return { stop: false };
  };

  if (task.repeatType === "weeks" || task.repeatType === "weekdays") {
    const anchorParts = getShanghaiDateParts(start);
    const anchorWeekday = new Date(Date.UTC(Number(anchorParts.year), Number(anchorParts.month) - 1, Number(anchorParts.day))).getUTCDay();
    const weekdays = [...new Set(task.repeatWeekdays?.length ? task.repeatWeekdays : task.repeatType === "weekdays" ? [1, 2, 3, 4, 5] : [anchorWeekday])].sort((left, right) => left - right);
    const mondayOffset = anchorWeekday === 0 ? -6 : 1 - anchorWeekday;
    const weekAnchor = addDays(start, mondayOffset);
    for (let week = 0, guard = 0; guard < 20_000; week += Math.max(1, task.repeatPeriod), guard += 1) {
      for (const weekday of weekdays) {
        const offset = weekday === 0 ? 6 : weekday - 1;
        const candidate = addDays(weekAnchor, week * 7 + offset);
        if (candidate < start) continue;
        const result = inspect(candidate);
        if (result.found) return result.found;
        if (result.stop) return null;
      }
    }
    return null;
  }

  for (let cycle = 0; cycle < 20_000; cycle += 1) {
    let candidate = start;
    if (cycle > 0 && task.repeatType === "days") candidate = addDays(start, cycle * Math.max(1, task.repeatPeriod));
    else if (cycle > 0 && task.repeatType === "month") {
      const parts = getShanghaiDateParts(start);
      const totalMonth = Number(parts.month) - 1 + cycle * Math.max(1, task.repeatPeriod);
      const year = Number(parts.year) + Math.floor(totalMonth / 12);
      const month = totalMonth % 12 + 1;
      candidate = fromShanghaiParts(year, month, Math.min(Number(parts.day), daysInMonth(year, month)), Number(parts.hour), Number(parts.minute), Number(parts.second), start.getUTCMilliseconds());
    } else if (cycle > 0 && task.repeatType === "year") {
      const parts = getShanghaiDateParts(start);
      const year = Number(parts.year) + cycle * Math.max(1, task.repeatPeriod);
      const month = Number(parts.month);
      candidate = fromShanghaiParts(year, month, Math.min(Number(parts.day), daysInMonth(year, month)), Number(parts.hour), Number(parts.minute), Number(parts.second), start.getUTCMilliseconds());
    }
    const result = inspect(candidate);
    if (result.found) return result.found;
    if (result.stop || task.repeatType === "norepeat") return null;
  }
  return null;
}

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
