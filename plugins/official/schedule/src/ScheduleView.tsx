import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  LocalTaskInput,
  LocalTaskPeriod,
  LocalTaskRecord,
  PluginComponentProps
} from "@campusos/shared";
import { AppIcon } from "./AppIcon";
import { formatDateTime, formatTimeRange } from "./formatters";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  exportElementAsPng,
  exportViewAsMarkdown
} from "@/lib/exportView";

type ScheduleViewMode = "month" | "week" | "agenda" | "day";

interface ScheduleViewProps extends PluginComponentProps {
  schedule?: PluginComponentProps["schedule"];
}
type ScheduleEvent = {
  id: string;
  title: string;
  kind: "course" | "exam" | "assignment" | "deadline" | "task";
  startAt: string;
  endAt: string;
  location?: string;
  note?: string;
  taskId?: string;
  status?: LocalTaskRecord["status"];
};

interface TaskFormState {
  id?: string;
  title: string;
  description: string;
  timeSpentMinutes: number;
  timeNeededMinutes: number;
  startAt: string;
  endAt: string;
  location: string;
  breakable: boolean;
  type: "deadline" | "fixed";
  repeatType: "norepeat" | "days" | "weeks" | "weekdays" | "month" | "year";
  repeatPeriod: number;
  repeatEndsOn: string;
  repeatWeekdays?: number[];
  blocksPlanning: boolean;
  reminderMode: "global" | "none" | "at-time" | "lead" | "custom";
  reminderLeadMinutes: number;
  reminderAt: string;
}

const SHANGHAI_TIME_ZONE = "Asia/Shanghai";
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

const pad = (value: number): string => String(value).padStart(2, "0");

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
  minute = 0
): Date => new Date(
  Date.UTC(year, month - 1, day, hour, minute) - SHANGHAI_OFFSET_MS
);

const toDateInput = (value: Date): string => {
  const parts = getShanghaiDateParts(value);
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const toDateTimeInput = (value: Date): string => {
  const parts = getShanghaiDateParts(value);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
};

const fromDateTimeInput = (value: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("时间格式无效。");
  const date = fromShanghaiParts(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5])
  );
  if (!Number.isFinite(date.getTime())) throw new Error("时间格式无效。");
  return date.toISOString();
};

const startOfDay = (value: Date): Date => {
  const parts = getShanghaiDateParts(value);
  return fromShanghaiParts(Number(parts.year), Number(parts.month), Number(parts.day));
};

const addDays = (value: Date, days: number): Date =>
  new Date(value.getTime() + days * 24 * 60 * 60 * 1000);

const addMonths = (value: Date, months: number): Date => {
  const parts = getShanghaiDateParts(value);
  return fromShanghaiParts(Number(parts.year), Number(parts.month) + months, 1);
};

const getShanghaiWeekday = (value: Date): number => {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: SHANGHAI_TIME_ZONE,
    weekday: "short"
  }).format(value);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
};

const startOfWeek = (value: Date): Date => {
  const day = getShanghaiWeekday(value);
  return addDays(startOfDay(value), day === 0 ? -6 : 1 - day);
};

const dayKey = (value: Date | string): string => {
  const date = typeof value === "string" ? new Date(value) : value;
  return toDateInput(date);
};

const monthKey = (value: Date | string): string => dayKey(value).slice(0, 7);

const dateFromDayKey = (value: string): Date => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("日期格式无效。");
  return fromShanghaiParts(Number(match[1]), Number(match[2]), Number(match[3]));
};

export const getShanghaiDayNumber = (value: Date): number =>
  Number(getShanghaiDateParts(value).day);

const weekdayLabels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

const formatMonth = (value: Date): string =>
  new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", timeZone: SHANGHAI_TIME_ZONE }).format(value);

const formatDay = (value: Date): string => {
  const parts = getShanghaiDateParts(value);
  return `${Number(parts.month)}月${Number(parts.day)}日 ${weekdayLabels[(getShanghaiWeekday(value) + 6) % 7]}`;
};

const formatWeek = (value: Date): string => {
  const first = startOfWeek(value);
  const last = addDays(first, 6);
  const firstParts = getShanghaiDateParts(first);
  const lastParts = getShanghaiDateParts(last);
  return `${Number(firstParts.month)}月${Number(firstParts.day)}日 - ${Number(lastParts.month)}月${Number(lastParts.day)}日`;
};

const buildMonthDays = (month: Date): Date[] => {
  const parts = getShanghaiDateParts(month);
  const first = startOfWeek(fromShanghaiParts(Number(parts.year), Number(parts.month), 1));
  return Array.from({ length: 42 }, (_, index) => addDays(first, index));
};

const defaultTaskForm = (date = new Date()): TaskFormState => {
  const parts = getShanghaiDateParts(date);
  const start = fromShanghaiParts(
    Number(parts.year),
    Number(parts.month),
    Number(parts.day),
    Number(parts.hour),
    0
  );
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    title: "",
    description: "",
    timeSpentMinutes: 0,
    timeNeededMinutes: 60,
    startAt: toDateTimeInput(start),
    endAt: toDateTimeInput(end),
    location: "",
    breakable: true,
    type: "deadline",
    repeatType: "norepeat",
    repeatPeriod: 1,
    repeatEndsOn: toDateInput(end),
    blocksPlanning: true,
    reminderMode: "global",
    reminderLeadMinutes: 15,
    reminderAt: toDateTimeInput(end)
  };
};

const taskToForm = (task: LocalTaskRecord): TaskFormState => ({
  id: task.id,
  title: task.title,
  description: task.description,
  timeSpentMinutes: task.timeSpentMinutes,
  timeNeededMinutes: task.timeNeededMinutes,
  startAt: toDateTimeInput(new Date(task.startAt)),
  endAt: toDateTimeInput(new Date(task.endAt)),
  location: task.location,
  breakable: task.breakable,
  type: task.type === "fixedlegacy" ? "fixed" : task.type,
  repeatType: task.repeatType,
  repeatPeriod: task.repeatPeriod,
  repeatEndsOn: task.repeatEndsOn,
  blocksPlanning: task.blocksPlanning,
  reminderMode: task.reminderMode ?? "global",
  reminderLeadMinutes: task.reminderLeadMinutes ?? 15,
  reminderAt: task.reminderAt ? toDateTimeInput(new Date(task.reminderAt)) : toDateTimeInput(new Date(task.endAt))
});

