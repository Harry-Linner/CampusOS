import { useEffect, useMemo, useState } from "react";
import type {
  CalendarEventRecord,
  CampusWorkspaceSnapshot,
  DeskCalendarSnapshotMessage,
  DeskCalendarView,
  LocalTaskInput,
  LocalTaskRecord
} from "@campusos/shared";
import "./desk-calendar.css";

const SHANGHAI_TIME_ZONE = "Asia/Shanghai";
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

const pad = (value: number): string => String(value).padStart(2, "0");

const getShanghaiParts = (value: Date): Record<string, string> => {
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

const toDayKey = (value: Date): string => {
  const parts = getShanghaiParts(value);
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const startOfDay = (value: Date): Date => {
  const parts = getShanghaiParts(value);
  return fromShanghaiParts(Number(parts.year), Number(parts.month), Number(parts.day));
};

const addDays = (value: Date, days: number): Date =>
  new Date(value.getTime() + days * 24 * 60 * 60 * 1000);

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

const weekdayLabels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

const buildMonthDays = (month: Date): Date[] => {
  const parts = getShanghaiParts(month);
  const first = startOfWeek(fromShanghaiParts(Number(parts.year), Number(parts.month), 1));
  return Array.from({ length: 42 }, (_, index) => addDays(first, index));
};

const isSameDayKey = (left: string, right: string): boolean => left === right;

const toDateTimeInput = (value: Date): string => {
  const parts = getShanghaiParts(value);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
};

const fromDateTimeInput = (value: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("时间格式无效。");
  return fromShanghaiParts(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5])
  ).toISOString();
};

const createDeskTaskForm = (date: Date, task?: LocalTaskRecord): DeskTaskForm => {
  if (task) {
    return {
      id: task.id,
      title: task.title,
      description: task.description,
      startAt: toDateTimeInput(new Date(task.startAt)),
      endAt: toDateTimeInput(new Date(task.endAt)),
      location: task.location,
      type: task.type === "fixed" ? "fixed" : "deadline"
    };
  }
  const start = fromShanghaiParts(
    Number(getShanghaiParts(date).year),
    Number(getShanghaiParts(date).month),
    Number(getShanghaiParts(date).day),
    9
  );
  return {
    title: "",
    description: "",
    startAt: toDateTimeInput(start),
    endAt: toDateTimeInput(new Date(start.getTime() + 60 * 60 * 1000)),
    location: "",
    type: "fixed"
  };
};

interface DeskCalendarEvent {
  id: string;
  title: string;
  kind: CalendarEventRecord["kind"];
  startAt: string;
  endAt: string;
  location: string | null;
  taskId?: string;
  task?: LocalTaskRecord;
}

interface DeskTaskForm {
  id?: string;
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  location: string;
  type: "deadline" | "fixed";
}

export const buildDeskCalendarEvents = (
  snapshot: CampusWorkspaceSnapshot,
  localTaskPeriods: import("@campusos/shared").LocalTaskPeriod[] = [],
  localTasks: LocalTaskRecord[] = []
): DeskCalendarEvent[] => {
  const canonicalEventIds = new Set(snapshot.calendarEvents?.map((event) => event.id) ?? []);
  const tasksById = new Map(localTasks.map((task) => [task.id, task]));
  return [
    ...(snapshot.calendarEvents ?? []).map((event) => ({
      id: `calendar:${event.id}`,
      title: event.title,
      kind: event.kind,
      startAt: event.startAt,
      endAt: event.endAt ?? new Date(Date.parse(event.startAt) + 60 * 60 * 1000).toISOString(),
      location: event.location
    })),
    ...localTaskPeriods.map((task) => ({
      id: `task:${task.id}`,
      title: task.title,
      kind: "task" as const,
      startAt: task.startAt,
      endAt: task.endAt,
      location: task.location || null,
      taskId: task.taskId,
      task: tasksById.get(task.taskId)
    })),
    ...snapshot.courses
      .filter((course) => !canonicalEventIds.has(course.id))
      .map((course) => ({
        id: `course:${course.id}`,
        title: course.title,
        kind: "course" as const,
        startAt: course.startAt,
        endAt: course.endAt,
        location: course.location
      })),
    ...snapshot.deadlines
      .filter((deadline) => !canonicalEventIds.has(deadline.id))
      .map((deadline) => ({
        id: `deadline:${deadline.id}`,
        title: deadline.title,
        kind: "assignment" as const,
        startAt: new Date(new Date(deadline.dueAt).getTime() - 60 * 60 * 1000).toISOString(),
        endAt: deadline.dueAt,
        location: deadline.note ?? null
      }))
  ].sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt));
};

