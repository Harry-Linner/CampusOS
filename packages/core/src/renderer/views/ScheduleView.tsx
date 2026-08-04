import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  LocalTaskInput,
  LocalTaskPeriod,
  LocalTaskRecord,
  PlannerScheduleData,
  PlannerSettings,
  PluginComponentProps
} from "@campusos/shared";
import { AppIcon } from "../components/AppIcon";
import { formatDateTime, formatTimeRange } from "../lib/formatters";

type ScheduleViewMode = "month" | "week" | "agenda" | "day";

interface ScheduleViewProps extends PluginComponentProps {
  schedule?: PluginComponentProps["schedule"];
}

type ScheduleEvent = {
  id: string;
  title: string;
  kind: "course" | "deadline" | "task";
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
  repeatType: "norepeat" | "days" | "month" | "year";
  repeatPeriod: number;
  repeatEndsOn: string;
  blocksPlanning: boolean;
}

const pad = (value: number): string => String(value).padStart(2, "0");

const toDateInput = (value: Date): string =>
  `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;

const toDateTimeInput = (value: Date): string =>
  `${toDateInput(value)}T${pad(value.getHours())}:${pad(value.getMinutes())}`;

const fromDateTimeInput = (value: string): string => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("时间格式无效。");
  return date.toISOString();
};

const startOfDay = (value: Date): Date =>
  new Date(value.getFullYear(), value.getMonth(), value.getDate());

const addDays = (value: Date, days: number): Date =>
  new Date(value.getTime() + days * 24 * 60 * 60 * 1000);

const addMonths = (value: Date, months: number): Date =>
  new Date(value.getFullYear(), value.getMonth() + months, 1);

const startOfWeek = (value: Date): Date => {
  const day = value.getDay();
  return addDays(startOfDay(value), day === 0 ? -6 : 1 - day);
};

const dayKey = (value: Date | string): string => {
  const date = typeof value === "string" ? new Date(value) : value;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const weekdayLabels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

const formatMonth = (value: Date): string =>
  new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(value);

const formatDay = (value: Date): string =>
  `${value.getMonth() + 1}月${value.getDate()}日 ${weekdayLabels[(value.getDay() + 6) % 7]}`;

const formatWeek = (value: Date): string => {
  const first = startOfWeek(value);
  const last = addDays(first, 6);
  return `${first.getMonth() + 1}月${first.getDate()}日 - ${last.getMonth() + 1}月${last.getDate()}日`;
};

const buildMonthDays = (month: Date): Date[] => {
  const first = startOfWeek(new Date(month.getFullYear(), month.getMonth(), 1));
  return Array.from({ length: 42 }, (_, index) => addDays(first, index));
};

const defaultTaskForm = (date = new Date()): TaskFormState => {
  const start = new Date(date);
  start.setMinutes(0, 0, 0);
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
    blocksPlanning: true
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
  blocksPlanning: task.blocksPlanning
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
  return [
    ...snapshot.courses.map((course) => ({
      id: `course:${course.id}`,
      kind: "course" as const,
      title: course.title,
      startAt: course.startAt,
      endAt: course.endAt,
      location: course.location,
      note: course.note
    })),
    ...snapshot.deadlines.map((deadline) => ({
      id: `deadline:${deadline.id}`,
      kind: "deadline" as const,
      title: deadline.title,
      startAt: new Date(new Date(deadline.dueAt).getTime() - 60 * 60 * 1000).toISOString(),
      endAt: deadline.dueAt,
      note: deadline.note
    })),
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
    const first = mode === "month"
      ? startOfWeek(new Date(date.getFullYear(), date.getMonth(), 1))
      : new Date(date.getFullYear(), date.getMonth(), 1);
    return { start: first, end: mode === "month" ? addDays(first, 42) : new Date(date.getFullYear(), date.getMonth() + 1, 1) };
  }
  if (mode === "week") {
    const first = startOfWeek(date);
    return { start: first, end: addDays(first, 7) };
  }
  const start = startOfDay(date);
  return { start, end: addDays(start, 1) };
};

export const ScheduleView = ({
  loading,
  snapshot,
  schedule
}: ScheduleViewProps): JSX.Element => {
  const [viewMode, setViewMode] = useState<ScheduleViewMode>("month");
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [tasks, setTasks] = useState<LocalTaskRecord[]>([]);
  const [taskUpdatedAt, setTaskUpdatedAt] = useState<string | null>(null);
  const [periods, setPeriods] = useState<LocalTaskPeriod[]>([]);
  const [plan, setPlan] = useState<PlannerScheduleData | null>(null);
  const [settings, setSettings] = useState<PlannerSettings>({
    workMinutes: 60,
    restMinutes: 15,
    availableStartHour: 8,
    availableEndHour: 22,
    horizonDays: 7
  });
  const [form, setForm] = useState<TaskFormState | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<ScheduleEvent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadTasks = useCallback(async (): Promise<void> => {
    if (!schedule) return;
    try {
      const [data, savedPlan] = await Promise.all([schedule.loadTasks(), schedule.loadPlan()]);
      setTasks(data.tasks);
      setTaskUpdatedAt(data.updatedAt);
      setPlan(savedPlan);
      if (savedPlan) setSettings(savedPlan.settings);
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
  const next48Hours = useMemo(() => {
    const start = Date.now();
    const end = start + 48 * 60 * 60 * 1000;
    return events
      .filter((event) => Date.parse(event.endAt) > start && Date.parse(event.startAt) < end)
      .sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt));
  }, [events]);
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
    if (event.taskId) {
      const task = tasks.find((candidate) => candidate.id === event.taskId);
      if (task) {
        setForm(taskToForm(task));
        setSelectedEvent(null);
        return;
      }
    }
    setSelectedEvent(event);
  };

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
        blocksPlanning: form.blocksPlanning
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
    status: "running" | "suspended" | "completed" | "deleted"
  ): Promise<void> => {
    if (!schedule) return;
    setBusy(true);
    setError(null);
    try {
      const data = await schedule.mutateTask({ id: task.id, status });
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

  const generatePlan = async (): Promise<void> => {
    if (!schedule) return;
    setBusy(true);
    setError(null);
    try {
      const next = await schedule.generatePlan(settings);
      setPlan(next);
      setNotice(next.valid ? "排程已生成" : "排程不可行");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "排程生成失败。");
    } finally {
      setBusy(false);
    }
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

  const periodLabel = viewMode === "day"
    ? formatDay(selectedDate)
    : viewMode === "week"
      ? formatWeek(selectedDate)
      : formatMonth(selectedDate);

  const currentTasks = useMemo(
    () => tasks.filter((task) => task.status !== "deleted" && task.type !== "fixedlegacy"),
    [tasks]
  );
  const historicalTasks = useMemo(
    () => tasks.filter((task) => task.status !== "deleted" && task.type === "fixedlegacy"),
    [tasks]
  );

  const formatTaskMeta = (task: LocalTaskRecord): string => {
    if (task.type === "fixed") {
      const repeat = task.repeatType === "norepeat"
        ? "不重复"
        : task.repeatType === "days"
          ? `每隔 ${task.repeatPeriod} 天`
          : task.repeatType === "month"
            ? `每隔 ${task.repeatPeriod} 月`
            : `每隔 ${task.repeatPeriod} 年`;
      return `${formatTimeRange(task.startAt, task.endAt)} · ${repeat}`;
    }
    return `${formatDateTime(task.endAt)} · ${task.timeSpentMinutes}/${task.timeNeededMinutes} 分钟`;
  };

  return (
    <section className="page-shell schedule-page">
      <header className="page-heading schedule-heading">
        <div>
          <h1>日程</h1>
          <p>{loading ? "正在同步课程与提醒" : `${next48Hours.length} 项安排在接下来 48 小时内`}</p>
        </div>
        <div className="schedule-actions">
          <button className="text-button" type="button" disabled={busy || !schedule} onClick={() => setForm(defaultTaskForm(selectedDate))}>
            新建任务
          </button>
          <button className="text-button" type="button" disabled={busy || !schedule} onClick={() => void exportIcal()}>
            导出 iCal
          </button>
        </div>
      </header>

      {error ? <div className="workspace-error-banner" role="alert">{error}</div> : null}
      {notice ? <div className="schedule-notice" role="status">{notice}</div> : null}
      {!schedule ? <div className="quiet-empty-state">日程服务尚未连接。</div> : null}

      <section className="schedule-next-section" aria-labelledby="schedule-next-heading">
        <div className="section-heading">
          <h2 id="schedule-next-heading">接下来 48 小时</h2>
          <span>{next48Hours.length} 项</span>
        </div>
        {next48Hours.length > 0 ? (
          <div className="schedule-next-list">
            {next48Hours.slice(0, 12).map((event) => (
              <button className={eventClassName(event)} type="button" key={event.id} onClick={() => selectEvent(event)}>
                <span className="schedule-event-time">{formatEventMeta(event)}</span>
                <strong>{event.title}</strong>
                <small>{event.location || (event.kind === "task" ? "任务" : event.kind === "course" ? "课程" : "截止事项")}</small>
              </button>
            ))}
          </div>
        ) : <div className="quiet-empty-state">暂无即将发生的安排</div>}
      </section>

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
              <button className="text-button" type="button" onClick={() => setSelectedDate(new Date())}>今天</button>
            </div>
          </header>

          {viewMode === "month" ? (
            <div className="schedule-month-grid">
              {weekdayLabels.map((label) => <span className="schedule-weekday" key={label}>{label}</span>)}
              {monthDays.map((day) => {
                const items = eventsByDay.get(dayKey(day)) ?? [];
                const outside = day.getMonth() !== selectedDate.getMonth();
                return (
                  <section className={`schedule-month-cell${outside ? " is-outside" : ""}${dayKey(day) === dayKey(new Date()) ? " is-today" : ""}`} key={dayKey(day)}>
                    <time dateTime={day.toISOString()}>{day.getDate()}</time>
                    <div className="schedule-event-list">
                      {items.slice(0, 5).map((event) => <button className={eventClassName(event)} type="button" key={event.id} onClick={() => selectEvent(event)}>{event.title}</button>)}
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
                <section className={`schedule-week-column${dayKey(day) === dayKey(new Date()) ? " is-today" : ""}`} key={dayKey(day)}>
                  <header><span>{weekdayLabels[(day.getDay() + 6) % 7]}</span><strong>{day.getDate()}</strong></header>
                  <div className="schedule-event-list">{(eventsByDay.get(dayKey(day)) ?? []).map((event) => <button className={eventClassName(event)} type="button" key={event.id} onClick={() => selectEvent(event)}><strong>{event.title}</strong><small>{formatEventMeta(event)}</small></button>)}</div>
                </section>
              ))}
            </div>
          ) : null}

          {viewMode === "agenda" ? (
            <div className="schedule-agenda-list">
              {Array.from(eventsByDay.entries()).filter(([key]) => new Date(`${key}T00:00:00`).getMonth() === selectedDate.getMonth()).map(([key, items]) => (
                <section className="schedule-agenda-day" key={key}>
                  <header><strong>{new Date(`${key}T00:00:00`).getDate()}</strong><span>{weekdayLabels[(new Date(`${key}T00:00:00`).getDay() + 6) % 7]}</span></header>
                  <div className="schedule-event-list">{items.map((event) => <button className={eventClassName(event)} type="button" key={event.id} onClick={() => selectEvent(event)}><strong>{event.title}</strong><small>{formatEventMeta(event)}{event.location ? ` · ${event.location}` : ""}</small></button>)}</div>
                </section>
              ))}
              {eventsByDay.size === 0 ? <div className="quiet-empty-state">本月没有安排</div> : null}
            </div>
          ) : null}

          {viewMode === "day" ? (
            <div className="schedule-day-timeline">
              {Array.from({ length: 24 }, (_, hour) => {
                const items = (eventsByDay.get(dayKey(selectedDate)) ?? []).filter((event) => new Date(event.startAt).getHours() === hour);
                return <section className="schedule-hour" key={hour}><time>{pad(hour)}:00</time><div className="schedule-hour-events">{items.map((event) => <button className={eventClassName(event)} type="button" key={event.id} onClick={() => selectEvent(event)}><strong>{event.title}</strong><small>{formatEventMeta(event)}</small></button>)}</div></section>;
              })}
            </div>
          ) : null}
        </section>

        <aside className="schedule-sidebar">
          <section className="schedule-task-section" aria-labelledby="schedule-task-heading">
            <div className="section-heading"><h2 id="schedule-task-heading">任务</h2><span>{currentTasks.length} 项</span></div>
            <div className="schedule-task-list">
              {currentTasks.map((task) => (
                <article className={`schedule-task-row is-${task.status}`} key={task.id}>
                  <button className="schedule-task-main" type="button" onClick={() => setForm(taskToForm(task))}><strong>{task.title}</strong><small>{formatTaskMeta(task)}</small></button>
                  <div className="schedule-task-actions">
                    {task.type === "deadline" && (task.status === "running" || task.status === "failed") ? <button className="text-button" type="button" disabled={busy} onClick={() => void mutate(task, "suspended")}>暂停</button> : null}
                    {task.type === "deadline" && task.status === "suspended" ? <button className="text-button" type="button" disabled={busy} onClick={() => void mutate(task, "running")}>继续</button> : null}
                    {task.type === "deadline" && task.status !== "completed" && task.status !== "deleted" ? <button className="text-button" type="button" disabled={busy} onClick={() => void mutate(task, "completed")}>完成</button> : null}
                    <button className="text-button is-danger" type="button" disabled={busy} onClick={() => void mutate(task, "deleted")}>删除</button>
                  </div>
                </article>
              ))}
              {currentTasks.length === 0 ? <div className="quiet-empty-state">还没有任务</div> : null}
            </div>
            {historicalTasks.length > 0 ? (
              <details className="schedule-history-section">
                <summary>历史日程（{historicalTasks.length} 项）</summary>
                <div className="schedule-task-list">
                  {historicalTasks.map((task) => (
                    <article className="schedule-task-row is-outdated" key={task.id}>
                      <div className="schedule-task-main"><strong>{task.title}</strong><small>{formatTaskMeta(task)}</small></div>
                      <span className="schedule-task-history-label">只读</span>
                    </article>
                  ))}
                </div>
              </details>
            ) : null}
          </section>

          {selectedEvent ? <section className="schedule-detail-section"><div className="section-heading"><h2>安排详情</h2><button className="text-button" type="button" onClick={() => setSelectedEvent(null)}>关闭</button></div><strong>{selectedEvent.title}</strong><p>{formatEventMeta(selectedEvent)}</p><p>{selectedEvent.location || selectedEvent.note || ""}</p></section> : null}

          {form ? (
            <form className="schedule-task-form" onSubmit={(event) => void saveForm(event)}>
              <div className="section-heading"><h2>{form.id ? "编辑任务" : "新建任务"}</h2><button className="text-button" type="button" onClick={() => setForm(null)}>关闭</button></div>
              <label>标题<input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
              <label>说明<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
              <div className="schedule-form-grid"><label>开始<input type="datetime-local" required value={form.startAt} onChange={(event) => setForm({ ...form, startAt: event.target.value })} /></label><label>结束<input type="datetime-local" required value={form.endAt} onChange={(event) => setForm({ ...form, endAt: event.target.value })} /></label></div>
              <div className="schedule-form-grid"><label>所需分钟<input type="number" min="1" value={form.timeNeededMinutes} onChange={(event) => setForm({ ...form, timeNeededMinutes: Number(event.target.value) })} /></label><label>已用分钟<input type="number" min="0" value={form.timeSpentMinutes} onChange={(event) => setForm({ ...form, timeSpentMinutes: Number(event.target.value) })} /></label></div>
              <label>地点<input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} /></label>
              <label className="schedule-check"><input type="checkbox" checked={form.breakable} onChange={(event) => setForm({ ...form, breakable: event.target.checked })} />允许拆分</label>
              <label className="schedule-check"><input type="checkbox" checked={form.blocksPlanning} onChange={(event) => setForm({ ...form, blocksPlanning: event.target.checked })} />占用排程时间</label>
              <label>类型<select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as TaskFormState["type"] })}><option value="deadline">DDL</option><option value="fixed">日程</option></select></label>
              {form.type === "fixed" ? <><label>重复<select value={form.repeatType} onChange={(event) => setForm({ ...form, repeatType: event.target.value as TaskFormState["repeatType"] })}><option value="norepeat">不重复</option><option value="days">每隔几天</option><option value="month">每月</option><option value="year">每年</option></select></label>{form.repeatType !== "norepeat" ? <div className="schedule-form-grid"><label>周期<input type="number" min="1" value={form.repeatPeriod} onChange={(event) => setForm({ ...form, repeatPeriod: Number(event.target.value) })} /></label><label>重复结束<input type="date" required value={form.repeatEndsOn} onChange={(event) => setForm({ ...form, repeatEndsOn: event.target.value })} /></label></div> : null}</> : null}
              <button className="primary-button" type="submit" disabled={busy}>{busy ? "保存中" : "保存任务"}</button>
            </form>
          ) : null}

          <section className="schedule-plan-section" aria-labelledby="schedule-plan-heading">
            <div className="section-heading"><h2 id="schedule-plan-heading">自动排程</h2><span>{plan?.valid ? `休息 ${plan.restMinutes} 分钟` : ""}</span></div>
            <div className="schedule-form-grid"><label>专注分钟<input type="number" min="1" value={settings.workMinutes} onChange={(event) => setSettings({ ...settings, workMinutes: Number(event.target.value) })} /></label><label>休息分钟<input type="number" min="0" value={settings.restMinutes} onChange={(event) => setSettings({ ...settings, restMinutes: Number(event.target.value) })} /></label><label>开始小时<input type="number" min="0" max="23" value={settings.availableStartHour} onChange={(event) => setSettings({ ...settings, availableStartHour: Number(event.target.value) })} /></label><label>结束小时<input type="number" min="1" max="24" value={settings.availableEndHour} onChange={(event) => setSettings({ ...settings, availableEndHour: Number(event.target.value) })} /></label><label>规划天数<input type="number" min="1" max="366" value={settings.horizonDays} onChange={(event) => setSettings({ ...settings, horizonDays: Number(event.target.value) })} /></label></div>
            <button className="primary-button" type="button" disabled={busy || !schedule} onClick={() => void generatePlan()}>{busy ? "处理中" : "生成排程"}</button>
            {plan && !plan.valid ? <p className="schedule-plan-error" role="alert">{plan.reason}</p> : null}
            {plan?.valid ? <div className="schedule-plan-list">{plan.segments.map((segment) => <div className="schedule-plan-row" key={segment.id}><time>{formatTimeRange(segment.startAt, segment.endAt)}</time><strong>{segment.title}</strong></div>)}</div> : null}
          </section>
        </aside>
      </div>
    </section>
  );
};