const buildEvents = (
  snapshot: PluginComponentProps["snapshot"],
  periods: LocalTaskPeriod[]
): ScheduleEvent[] => {
  if (!snapshot) return periods.map((period) => ({
    id: `task:${period.id}`,
    taskId: period.taskId,
    kind: "task",
    title: period.title,
    startAt: period.startAt,
    endAt: period.endAt,
    location: period.location,
    status: period.status
  }));
  const canonicalEventIds = new Set(
    snapshot.calendarEvents?.map((event) => event.id) ?? []
  );
  const projectedCalendarEvents: ScheduleEvent[] = [
    ...(snapshot.calendarEvents ?? []).map((event) => ({
      id: `calendar:${event.id}`,
      kind: event.kind,
      title: event.title,
      startAt: event.startAt,
      endAt: event.endAt ?? new Date(Date.parse(event.startAt) + 60 * 60 * 1000).toISOString(),
      location: event.location ?? undefined,
      note: event.note ?? undefined
    })),
    ...snapshot.courses
      .filter((course) => !canonicalEventIds.has(course.id))
      .map((course) => ({
        id: `course:${course.id}`,
        kind: "course" as const,
        title: course.title,
        startAt: course.startAt,
        endAt: course.endAt,
        location: course.location,
        note: course.note
      })),
    ...snapshot.deadlines
      .filter((deadline) => !canonicalEventIds.has(deadline.id))
      .map((deadline) => ({
        id: `deadline:${deadline.id}`,
        kind: "deadline" as const,
        title: deadline.title,
        startAt: new Date(new Date(deadline.dueAt).getTime() - 60 * 60 * 1000).toISOString(),
        endAt: deadline.dueAt,
        note: deadline.note
      }))
  ];
  return [
    ...projectedCalendarEvents,
    ...periods.map((period) => ({
      id: `task:${period.id}`,
      taskId: period.taskId,
      kind: "task" as const,
      title: period.title,
      startAt: period.startAt,
      endAt: period.endAt,
      location: period.location,
      status: period.status
    }))
  ].sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt));
};

const eventIntersectsRange = (
  event: ScheduleEvent,
  start: Date,
  end: Date
): boolean => {
  const eventStart = Date.parse(event.startAt);
  const eventEnd = Date.parse(event.endAt);
  return Number.isFinite(eventStart) && Number.isFinite(eventEnd) &&
    eventEnd > start.getTime() && eventStart < end.getTime();
};

export const groupEventsByDay = (
  events: ScheduleEvent[],
  range: { start: Date; end: Date }
): Map<string, ScheduleEvent[]> => {
  const result = new Map<string, ScheduleEvent[]>();
  for (const event of events) {
    if (!eventIntersectsRange(event, range.start, range.end)) continue;
    const eventStart = Math.max(Date.parse(event.startAt), range.start.getTime());
    const eventEnd = Math.min(Date.parse(event.endAt), range.end.getTime());
    for (
      let cursor = startOfDay(new Date(eventStart));
      cursor.getTime() < eventEnd;
      cursor = addDays(cursor, 1)
    ) {
      const key = dayKey(cursor);
      result.set(key, [...(result.get(key) ?? []), event]);
    }
  }
  for (const items of result.values()) {
    items.sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt));
  }
  return result;
};

const formatEventMeta = (event: ScheduleEvent): string => {
  if (event.kind === "deadline") return `截止 ${formatDateTime(event.endAt)}`;
  return formatTimeRange(event.startAt, event.endAt);
};

const eventClassName = (event: ScheduleEvent): string =>
  `schedule-event schedule-event-${event.kind}${event.status === "completed" ? " is-complete" : ""}`;

const eventRange = (mode: ScheduleViewMode, date: Date): { start: Date; end: Date } => {
  if (mode === "month" || mode === "agenda") {
    const parts = getShanghaiDateParts(date);
    const first = mode === "month"
      ? startOfWeek(fromShanghaiParts(Number(parts.year), Number(parts.month), 1))
      : fromShanghaiParts(Number(parts.year), Number(parts.month), 1);
    return {
      start: first,
      end: mode === "month"
        ? addDays(first, 42)
        : fromShanghaiParts(Number(parts.year), Number(parts.month) + 1, 1)
    };
  }
  if (mode === "week") {
    const first = startOfWeek(date);
    return { start: first, end: addDays(first, 7) };
  }
  const start = startOfDay(date);
  return { start, end: addDays(start, 1) };
};