const eventKindLabel: Record<DeskCalendarEvent["kind"], string> = {
  course: "课程",
  exam: "考试",
  assignment: "作业",
  task: "任务"
};

const formatEventTime = (event: DeskCalendarEvent): string => {
  const startParts = getShanghaiParts(new Date(event.startAt));
  const endParts = getShanghaiParts(new Date(event.endAt));
  const start = `${pad(Number(startParts.hour))}:${pad(Number(startParts.minute))}`;
  const end = `${pad(Number(endParts.hour))}:${pad(Number(endParts.minute))}`;
  return `${start}–${end}`;
};

export interface DeskCalendarWindowApi {
  loadSettings: () => Promise<{ showClock: boolean }>;
  loadSnapshot: () => Promise<DeskCalendarSnapshotMessage>;
  setView: (view: DeskCalendarView) => Promise<unknown>;
  setShowClock: (showClock: boolean) => Promise<unknown>;
  close: () => Promise<unknown>;
  openMain: (entityId: string) => Promise<unknown>;
  completeTask: (taskId: string) => Promise<unknown>;
  saveTask: (input: LocalTaskInput) => Promise<unknown>;
  subscribe: (listener: (message: DeskCalendarSnapshotMessage) => void) => () => void;
}

export const DeskCalendarApp = ({ api }: { api: DeskCalendarWindowApi }): JSX.Element => {
  const [view, setView] = useState<DeskCalendarView>("month");
  const [snapshot, setSnapshot] = useState<CampusWorkspaceSnapshot | null>(null);
  const [latestMessage, setLatestMessage] = useState<DeskCalendarSnapshotMessage | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [selectedEvent, setSelectedEvent] = useState<DeskCalendarEvent | null>(null);
  const [showClock, setShowClock] = useState(true);
  const [now, setNow] = useState(() => new Date());
  const [error, setError] = useState<string | null>(null);
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);
  const [taskForm, setTaskForm] = useState<DeskTaskForm | null>(null);
  const [savingTask, setSavingTask] = useState(false);

  useEffect(() => {
    let active = true;
    const apply = (message: DeskCalendarSnapshotMessage): void => {
      if (!active) return;
      setView(message.view);
      setSnapshot(message.snapshot);
      setLatestMessage(message);
    };
    void Promise.all([api.loadSnapshot(), api.loadSettings()]).then(([message, settings]) => {
      apply(message);
      setShowClock(settings.showClock);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "无法读取桌面日历数据。");
    });
    const unsubscribe = api.subscribe(apply);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [api]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const toggleClock = async (): Promise<void> => {
    const next = !showClock;
    try {
      await api.setShowClock(next);
      setShowClock(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法保存时钟设置。");
    }
  };

  const events = useMemo(() => (
    snapshot ? buildDeskCalendarEvents(snapshot, latestMessage?.localTaskPeriods, latestMessage?.localTasks) : []
  ), [snapshot, latestMessage]);
  const eventsByDay = useMemo(() => {
    const result = new Map<string, DeskCalendarEvent[]>();
    for (const event of events) {
      const start = Date.parse(event.startAt);
      const end = Date.parse(event.endAt);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      if (end <= start) continue;
      const rangeStart = startOfDay(new Date(start)).getTime();
      const rangeEnd = startOfDay(new Date(end - 1)).getTime();
      for (let cursor = rangeStart; cursor <= rangeEnd; cursor += 24 * 60 * 60 * 1000) {
        const key = toDayKey(new Date(cursor));
        result.set(key, [...(result.get(key) ?? []), event]);
      }
    }
    for (const items of result.values()) {
      items.sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt));
    }
    return result;
  }, [events]);

  const todayKey = toDayKey(new Date());
  const monthDays = useMemo(() => buildMonthDays(selectedDate), [selectedDate]);
  const weekDays = useMemo(() => {
    const first = startOfWeek(selectedDate);
    return Array.from({ length: 7 }, (_, index) => addDays(first, index));
  }, [selectedDate]);

  const monthLabel = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    timeZone: SHANGHAI_TIME_ZONE
  }).format(selectedDate);

  const weekLabel = ((): string => {
    const first = startOfWeek(selectedDate);
    const last = addDays(first, 6);
    const firstParts = getShanghaiParts(first);
    const lastParts = getShanghaiParts(last);
    return `${Number(firstParts.month)}月${Number(firstParts.day)}日 - ${Number(lastParts.month)}月${Number(lastParts.day)}日`;
  })();

  const dayLabel = ((): string => {
    const parts = getShanghaiParts(selectedDate);
    return `${Number(parts.month)}月${Number(parts.day)}日 ${weekdayLabels[(getShanghaiWeekday(selectedDate) + 6) % 7]}`;
  })();

  const periodLabel = view === "month" ? monthLabel : view === "week" ? weekLabel : dayLabel;

  const switchView = async (next: DeskCalendarView): Promise<void> => {
    const previous = view;
    setView(next);
    setError(null);
    try {
      await api.setView(next);
    } catch (cause) {
      setView(previous);
      setError(cause instanceof Error ? cause.message : "日历视图保存失败。");
    }
  };

  const openDay = (day: Date): void => {
    setSelectedDate(day);
    void switchView("day");
  };

  const saveTask = async (): Promise<void> => {
    if (!taskForm) return;
    setSavingTask(true);
    setError(null);
    try {
      const startAt = fromDateTimeInput(taskForm.startAt);
      const endAt = fromDateTimeInput(taskForm.endAt);
      const end = new Date(endAt);
      const input: LocalTaskInput = {
        ...(taskForm.id ? { id: taskForm.id } : {}),
        title: taskForm.title.trim(),
        description: taskForm.description.trim(),
        startAt,
        endAt,
        location: taskForm.location.trim(),
        timeSpentMinutes: 0,
        timeNeededMinutes: Math.max(1, Math.round((end.getTime() - Date.parse(startAt)) / 60_000)),
        breakable: true,
        type: taskForm.type,
        repeatType: "norepeat",
        repeatPeriod: 1,
        repeatEndsOn: taskForm.endAt.slice(0, 10),
        blocksPlanning: true,
        reminderMode: "global",
        reminderLeadMinutes: null,
        reminderAt: null
      };
      await api.saveTask(input);
      setTaskForm(null);
      setSelectedEvent(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "任务保存失败。");
    } finally {
      setSavingTask(false);
    }
  };

  const movePeriod = (delta: number): void => {
    setSelectedDate((current) => {
      if (view === "day") return addDays(current, delta);
      if (view === "week") return addDays(current, delta * 7);
      const parts = getShanghaiParts(current);
      return fromShanghaiParts(Number(parts.year), Number(parts.month) + delta, 1);
    });
  };

  const renderEventChip = (event: DeskCalendarEvent): JSX.Element => (
    <button className={`desk-cal-event desk-cal-event-${event.kind}`} key={event.id} title={event.location ?? undefined} type="button" onClick={() => setSelectedEvent(event)}>
      {event.kind !== "course" && event.kind !== "task" ? (
        <em>{eventKindLabel[event.kind]}</em>
      ) : null}
      <strong>{event.title}</strong>
    </button>
  );

  const renderDayCell = (day: Date): JSX.Element => {
    const key = toDayKey(day);
    const dayEvents = eventsByDay.get(key) ?? [];
    const outside = view === "month" && !isSameDayKey(key.slice(0, 7), toDayKey(selectedDate).slice(0, 7));
    const isToday = isSameDayKey(key, todayKey);
    return (
      <section className={`desk-cal-cell${outside ? " is-outside" : ""}${isToday ? " is-today" : ""}`} key={key}>
        <button className="desk-cal-day-button" type="button" aria-label={`查看 ${key}`} onClick={() => openDay(day)}>
          <time dateTime={key}>{Number(key.slice(8, 10))}</time>
        </button>
        <div className="desk-cal-cell-events">
          {dayEvents.slice(0, 3).map(renderEventChip)}
          {dayEvents.length > 3 ? <small className="desk-cal-more">+{dayEvents.length - 3} 项</small> : null}
        </div>
      </section>
    );
  };

  return (
    <div className="desk-cal-shell" role="dialog" aria-label="桌面日历">
      <header className="desk-cal-toolbar">
        <div className="desk-cal-view-switcher" role="group" aria-label="日历视图">
          {(["month", "week", "day"] as const).map((mode) => (
            <button
              className={view === mode ? "is-active" : undefined}
              type="button"
              aria-pressed={view === mode}
              key={mode}
              onClick={() => void switchView(mode)}
            >
              {mode === "month" ? "月" : mode === "week" ? "周" : "日"}
            </button>
          ))}
        </div>
        <div className="desk-cal-controls" aria-label="日历导航">
          <button className="desk-cal-icon" type="button" aria-label="上一个周期" onClick={() => movePeriod(-1)}>‹</button>
          <strong>{periodLabel}</strong>
          <button className="desk-cal-icon" type="button" aria-label="下一个周期" onClick={() => movePeriod(1)}>›</button>
          <button className="desk-cal-today" type="button" onClick={() => setSelectedDate(new Date())}>今天</button>
          <button className="desk-cal-task-add" type="button" onClick={() => setTaskForm(createDeskTaskForm(selectedDate))}>新建任务</button>
          <button className="desk-cal-clock-toggle" type="button" aria-pressed={showClock} onClick={() => void toggleClock()}>时钟</button>
        </div>
        <button className="desk-cal-close" type="button" aria-label="关闭桌面日历" onClick={() => void api.close()}>
          ×
        </button>
      </header>
      {showClock ? <time className="desk-cal-clock" dateTime={now.toISOString()}>{new Intl.DateTimeFormat("zh-CN", { timeZone: SHANGHAI_TIME_ZONE, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(now)}</time> : null}

      {error ? <p className="desk-cal-error" role="alert">{error}</p> : null}
      {!snapshot && !error ? <p className="desk-cal-empty">暂无日历数据，请先在工作台完成同步。</p> : null}

      {view === "month" ? (
        <div className="desk-cal-month-grid">
          {weekdayLabels.map((label) => <span className="desk-cal-weekday" key={label}>{label}</span>)}
          {monthDays.map(renderDayCell)}
        </div>
      ) : null}

      {view === "week" ? (
        <div className="desk-cal-week-grid">
          {weekDays.map((day) => {
            const key = toDayKey(day);
            const dayEvents = eventsByDay.get(key) ?? [];
            const isToday = isSameDayKey(key, todayKey);
            return (
              <section className={`desk-cal-week-col${isToday ? " is-today" : ""}`} key={key}>
                <header>
                  <span>{weekdayLabels[(getShanghaiWeekday(day) + 6) % 7]}</span>
                  <strong>{Number(key.slice(8, 10))}</strong>
                </header>
                <div className="desk-cal-cell-events">
                  {dayEvents.slice(0, 6).map(renderEventChip)}
                  {dayEvents.length > 6 ? <small className="desk-cal-more">+{dayEvents.length - 6} 项</small> : null}
                </div>
              </section>
            );
          })}
        </div>
      ) : null}

      {view === "day" ? (
        <div className="desk-cal-day-list">
          {(eventsByDay.get(toDayKey(selectedDate)) ?? []).map((event) => (
            <button className={`desk-cal-day-row desk-cal-event-${event.kind}`} key={event.id} type="button" onClick={() => setSelectedEvent(event)}>
              <time>{formatEventTime(event)}</time>
              <div>
                <strong>{event.title}</strong>
                {event.location ? <small>{event.location}</small> : null}
              </div>
            </button>
          ))}
          {(eventsByDay.get(toDayKey(selectedDate)) ?? []).length === 0 ? (
            <p className="desk-cal-empty">这一天没有安排</p>
          ) : null}
        </div>
      ) : null}

      {selectedEvent ? (
        <section className="desk-cal-detail" aria-label="安排详情">
          <div><span>{eventKindLabel[selectedEvent.kind]}</span><strong>{selectedEvent.title}</strong></div>
          <p>{formatEventTime(selectedEvent)}{selectedEvent.location ? ` · ${selectedEvent.location}` : ""}</p>
          {selectedEvent.taskId ? <button className="desk-cal-detail-complete" type="button" disabled={completingTaskId === selectedEvent.taskId} onClick={() => {
            const taskId = selectedEvent.taskId;
            if (!taskId) return;
            setCompletingTaskId(taskId);
            void api.completeTask(taskId).then(() => setSelectedEvent(null)).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "任务完成失败。")).finally(() => setCompletingTaskId(null));
          }}>{completingTaskId === selectedEvent.taskId ? "完成中…" : "完成任务"}</button> : null}
          {selectedEvent.task ? <button className="desk-cal-detail-open" type="button" onClick={() => setTaskForm(createDeskTaskForm(selectedDate, selectedEvent.task))}>编辑任务</button> : null}
          <small>{selectedEvent.taskId ? "自建任务可在此完成或编辑。" : "上游课程、考试和作业仅查看详情。"}</small>
          <button className="desk-cal-detail-open" type="button" onClick={() => void api.openMain(selectedEvent.id)}>打开 CampusOS 日程</button>
          <button className="desk-cal-detail-close" type="button" onClick={() => setSelectedEvent(null)}>关闭详情</button>
        </section>
      ) : null}

      {taskForm ? (
        <section className="desk-cal-task-form" aria-label={taskForm.id ? "编辑任务" : "新建任务"}>
          <header><strong>{taskForm.id ? "编辑任务" : "新建任务"}</strong><button type="button" onClick={() => setTaskForm(null)}>关闭</button></header>
          <label>标题<input autoFocus required value={taskForm.title} onChange={(event) => setTaskForm({ ...taskForm, title: event.target.value })} /></label>
          <label>说明<textarea value={taskForm.description} onChange={(event) => setTaskForm({ ...taskForm, description: event.target.value })} /></label>
          <div className="desk-cal-task-form-grid"><label>开始<input type="datetime-local" required value={taskForm.startAt} onChange={(event) => setTaskForm({ ...taskForm, startAt: event.target.value })} /></label><label>结束<input type="datetime-local" required value={taskForm.endAt} onChange={(event) => setTaskForm({ ...taskForm, endAt: event.target.value })} /></label></div>
          <label>地点<input value={taskForm.location} onChange={(event) => setTaskForm({ ...taskForm, location: event.target.value })} /></label>
          <label>类型<select value={taskForm.type} onChange={(event) => setTaskForm({ ...taskForm, type: event.target.value as DeskTaskForm["type"] })}><option value="fixed">日程</option><option value="deadline">DDL</option></select></label>
          <button className="desk-cal-detail-complete" type="button" disabled={savingTask || !taskForm.title.trim()} onClick={() => void saveTask()}>{savingTask ? "保存中…" : "保存任务"}</button>
        </section>
      ) : null}
    </div>
  );
};
