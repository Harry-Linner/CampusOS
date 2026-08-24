import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  LocalTaskInput,
  LocalTaskPeriod,
  LocalTaskRecord,
  PluginComponentProps
} from "@campusos/shared";
import type { DeskCalendarView } from "@campusos/shared";
import { AppIcon } from "./AppIcon";
import { formatDateTime, formatTimeRange } from "./formatters";
import { ScheduleNoticeBoard } from "./ScheduleNoticeBoard";
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
  type: "deadline" | "fixed" | "floating";
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

const getShanghaiHour = (value: string): number => Number(getShanghaiDateParts(new Date(value)).hour);

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
  assistant,
  campusFeed,
  deskCalendar,
  navigationTarget
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
  const [deskCalendarOpen, setDeskCalendarOpen] = useState(false);
  const [deskCalendarEnabled, setDeskCalendarEnabledState] = useState(false);
  const [deskCalendarView, setDeskCalendarViewState] = useState<DeskCalendarView>("month");
  const [deskCalendarBusy, setDeskCalendarBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<LocalTaskRecord | null>(null);
  const [deleteCompletedHistory, setDeleteCompletedHistory] = useState(false);
  const selectedTask = useMemo(
    () => selectedEvent?.taskId ? tasks.find((task) => task.id === selectedEvent.taskId) ?? null : null,
    [selectedEvent, tasks]
  );

  const loadDeskCalendarState = useCallback(async (): Promise<void> => {
    if (!deskCalendar) return;
    try {
      const record = await deskCalendar.loadSettings();
      setDeskCalendarEnabledState(record.enabled);
      setDeskCalendarViewState(record.view);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取桌面日历设置。");
    }
  }, [deskCalendar]);

  useEffect(() => {
    void loadDeskCalendarState();
    if (!deskCalendar) return undefined;
    return deskCalendar.subscribe(() => {
      void loadDeskCalendarState();
    });
  }, [deskCalendar, loadDeskCalendarState]);

  const toggleDeskCalendar = async (enabled: boolean): Promise<void> => {
    if (!deskCalendar) return;
    setDeskCalendarBusy(true);
    setError(null);
    try {
      const record = await deskCalendar.setEnabled(enabled);
      setDeskCalendarEnabledState(record.enabled);
      setDeskCalendarViewState(record.view);
      setNotice(enabled ? "桌面日历已开启" : "桌面日历已关闭");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "桌面日历设置保存失败。");
    } finally {
      setDeskCalendarBusy(false);
    }
  };

  const changeDeskCalendarView = async (view: DeskCalendarView): Promise<void> => {
    if (!deskCalendar) return;
    setDeskCalendarBusy(true);
    setError(null);
    try {
      const record = await deskCalendar.setView(view);
      setDeskCalendarViewState(record.view);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "桌面日历视图切换失败。");
    } finally {
      setDeskCalendarBusy(false);
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

  const events = useMemo(() => buildEvents(snapshot, periods), [periods, snapshot]);
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

  const selectEvent = (event: ScheduleEvent): void => {
    setSelectedEvent(event);
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
        blocksPlanning: form.type === "floating" ? false : form.blocksPlanning,
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
          {deskCalendar ? (
            <div className="desk-calendar-control">
              <button
                className={`text-button${deskCalendarEnabled ? " is-active" : ""}`}
                type="button"
                disabled={deskCalendarBusy}
                aria-expanded={deskCalendarOpen}
                onClick={() => setDeskCalendarOpen((open) => !open)}
              >
                桌面日历{deskCalendarEnabled ? "：开" : ""}
              </button>
              {deskCalendarOpen ? (
                <div className="desk-calendar-menu" role="menu" aria-label="桌面日历设置">
                  <button
                    className="desk-calendar-menu-item"
                    type="button"
                    disabled={deskCalendarBusy}
                    onClick={() => void toggleDeskCalendar(!deskCalendarEnabled)}
                  >
                    {deskCalendarEnabled ? "关闭桌面日历" : "开启桌面日历"}
                  </button>
                  <div className="desk-calendar-menu-label">悬浮窗视图</div>
                  <div className="desk-calendar-view-options" role="group" aria-label="桌面日历视图">
                    {(["month", "week", "day"] as const).map((view) => (
                      <button
                        className={deskCalendarView === view ? "is-active" : undefined}
                        type="button"
                        aria-pressed={deskCalendarView === view}
                        key={view}
                        disabled={deskCalendarBusy || !deskCalendarEnabled}
                        onClick={() => void changeDeskCalendarView(view)}
                      >
                        {view === "month" ? "月视图" : view === "week" ? "周视图" : "日视图"}
                      </button>
                    ))}
                  </div>
                  {deskCalendarEnabled ? (
                    <p className="desk-calendar-menu-hint">悬浮日历已显示在桌面上，可在悬浮窗内拖动与调整。</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
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
            </div>
          </header>

          {viewMode === "month" ? (
            <div className="schedule-month-grid">
              {weekdayLabels.map((label) => <span className="schedule-weekday" key={label}>{label}</span>)}
              {monthDays.map((day) => {
                const items = eventsByDay.get(dayKey(day)) ?? [];
                const outside = monthKey(day) !== monthKey(selectedDate);
                return (
                  <section className={`schedule-month-cell${outside ? " is-outside" : ""}${dayKey(day) === dayKey(new Date()) ? " is-today" : ""}`} key={dayKey(day)} onClick={() => setForm(defaultTaskForm(day))}>
                    <time dateTime={day.toISOString()}>{getShanghaiDayNumber(day)}</time>
                    <div className="schedule-event-list">
                      {items.slice(0, 5).map((event) => <button className={eventClassName(event)} type="button" key={event.id} onClick={(click) => { click.stopPropagation(); selectEvent(event); }}>{event.title}</button>)}
                      {items.length > 5 ? <small>+{items.length - 5} 项</small> : null}
                    </div>
                  </section>
                );
              })}
            </div>
          ) : null}

          {viewMode === "week" ? (
            <div className="schedule-week-grid">
              {weekDays.map((day) => (
                <section className={`schedule-week-column${dayKey(day) === dayKey(new Date()) ? " is-today" : ""}`} key={dayKey(day)} onClick={() => setForm(defaultTaskForm(day))}>
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
            <div className="schedule-day-timeline">
              {Array.from({ length: 24 }, (_, hour) => {
                const items = (eventsByDay.get(dayKey(selectedDate)) ?? []).filter((event) => getShanghaiHour(event.startAt) === hour);
                const formForHour = (): TaskFormState => {
                  const parts = getShanghaiDateParts(selectedDate);
                  const start = fromShanghaiParts(Number(parts.year), Number(parts.month), Number(parts.day), hour, 0);
                  const end = new Date(start.getTime() + 60 * 60 * 1000);
                  return { ...defaultTaskForm(selectedDate), startAt: toDateTimeInput(start), endAt: toDateTimeInput(end) };
                };
                return <section className="schedule-hour" key={hour} onClick={() => setForm(formForHour())}><time>{pad(hour)}:00</time><div className="schedule-hour-events">{items.map((event) => <button className={eventClassName(event)} type="button" key={event.id} onClick={(click) => { click.stopPropagation(); selectEvent(event); }}><strong>{event.title}</strong><small>{formatEventMeta(event)}</small></button>)}</div></section>;
              })}
            </div>
          ) : null}
        </section>
        <aside className="schedule-sidebar">
          <ScheduleNoticeBoard
            campusFeed={campusFeed}
            assistant={assistant}
            schedule={schedule}
          />
        </aside>
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

      {form ? (
        <Dialog open onOpenChange={(open) => { if (!open) setForm(null); }}>
          <DialogContent aria-describedby={undefined} className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>{form.id ? "编辑任务" : "新建任务"}</DialogTitle>
            </DialogHeader>
            <form className="schedule-task-form" onSubmit={(event) => void saveForm(event)}>
              <label>标题<input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
              <label>说明<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
              {form.type !== "floating" ? <div className="schedule-form-grid"><label>开始<input type="datetime-local" required value={form.startAt} onChange={(event) => setForm({ ...form, startAt: event.target.value })} /></label><label>结束<input type="datetime-local" required value={form.endAt} onChange={(event) => setForm({ ...form, endAt: event.target.value })} /></label></div> : <p className="schedule-form-hint">无日期待办不会出现在日历中；可单独设置提醒时间。</p>}
              <div className="schedule-form-grid"><label>所需分钟<input type="number" min="1" value={form.timeNeededMinutes} onChange={(event) => setForm({ ...form, timeNeededMinutes: Number(event.target.value) })} /></label><label>已用分钟<input type="number" min="0" value={form.timeSpentMinutes} onChange={(event) => setForm({ ...form, timeSpentMinutes: Number(event.target.value) })} /></label></div>
              <label>地点<input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} /></label>
              <label>类型<select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as TaskFormState["type"] })}><option value="deadline">DDL</option><option value="fixed">日程</option><option value="floating">无日期待办</option></select></label>
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