export const ScheduleView = ({
  snapshot,
  schedule,
  navigationTarget,
  academicCalendar,
  desktopCalendarHost
}: ScheduleViewProps): JSX.Element => {
  const [viewMode, setViewMode] = useState<ScheduleViewMode>("month");
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const schedulePageRef = useRef<HTMLElement | null>(null);
  const [tasks, setTasks] = useState<LocalTaskRecord[]>([]);
  const [taskUpdatedAt, setTaskUpdatedAt] = useState<string | null>(null);
  const [periods, setPeriods] = useState<LocalTaskPeriod[]>([]);
  const [form, setForm] = useState<TaskFormState | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<ScheduleEvent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<LocalTaskRecord | null>(null);
  const [deleteCompletedHistory, setDeleteCompletedHistory] = useState(false);
  const [moreDay, setMoreDay] = useState<string | null>(null);
  const [miniOpen, setMiniOpen] = useState(false);
  const [miniMonth, setMiniMonth] = useState(() => new Date());
  const [hiddenKinds, setHiddenKinds] = useState<ReadonlySet<ScheduleEvent["kind"]>>(new Set());
  const [timeStepMinutes, setTimeStepMinutes] = useState<15 | 30 | 60>(30);
  const [eventStyle, setEventStyleState] = useState<"bar" | "dot">(() => {
    try {
      return globalThis.localStorage?.getItem("campusos.schedule.event-style") === "dot" ? "dot" : "bar";
    } catch {
      return "bar";
    }
  });
  const [density, setDensityState] = useState<"comfortable" | "compact">(() => {
    try {
      return globalThis.localStorage?.getItem("campusos.schedule.density") === "compact" ? "compact" : "comfortable";
    } catch {
      return "comfortable";
    }
  });
  const [dragEvent, setDragEvent] = useState<ScheduleEvent | null>(null);
  const [dragPreview, setDragPreview] = useState<{ startAt: string; endAt: string } | null>(null);
  const [conflictEvents, setConflictEvents] = useState<Set<string>>(new Set());
  const [makeupDays, setMakeupDays] = useState<ReadonlyArray<{ date: string; weekday: number; source: "builtin" | "manual" }>>([]);
  const [statutoryHolidays, setStatutoryHolidays] = useState<ReadonlyArray<{ date: string; label: string }>>([]);
  const [contextDay, setContextDay] = useState<string | null>(null);
  const selectedTask = useMemo(
    () => selectedEvent?.taskId ? tasks.find((task) => task.id === selectedEvent.taskId) ?? null : null,
    [selectedEvent, tasks]
  );
  useEffect(() => {
    try {
      globalThis.localStorage?.setItem("campusos.schedule.event-style", eventStyle);
    } catch {
      // Ignore
    }
  }, [eventStyle]);

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem("campusos.schedule.density", density);
    } catch {
      // Ignore
    }
  }, [density]);

  const setEventStyle = (next: "bar" | "dot"): void => setEventStyleState(next);
  const setDensity = (next: "comfortable" | "compact"): void => setDensityState(next);

  const loadAcademicCalendar = useCallback(async (): Promise<void> => {
    if (!academicCalendar) return;
    try {
      const record = await academicCalendar.loadSettings();
      setMakeupDays(record.makeupDays ?? []);
      setStatutoryHolidays(record.statutoryHolidays ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取调休校历。");
    }
  }, [academicCalendar]);

  const persistAcademicCalendar = async (nextHolidays: ReadonlyArray<{ date: string; label: string }>, nextMakeup: ReadonlyArray<{ date: string; weekday: number; source: "builtin" | "manual" }>): Promise<void> => {
    if (!academicCalendar) return;
    try {
      await academicCalendar.saveSettings({ statutoryHolidays: [...nextHolidays], makeupDays: [...nextMakeup] });
      setStatutoryHolidays(nextHolidays);
      setMakeupDays(nextMakeup);
      setContextDay(null);
      setNotice("调休校历已更新");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "调休校历保存失败。");
    }
  };

  const setDayHoliday = async (date: string, label: string): Promise<void> => {
    const existing = statutoryHolidays.find((holiday) => holiday.date === date);
    const next = existing ? statutoryHolidays.map((holiday) => holiday.date === date ? { ...holiday, label } : holiday) : [...statutoryHolidays, { date, label }];
    // 节假日与补课互斥：设节假日时移除该天的补课。
    const nextMakeup = makeupDays.filter((makeup) => makeup.date !== date);
    await persistAcademicCalendar(next, nextMakeup);
  };

  const clearDay = async (date: string): Promise<void> => {
    await persistAcademicCalendar(
      statutoryHolidays.filter((holiday) => holiday.date !== date),
      makeupDays.filter((makeup) => makeup.date !== date)
    );
  };

  const setDayMakeup = async (date: string, weekday: number): Promise<void> => {
    const existing = makeupDays.find((makeup) => makeup.date === date);
    const next = existing ? makeupDays.map((makeup) => makeup.date === date ? { ...makeup, weekday, source: "manual" as const } : makeup) : [...makeupDays, { date, weekday, source: "manual" as const }];
    // 补课与节假日互斥：设补课时移除该天的节假日。
    const nextHolidays = statutoryHolidays.filter((holiday) => holiday.date !== date);
    await persistAcademicCalendar(nextHolidays, next);
  };

  useEffect(() => {
    void loadAcademicCalendar();
  }, [loadAcademicCalendar]);

  const [deskCalendarRunning, setDeskCalendarRunning] = useState(false);

  useEffect(() => {
    void desktopCalendarHost?.status().then((record) => setDeskCalendarRunning(record.running)).catch(() => undefined);
  }, [desktopCalendarHost]);

  const toggleDeskCalendar = async (): Promise<void> => {
    const next = !deskCalendarRunning;
    setDeskCalendarRunning(next);
    try {
      if (next) {
        await desktopCalendarHost?.refreshFeed?.();
        await desktopCalendarHost?.start();
      } else {
        await desktopCalendarHost?.stop();
      }
    } catch {
      setDeskCalendarRunning(!next);
    }
  };

  const loadTasks = useCallback(async (): Promise<void> => {
    if (!schedule) return;
    try {
      const data = await schedule.loadTasks();
      setTasks(data.tasks);
      setTaskUpdatedAt(data.updatedAt);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取本地任务。");
    }
  }, [schedule]);

  useEffect(() => {
    void loadTasks();
    if (!schedule) return undefined;
    return schedule.subscribe(() => {
      void loadTasks();
    });
  }, [loadTasks, schedule]);

  const range = useMemo(() => eventRange(viewMode, selectedDate), [selectedDate, viewMode]);

  const periodsRange = useMemo(() => {
    const nextStart = new Date();
    const nextEnd = new Date(nextStart.getTime() + 48 * 60 * 60 * 1000);
    return {
      start: new Date(Math.min(range.start.getTime(), nextStart.getTime())),
      end: new Date(Math.max(range.end.getTime(), nextEnd.getTime()))
    };
  }, [range]);

  useEffect(() => {
    if (!schedule) return undefined;
    let active = true;
    void schedule.loadPeriods({ startAt: periodsRange.start.toISOString(), endAt: periodsRange.end.toISOString() })
      .then((next) => {
        if (active) setPeriods(next);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "无法读取任务日程。");
      });
    return () => {
      active = false;
    };
  }, [periodsRange.end, periodsRange.start, schedule, taskUpdatedAt]);

  const events = useMemo(
    () => buildEvents(snapshot, periods).filter((event) => !hiddenKinds.has(event.kind)),
    [hiddenKinds, periods, snapshot]
  );
  const eventsByDay = useMemo(() => groupEventsByDay(events, range), [events, range]);
  const monthDays = useMemo(() => buildMonthDays(selectedDate), [selectedDate]);
  const weekDays = useMemo(() => {
    const first = startOfWeek(selectedDate);
    return Array.from({ length: 7 }, (_, index) => addDays(first, index));
  }, [selectedDate]);

  const movePeriod = (delta: number): void => {
    setSelectedDate((current) => {
      if (viewMode === "day") return addDays(current, delta);
      if (viewMode === "week") return addDays(current, delta * 7);
      return addMonths(current, delta);
    });
    setSelectedEvent(null);
  };

  // 键盘方向键翻页（焦点不在输入控件时）。
  useEffect(() => {
    const isTyping = (target: EventTarget | null): boolean => {
      const element = target as HTMLElement | null;
      return element !== null && (element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.tagName === "SELECT" || element.isContentEditable);
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (isTyping(event.target)) return;
      if (event.key === "ArrowLeft") { event.preventDefault(); movePeriod(-1); }
      else if (event.key === "ArrowRight") { event.preventDefault(); movePeriod(1); }
      else if (event.key === "ArrowUp") { event.preventDefault(); setSelectedDate(new Date()); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const selectEvent = (event: ScheduleEvent): void => {
    setSelectedEvent(event);
  };

  const isTaskEditable = (event: ScheduleEvent): boolean =>
    event.taskId !== undefined && event.kind === "task";

  // 日视图拖拽：按像素偏移换算分钟（1 小时 = 52px 基准，实际按容器高度换算）。
  const dayDragState = useRef<{ event: ScheduleEvent; originStart: number; originEnd: number; startY: number; startHeight: number; mode: "move" | "resize-end" } | null>(null);

  const beginDayDrag = (event: ScheduleEvent, mode: "move" | "resize-end") => (pointer: React.PointerEvent<HTMLElement>): void => {
    if (!isTaskEditable(event)) return;
    pointer.preventDefault();
    const originStart = Date.parse(event.startAt);
    const originEnd = Date.parse(event.endAt);
    dayDragState.current = { event, originStart, originEnd, startY: pointer.clientY, startHeight: originEnd - originStart, mode };
    setDragEvent(event);
    setDragPreview({ startAt: event.startAt, endAt: event.endAt });
    (pointer.currentTarget as HTMLElement).setPointerCapture(pointer.pointerId);
  };

  const moveDayDrag = (pointer: React.PointerEvent<HTMLElement>): void => {
    const state = dayDragState.current;
    if (!state) return;
    const container = pointer.currentTarget.closest(".schedule-day-timeline") as HTMLElement | null;
    if (!container) return;
    const hoursPerPx = 24 / Math.max(1, container.getBoundingClientRect().height);
    const deltaMinutes = Math.round((pointer.clientY - state.startY) * hoursPerPx * 60 / timeStepMinutes) * timeStepMinutes;
    const newStart = state.originStart + deltaMinutes * 60_000;
    const newEnd = state.mode === "move" ? newStart + state.startHeight : newStart + (pointer.clientY - state.startY) * hoursPerPx * 60_000;
    const snappedEnd = newEnd - ((newEnd - newStart) % (timeStepMinutes * 60_000));
    const clampedEnd = Math.max(newStart + timeStepMinutes * 60_000, snappedEnd);
    const preview = { startAt: new Date(newStart).toISOString(), endAt: new Date(clampedEnd).toISOString() };
    setDragPreview(preview);
    // 冲突检测：与其它自建任务重叠（排除自身）。
    const conflicts = new Set<string>();
    for (const candidate of events) {
      if (candidate.id === state.event.id || candidate.taskId === undefined) continue;
      const candidateStart = Date.parse(candidate.startAt);
      const candidateEnd = Date.parse(candidate.endAt);
      if (candidateStart < Date.parse(preview.endAt) && candidateEnd > Date.parse(preview.startAt)) conflicts.add(candidate.id);
    }
    setConflictEvents(conflicts);
  };

  const endDayDrag = async (): Promise<void> => {
    const state = dayDragState.current;
    if (!state || !dragPreview || !schedule || !state.event.taskId) {
      dayDragState.current = null;
      setDragEvent(null);
      setDragPreview(null);
      setConflictEvents(new Set());
      return;
    }
    const original = tasks.find((task) => task.id === state.event.taskId);
    const next = { ...dragPreview };
    dayDragState.current = null;
    setDragEvent(null);
    setDragPreview(null);
    setConflictEvents(new Set());
    if (!original) return;
    try {
      await schedule.saveTask({
        id: original.id,
        title: original.title,
        description: original.description,
        timeSpentMinutes: original.timeSpentMinutes,
        timeNeededMinutes: Math.max(timeStepMinutes, Math.round((Date.parse(next.endAt) - Date.parse(next.startAt)) / 60_000)),
        startAt: next.startAt,
        endAt: next.endAt,
        location: original.location,
        breakable: original.breakable,
        type: original.type === "fixedlegacy" ? "fixed" : original.type,
        repeatType: original.repeatType,
        repeatPeriod: original.repeatPeriod,
        repeatEndsOn: original.repeatEndsOn,
        repeatWeekdays: original.repeatWeekdays ?? [],
        blocksPlanning: original.blocksPlanning,
        reminderMode: original.reminderMode,
        reminderLeadMinutes: original.reminderLeadMinutes,
        reminderAt: original.reminderAt
      });
      setNotice("任务时间已更新");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "任务时间更新失败。");
    }
  };

  const eventsRef = useRef(events);
  eventsRef.current = events;
  const pendingNavigation = useRef<NonNullable<PluginComponentProps["navigationTarget"]> | null>(null);

  const applyNavigationTarget = (target: NonNullable<PluginComponentProps["navigationTarget"]>): void => {
    const event = eventsRef.current.find((candidate) => candidate.id === target.entityId);
    if (!event) return;
    pendingNavigation.current = null;
    setSelectedDate(new Date(event.startAt));
    setViewMode("day");
    setSelectedEvent(event);
  };

  useEffect(() => {
    if (navigationTarget?.viewId !== "schedule" || !navigationTarget.entityId) return;
    pendingNavigation.current = navigationTarget;
    applyNavigationTarget(navigationTarget);
  }, [navigationTarget]);

  // Events load asynchronously; apply a pending navigation once they arrive
  // without reopening the detail on later event refreshes.
  useEffect(() => {
    const pending = pendingNavigation.current;
    if (!pending) return;
    applyNavigationTarget(pending);
  }, [events]);

  const saveForm = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!schedule || !form) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const input: LocalTaskInput = {
        id: form.id,
        title: form.title,
        description: form.description,
        timeSpentMinutes: form.timeSpentMinutes,
        timeNeededMinutes: form.timeNeededMinutes,
        startAt: fromDateTimeInput(form.startAt),
        endAt: fromDateTimeInput(form.endAt),
        location: form.location,
        breakable: form.breakable,
        type: form.type,
        repeatType: form.type === "fixed" ? form.repeatType : "norepeat",
        repeatPeriod: form.repeatPeriod,
        repeatEndsOn: form.repeatEndsOn,
        repeatWeekdays: form.repeatWeekdays ?? [],
        blocksPlanning: form.blocksPlanning,
        reminderMode: form.reminderMode,
        reminderLeadMinutes: form.reminderMode === "lead" ? form.reminderLeadMinutes : null,
        reminderAt: form.reminderMode === "custom" ? fromDateTimeInput(form.reminderAt) : null
      };
      const data = await schedule.saveTask(input);
      setTasks(data.tasks);
      setTaskUpdatedAt(data.updatedAt);
      setForm(null);
      setNotice("任务已保存");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "任务保存失败。");
    } finally {
      setBusy(false);
    }
  };

  const mutate = async (
    task: LocalTaskRecord,
    status: "running" | "suspended" | "completed" | "deleted",
    options: { scope?: "single" | "future" | "series"; includeCompleted?: boolean } = {}
  ): Promise<void> => {
    if (!schedule) return;
    setBusy(true);
    setError(null);
    try {
      const data = await schedule.mutateTask({ id: task.id, status, ...(options.scope ? { scope: options.scope } : {}), ...(options.includeCompleted !== undefined ? { includeCompleted: options.includeCompleted } : {}) });
      setTasks(data.tasks);
      setTaskUpdatedAt(data.updatedAt);
      if (form?.id === task.id) setForm(null);
      setNotice(status === "deleted" ? "任务已删除" : "任务状态已更新");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "任务状态更新失败。");
    } finally {
      setBusy(false);
    }
  };

  const deleteTask = async (task: LocalTaskRecord): Promise<void> => {
    if ((task.type === "fixed" && task.repeatType !== "norepeat") || task.status === "completed") {
      setSelectedEvent(null);
      setPendingDelete(task);
      setDeleteCompletedHistory(false);
      return;
    }
    await mutate(task, "deleted");
  };

  const confirmTaskDelete = async (scope: "single" | "future" | "series"): Promise<void> => {
    if (!pendingDelete) return;
    const task = pendingDelete;
    setPendingDelete(null);
    await mutate(task, "deleted", { scope, includeCompleted: deleteCompletedHistory });
  };

  const exportIcal = async (): Promise<void> => {
    if (!schedule) return;
    setBusy(true);
    setError(null);
    try {
      await schedule.exportIcal({
        academicYearStart: new Date().getFullYear(),
        termLabel: snapshot?.term.label ?? "CampusOS 日程",
        includeExams: true,
        includeTasks: true
      });
      setNotice("iCal 已生成并交给系统日历打开");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "iCal 导出失败。");
    } finally {
      setBusy(false);
    }
  };

  const exportMarkdown = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const sortedTasks = [...tasks]
        .filter((task) => task.deletedAt === undefined || task.deletedAt === null)
        .sort((left, right) => left.startAt.localeCompare(right.startAt));
      const taskRows = sortedTasks.map((task) => [
        formatTimeRange(task.startAt, task.endAt),
        task.title,
        task.courseName ?? "-",
        task.location || "-",
        task.status
      ]);
      const periodRows = periods.map((period) => [
        formatTimeRange(period.startAt, period.endAt),
        period.title,
        period.location || "-"
      ]);
      await exportViewAsMarkdown(
        {
          title: "日程导出",
          generatedAt: new Date().toISOString(),
          sections: [
            {
              heading: "待办与课程安排",
              rows: [
                ["时间", "事项", "课程", "地点", "状态"],
                ...taskRows
              ]
            },
            periodRows.length > 0
              ? {
                  heading: "时段",
                  rows: [
                    ["时间", "名称", "地点"],
                    ...periodRows
                  ]
                }
              : { heading: "时段", rows: [] }
          ]
        },
        `日程导出-${new Date().toISOString().slice(0, 10)}`
      );
      setNotice("Markdown 已导出");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Markdown 导出失败。");
    } finally {
      setBusy(false);
    }
  };

  const exportPng = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const element = schedulePageRef.current;
      if (!element) throw new Error("日程视图暂不可导出。");
      await exportElementAsPng(
        element,
        `日程导出-${new Date().toISOString().slice(0, 10)}`
      );
      setNotice("图片已导出");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "图片导出失败。");
    } finally {
      setBusy(false);
    }
  };

  const periodLabel = viewMode === "day"
    ? formatDay(selectedDate)
    : viewMode === "week"
      ? formatWeek(selectedDate)
      : formatMonth(selectedDate);

  return (
    <section className="page-shell schedule-page" ref={schedulePageRef}>
      <header className="page-heading schedule-heading">
        <div>
          <h1>日程</h1>
        </div>
        <div className="schedule-actions">
          <Button variant="ghost" type="button" disabled={busy || !schedule} onClick={() => setForm(defaultTaskForm(selectedDate))}>
            新建
          </Button>
          <Button variant="ghost" type="button" disabled={busy || !schedule} onClick={() => void exportIcal()}>
            导出 iCal
          </Button>
          <Button variant="ghost" type="button" disabled={busy} onClick={() => void exportMarkdown()}>
            导出 MD
          </Button>
          <Button variant="ghost" type="button" disabled={busy} onClick={() => void exportPng()}>
            导出图片
          </Button>
          <Button
            variant={deskCalendarRunning ? "destructive" : "default"}
            type="button"
            disabled={busy}
            onClick={() => void toggleDeskCalendar()}
          >
            {deskCalendarRunning ? "关闭桌面日历" : "打开桌面日历"}
          </Button>
        </div>
      </header>

      {error ? <div className="workspace-error-banner" role="alert">{error}</div> : null}
      {notice ? <div className="schedule-notice" role="status">{notice}</div> : null}
      {pendingDelete ? (
        <section className="schedule-delete-decision" role="dialog" aria-modal="true" aria-label="删除任务">
          <div><strong>删除“{pendingDelete.title}”</strong><p>{pendingDelete.type === "fixed" && pendingDelete.repeatType !== "norepeat" ? "请选择重复任务的删除范围。" : "这是已完成任务，请确认是否移入最近删除。"}</p></div>
          {pendingDelete.type === "fixed" && pendingDelete.repeatType !== "norepeat" ? <label className="schedule-check"><input type="checkbox" checked={deleteCompletedHistory} onChange={(event) => setDeleteCompletedHistory(event.target.checked)} />同时包含已完成历史</label> : null}
          <div className="settings-actions">
            <Button variant="ghost" type="button" onClick={() => setPendingDelete(null)}>取消</Button>
            <Button variant="ghost" type="button" onClick={() => void confirmTaskDelete("single")}>当前实例</Button>
            {pendingDelete.type === "fixed" && pendingDelete.repeatType !== "norepeat" ? <><Button variant="ghost" type="button" onClick={() => void confirmTaskDelete("future")}>当前及未来</Button><Button variant="ghost" className="text-destructive" type="button" onClick={() => void confirmTaskDelete("series")}>整个系列</Button></> : null}
          </div>
        </section>
      ) : null}
      {!schedule ? <div className="quiet-empty-state">日程服务尚未连接。</div> : null}

      <div className="schedule-layout">
        <section className="schedule-calendar-section" aria-label="日历">
          <header className="schedule-calendar-toolbar">
            <div className="calendar-view-switcher" role="group" aria-label="日历视图">
              {(["month", "week", "agenda", "day"] as const).map((mode) => (
                <button
                  className={viewMode === mode ? "is-active" : undefined}
                  type="button"
                  aria-pressed={viewMode === mode}
                  key={mode}
                  onClick={() => setViewMode(mode)}
                >
                  {mode === "month" ? "月历" : mode === "week" ? "周视图" : mode === "agenda" ? "日程" : "日视图"}
                </button>
              ))}
            </div>
            <div className="calendar-controls" aria-label="日历导航">
              <button className="icon-button" type="button" aria-label="上一个周期" onClick={() => movePeriod(-1)}><AppIcon name="chevron-left" size={18} /></button>
              <strong>{periodLabel}</strong>
              <button className="icon-button" type="button" aria-label="下一个周期" onClick={() => movePeriod(1)}><AppIcon name="chevron-right" size={18} /></button>
              <Button variant="ghost" type="button" onClick={() => setSelectedDate(new Date())}>今天</Button>
              <div className="schedule-mini-wrap">
                <button
                  className="icon-button"
                  type="button"
                  aria-label="迷你月历"
                  aria-expanded={miniOpen}
                  onClick={() => { setMiniOpen((value) => !value); setMiniMonth(selectedDate); }}
                >
                  <AppIcon name="calendar" size={18} />
                </button>
                {miniOpen ? (
                  <div className="schedule-mini-calendar" role="dialog" aria-label="迷你月历">
                    <header>
                      <button className="icon-button" type="button" aria-label="上个月" onClick={() => setMiniMonth((value) => addMonths(value, -1))}><AppIcon name="chevron-left" size={16} /></button>
                      <strong>{formatMonth(miniMonth)}</strong>
                      <button className="icon-button" type="button" aria-label="下个月" onClick={() => setMiniMonth((value) => addMonths(value, 1))}><AppIcon name="chevron-right" size={16} /></button>
                    </header>
                    <div className="schedule-mini-grid">
                      {weekdayLabels.map((label) => <span className="schedule-mini-weekday" key={label}>{label.slice(0, 1)}</span>)}
                      {buildMonthDays(miniMonth).map((day) => {
                        const key = dayKey(day);
                        const outside = monthKey(day) !== monthKey(miniMonth);
                        const today = key === dayKey(new Date());
                        const active = key === dayKey(selectedDate);
                        return (
                          <button
                            key={key}
                            type="button"
                            className={`schedule-mini-day${outside ? " is-outside" : ""}${today ? " is-today" : ""}${active ? " is-active" : ""}`}
                            onClick={() => { setSelectedDate(day); setSelectedEvent(null); setMiniOpen(false); }}
                          >
                            {getShanghaiDayNumber(day)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
              <label className="schedule-date-jump">
                <span className="sr-only">跳转到日期</span>
                <input
                  type="date"
                  value={toDateInput(selectedDate)}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (!value) return;
                    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
                    if (!match) return;
                    setSelectedDate(fromShanghaiParts(Number(match[1]), Number(match[2]), Number(match[3])));
                    setSelectedEvent(null);
                  }}
                />
              </label>
            </div>
          </header>
          <div className="schedule-display-row" aria-label="日历显示选项">
            <div className="schedule-display-group">
              <span className="schedule-group-label">按类型显示</span>
              <div className="schedule-kind-filters" role="group" aria-label="按类型筛选">
                {([
                  ["course", "课程"],
                  ["exam", "考试"],
                  ["deadline", "截止"],
                  ["task", "任务"],
                  ["assignment", "作业"]
                ] as const).map(([kind, label]) => {
                  const hidden = hiddenKinds.has(kind);
                  return (
                    <button
                      key={kind}
                      type="button"
                      className={`schedule-kind-filter schedule-kind-${kind}${hidden ? " is-hidden" : ""}`}
                      aria-pressed={!hidden}
                      onClick={() => setHiddenKinds((current) => {
                        const next = new Set(current);
                        if (next.has(kind)) next.delete(kind);
                        else next.add(kind);
                        return next;
                      })}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="schedule-display-group">
              <span className="schedule-group-label">时间粒度</span>
              <label className="schedule-step-control">
                <span className="sr-only">时间粒度</span>
                <select value={timeStepMinutes} onChange={(event) => setTimeStepMinutes(Number(event.target.value) as 15 | 30 | 60)}>
                  <option value={15}>15 分</option>
                  <option value={30}>30 分</option>
                  <option value={60}>60 分</option>
                </select>
              </label>
            </div>
            <div className="schedule-display-group">
              <span className="schedule-group-label">呈现方式</span>
              <div className="schedule-display-controls" role="group" aria-label="呈现方式">
                <button
                  className={eventStyle === "bar" ? "is-active" : undefined}
                  type="button"
                  aria-pressed={eventStyle === "bar"}
                  onClick={() => setEventStyle("bar")}
                >色条</button>
                <button
                  className={eventStyle === "dot" ? "is-active" : undefined}
                  type="button"
                  aria-pressed={eventStyle === "dot"}
                  onClick={() => setEventStyle("dot")}
                >圆点</button>
              </div>
            </div>
            <div className="schedule-display-group">
              <span className="schedule-group-label">密度</span>
              <div className="schedule-display-controls" role="group" aria-label="密度">
                <button
                  className={density === "comfortable" ? "is-active" : undefined}
                  type="button"
                  aria-pressed={density === "comfortable"}
                  onClick={() => setDensity("comfortable")}
                >舒适</button>
                <button
                  className={density === "compact" ? "is-active" : undefined}
                  type="button"
                  aria-pressed={density === "compact"}
                  onClick={() => setDensity("compact")}
                >紧凑</button>
              </div>
            </div>
          </div>

          {contextDay ? (
            <div className="schedule-context-menu" role="menu" aria-label="调休设置">
              <div className="schedule-context-title">{contextDay.slice(5, 7)}月{contextDay.slice(8, 10)}日 · 调休设置</div>
              <button type="button" role="menuitem" onClick={() => void setDayHoliday(contextDay, "节假日")}>设为节假日</button>
              {([1, 2, 3, 4, 5, 6, 7] as const).map((weekday) => (
                <button key={weekday} type="button" role="menuitem" onClick={() => void setDayMakeup(contextDay, weekday)}>设为补课（补{weekdayLabels[(weekday + 6) % 7]}的课）</button>
              ))}
              <button type="button" role="menuitem" onClick={() => void clearDay(contextDay)}>清除标记</button>
              <button type="button" role="menuitem" onClick={() => setContextDay(null)}>取消</button>
            </div>
          ) : null}

          {viewMode === "month" ? (
            <div className={`schedule-month-grid${eventStyle === "dot" ? " is-dot" : ""}${density === "compact" ? " is-compact" : ""}`}>
              {weekdayLabels.map((label) => <span className="schedule-weekday" key={label}>{label}</span>)}
              {monthDays.map((day) => {
                const dayKeyValue = dayKey(day);
                const items = eventsByDay.get(dayKeyValue) ?? [];
                const outside = monthKey(day) !== monthKey(selectedDate);
                return (
                  <section className={`schedule-month-cell${outside ? " is-outside" : ""}${dayKeyValue === dayKey(new Date()) ? " is-today" : ""}${statutoryHolidays.some((holiday) => holiday.date === dayKeyValue) ? " is-holiday" : ""}`} key={dayKeyValue} onDoubleClick={() => setForm(defaultTaskForm(day))} onContextMenu={(event) => { event.preventDefault(); setContextDay(dayKeyValue); }}>
                    <time dateTime={day.toISOString()}>{getShanghaiDayNumber(day)}</time>
                    {statutoryHolidays.find((holiday) => holiday.date === dayKeyValue) ? <span className="schedule-holiday-label">{statutoryHolidays.find((holiday) => holiday.date === dayKeyValue)!.label}</span> : null}
                    {makeupDays.find((makeup) => makeup.date === dayKeyValue) ? <span className="schedule-makeup-label">补{weekdayLabels[(makeupDays.find((makeup) => makeup.date === dayKeyValue)!.weekday + 6) % 7]}</span> : null}
                    <div className="schedule-event-list">
                      {eventStyle === "bar"
                        ? items.slice(0, 5).map((event) => <button className={eventClassName(event)} type="button" key={event.id} onClick={(click) => { click.stopPropagation(); selectEvent(event); }}>{event.title}</button>)
                        : items.slice(0, 8).map((event) => <span className={`schedule-dot schedule-dot-${event.kind}`} key={event.id} role="img" aria-label={event.title} title={event.title} onClick={(click) => { click.stopPropagation(); selectEvent(event); }} />)}
                      {items.length > (eventStyle === "bar" ? 5 : 8) ? <button className="schedule-more-button" type="button" onClick={(click) => { click.stopPropagation(); setMoreDay(dayKeyValue); }}>+{items.length - (eventStyle === "bar" ? 5 : 8)} 项</button> : null}
                    </div>
                  </section>
                );
              })}
            </div>
          ) : null}

          {viewMode === "week" ? (
            <div className="schedule-week-grid">
              {weekDays.map((day) => (
                <section className={`schedule-week-column${dayKey(day) === dayKey(new Date()) ? " is-today" : ""}`} key={dayKey(day)} onClick={(click) => {
                  const rect = (click.currentTarget as HTMLElement).getBoundingClientRect();
                  const hourRatio = (click.clientY - rect.top) / Math.max(1, rect.height);
                  const hour = Math.max(0, Math.min(23, Math.floor(hourRatio * 24)));
                  const parts = getShanghaiDateParts(day);
                  const start = fromShanghaiParts(Number(parts.year), Number(parts.month), Number(parts.day), hour, 0);
                  const end = new Date(start.getTime() + 60 * 60 * 1000);
                  setForm({ ...defaultTaskForm(day), startAt: toDateTimeInput(start), endAt: toDateTimeInput(end) });
                }}>
                  <header><span>{weekdayLabels[(getShanghaiWeekday(day) + 6) % 7]}</span><strong>{getShanghaiDayNumber(day)}</strong></header>
                  <div className="schedule-event-list">{(eventsByDay.get(dayKey(day)) ?? []).map((event) => <button className={eventClassName(event)} type="button" key={event.id} onClick={(click) => { click.stopPropagation(); selectEvent(event); }}><strong>{event.title}</strong><small>{formatEventMeta(event)}</small></button>)}</div>
                </section>
              ))}
            </div>
          ) : null}

          {viewMode === "agenda" ? (
            <div className="schedule-agenda-list">
              {Array.from(eventsByDay.entries()).filter(([key]) => monthKey(key) === monthKey(selectedDate)).map(([key, items]) => (
                <section className="schedule-agenda-day" key={key}>
                  <header><strong>{Number(key.slice(8, 10))}</strong><span>{weekdayLabels[(getShanghaiWeekday(dateFromDayKey(key)) + 6) % 7]}</span></header>
                  <div className="schedule-event-list">{items.map((event) => <button className={eventClassName(event)} type="button" key={event.id} onClick={() => selectEvent(event)}><strong>{event.title}</strong><small>{formatEventMeta(event)}{event.location ? ` · ${event.location}` : ""}</small></button>)}</div>
                </section>
              ))}
              {eventsByDay.size === 0 ? <div className="quiet-empty-state">本月没有安排</div> : null}
            </div>
          ) : null}

          {viewMode === "day" ? (
            <div className="schedule-day-timeline" style={{ "--schedule-step-min": String(timeStepMinutes) } as React.CSSProperties}>
              {(() => {
                const now = new Date();
                const nowParts = getShanghaiDateParts(now);
                const isToday = dayKey(now) === dayKey(selectedDate);
                const minutesIntoDay = Number(nowParts.hour) * 60 + Number(nowParts.minute);
                return isToday ? <div className="schedule-now-line" style={{ top: `${(minutesIntoDay / 24 / 60) * 100}%` }} aria-hidden="true" /> : null;
              })()}
              {(() => {
                const slotsPerHour = 60 / timeStepMinutes;
                const slotMinutes = Array.from({ length: 24 * slotsPerHour }, (_, index) => Math.floor(index / slotsPerHour) * 60 + (index % slotsPerHour) * timeStepMinutes);
                return slotMinutes.map((minutesIntoDay) => {
                  const hour = Math.floor(minutesIntoDay / 60);
                  const minute = minutesIntoDay % 60;
                  const slotStart = fromShanghaiParts(
                    Number(getShanghaiDateParts(selectedDate).year),
                    Number(getShanghaiDateParts(selectedDate).month),
                    Number(getShanghaiDateParts(selectedDate).day),
                    hour,
                    minute
                  );
                  const slotEnd = new Date(slotStart.getTime() + timeStepMinutes * 60 * 1000);
                  // 事件显示在「与其时间范围重叠」的每个槽位上：开始时间不必是
                  // 粒度的倍数（真实教务时间如 8:55/13:25 也能显示），跨多节的课
                  // 在后续槽位继续可见，避免「有课却看不到」。
                  const dayItems = eventsByDay.get(dayKey(selectedDate)) ?? [];
                  const items = dayItems.filter((event) => {
                    const eventStart = Date.parse(event.startAt);
                    const eventEnd = Date.parse(event.endAt);
                    if (!Number.isFinite(eventStart) || !Number.isFinite(eventEnd) || eventEnd <= eventStart) return false;
                    return slotStart.getTime() < eventEnd && slotEnd.getTime() > eventStart;
                  });
                  // 同一事件在「非开始槽」只渲染紧凑延续条，避免完整卡片重复堆叠。
                  const isSlotWithinEvent = (event: ScheduleEvent): boolean => {
                    const eventStart = Date.parse(event.startAt);
                    return slotStart.getTime() > eventStart;
                  };
                  const formForSlot = (): TaskFormState => {
                    const parts = getShanghaiDateParts(selectedDate);
                    const start = fromShanghaiParts(Number(parts.year), Number(parts.month), Number(parts.day), hour, minute);
                    const end = new Date(start.getTime() + timeStepMinutes * 60 * 1000);
                    return { ...defaultTaskForm(selectedDate), startAt: toDateTimeInput(start), endAt: toDateTimeInput(end) };
                  };
                  return <section className="schedule-hour" key={minutesIntoDay} onClick={() => setForm(formForSlot())}><time>{pad(hour)}:{pad(minute)}</time><div className="schedule-hour-events">{items.map((event) => {
                    const isDragging = dragEvent?.id === event.id;
                    const isConflict = conflictEvents.has(event.id);
                    const editable = isTaskEditable(event);
                    const isContinuation = isSlotWithinEvent(event);
                    return <button
                      className={`${eventClassName(event)}${isDragging ? " is-dragging" : ""}${isConflict ? " is-conflict" : ""}${isContinuation ? " is-continuation" : ""}`}
                      type="button"
                      key={event.id}
                      aria-label={isContinuation ? `${event.title}（延续）` : event.title}
                      onClick={(click) => { click.stopPropagation(); selectEvent(event); }}
                      onPointerDown={editable ? beginDayDrag(event, "move") : undefined}
                      onPointerMove={editable ? moveDayDrag : undefined}
                      onPointerUp={editable ? () => void endDayDrag() : undefined}
                      onPointerCancel={editable ? () => void endDayDrag() : undefined}
                    >{isContinuation ? null : <strong>{event.title}</strong>}<small>{isContinuation ? "" : formatEventMeta(event)}</small>{editable ? <span className="schedule-resize-handle" onPointerDown={beginDayDrag(event, "resize-end")} aria-hidden="true" /> : null}</button>;
                  })}</div></section>;
                });
              })()}
            </div>
          ) : null}
        </section>
      </div>

      {selectedEvent ? (
        <Dialog open onOpenChange={(open) => { if (!open) setSelectedEvent(null); }}>
          <DialogContent aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle>{selectedEvent.title}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm leading-6 text-muted-foreground">{formatEventMeta(selectedEvent)}</p>
              {selectedEvent.location || selectedEvent.note ? <p className="text-sm leading-6">{selectedEvent.location || selectedEvent.note}</p> : null}
              {selectedTask && selectedTask.type !== "fixedlegacy" && selectedTask.status !== "deleted" ? (
                <div className="settings-actions">
                  <Button variant="outline" type="button" disabled={busy} onClick={() => setForm(taskToForm(selectedTask))}>编辑</Button>
                  {selectedTask.type === "deadline" && selectedTask.status !== "completed" ? <Button variant="outline" type="button" disabled={busy} onClick={() => void mutate(selectedTask, "completed")}>完成</Button> : null}
                  <Button variant="ghost" className="text-destructive" type="button" disabled={busy} onClick={() => void deleteTask(selectedTask)}>删除</Button>
                </div>
              ) : <p className="text-xs leading-5 text-muted-foreground">课程、考试和上游作业为只读；需要修改自建任务时请在 CampusOS 主窗口操作。</p>}
            </div>
          </DialogContent>
        </Dialog>
      ) : null}

      {moreDay ? (
        <Dialog open onOpenChange={(open) => { if (!open) setMoreDay(null); }}>
          <DialogContent aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle>{moreDay ? `${Number(moreDay.slice(5, 7))}月${Number(moreDay.slice(8, 10))}日 ${weekdayLabels[(getShanghaiWeekday(dateFromDayKey(moreDay)) + 6) % 7]} · 全部安排` : "当天安排"}</DialogTitle>
            </DialogHeader>
            <div className="schedule-more-day-list">
              {(eventsByDay.get(moreDay) ?? []).map((event) => (
                <button className={eventClassName(event)} type="button" key={event.id} onClick={() => { setMoreDay(null); selectEvent(event); }}>
                  <strong>{event.title}</strong>
                  <small>{formatEventMeta(event)}{event.location ? ` · ${event.location}` : ""}</small>
                </button>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      ) : null}

      {form ? (
        <Dialog open onOpenChange={(open) => { if (!open) setForm(null); }}>
          <DialogContent aria-describedby={undefined} className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>{form.id ? "编辑任务" : "新建任务"}</DialogTitle>
            </DialogHeader>
            <form className="schedule-task-form" onSubmit={(event) => void saveForm(event)}>
              <label>标题<input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
              <label>说明<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
              <div className="schedule-form-grid"><label>开始<input type="datetime-local" required value={form.startAt} onChange={(event) => setForm({ ...form, startAt: event.target.value })} /></label><label>结束<input type="datetime-local" required value={form.endAt} onChange={(event) => setForm({ ...form, endAt: event.target.value })} /></label></div>
              <div className="schedule-form-grid"><label>所需分钟<input type="number" min="1" value={form.timeNeededMinutes} onChange={(event) => setForm({ ...form, timeNeededMinutes: Number(event.target.value) })} /></label><label>已用分钟<input type="number" min="0" value={form.timeSpentMinutes} onChange={(event) => setForm({ ...form, timeSpentMinutes: Number(event.target.value) })} /></label></div>
              <label>地点<input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} /></label>
              <label>类型<select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as TaskFormState["type"] })}><option value="deadline">DDL</option><option value="fixed">日程</option></select></label>
              <label>单项提醒<select value={form.reminderMode === "lead" ? `lead:${form.reminderLeadMinutes}` : form.reminderMode} onChange={(event) => { const value = event.target.value; if (value.startsWith("lead:")) setForm({ ...form, reminderMode: "lead", reminderLeadMinutes: Number(value.slice(5)) }); else setForm({ ...form, reminderMode: value as TaskFormState["reminderMode"] }); }}><option value="global">使用全局提前量</option><option value="none">不提醒</option><option value="at-time">开始/截止时</option><option value="lead:5">提前 5 分钟</option><option value="lead:15">提前 15 分钟</option><option value="lead:30">提前 30 分钟</option><option value="lead:60">提前 1 小时</option><option value="lead:1440">提前 1 天</option><option value="custom">自定义时间</option></select></label>
              {form.reminderMode === "custom" ? <label>提醒时间<input type="datetime-local" required value={form.reminderAt} onChange={(event) => setForm({ ...form, reminderAt: event.target.value })} /></label> : null}
              {form.type === "fixed" ? <>
                <label>重复<select value={form.repeatType} onChange={(event) => setForm({ ...form, repeatType: event.target.value as TaskFormState["repeatType"] })}><option value="norepeat">不重复</option><option value="days">每隔几天</option><option value="weeks">每隔几周</option><option value="weekdays">每周工作日</option><option value="month">每月</option><option value="year">每年</option></select></label>
                {form.repeatType === "days" || form.repeatType === "weeks" ? <label>周期<input type="number" min="1" value={form.repeatPeriod} onChange={(event) => setForm({ ...form, repeatPeriod: Number(event.target.value) })} /></label> : null}
                {form.repeatType !== "norepeat" ? <label>重复结束<input type="date" required value={form.repeatEndsOn} onChange={(event) => setForm({ ...form, repeatEndsOn: event.target.value })} /></label> : null}
              </> : null}
              <div className="settings-actions"><Button type="submit" disabled={busy}>{busy ? "保存中" : "保存任务"}</Button></div>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </section>
  );
};
