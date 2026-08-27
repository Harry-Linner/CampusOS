import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type {
  CalendarEventRecord,
  CampusWorkspaceSnapshot,
  DeskCalendarSnapshotMessage,
  DeskCalendarView,
  DeskCalendarSettings,
  LocalTaskInput,
  LocalTaskRecord
} from "@campusos/shared";
import { DESK_CALENDAR_THEMES } from "@campusos/shared";
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

const solarFestivals: Record<string, string> = {
  "01-01": "元旦", "03-08": "妇女节", "05-01": "劳动节", "06-01": "儿童节", "10-01": "国庆节", "12-25": "圣诞节"
};

const lunarFestivals: Record<string, string> = {
  "一月初一": "春节",
  "一月十五": "元宵节",
  "五月初五": "端午节",
  "八月十五": "中秋节"
};

const formulaFestival = (day: Date): string | null => {
  const parts = getShanghaiParts(day);
  const month = Number(parts.month);
  const date = Number(parts.day);
  const weekday = getShanghaiWeekday(day);
  if (month === 5 && weekday === 0 && date >= 8 && date <= 14) return "母亲节";
  if (month === 6 && weekday === 0 && date >= 15 && date <= 21) return "父亲节";
  if (month === 11 && weekday === 4 && date >= 22 && date <= 28) return "感恩节";
  return null;
};

const calendarAnnotation = (day: Date, statutoryHolidays: DeskCalendarSettings["statutoryHolidays"]): string => {
  const key = toDayKey(day);
  const statutory = statutoryHolidays.find((holiday) => holiday.date === key)?.label;
  if (statutory) return statutory;
  const solar = solarFestivals[key.slice(5)];
  if (solar) return solar;
  const parts = new Intl.DateTimeFormat("zh-CN-u-ca-chinese", { timeZone: SHANGHAI_TIME_ZONE, month: "short", day: "numeric" }).formatToParts(day);
  const lunar = parts.filter((part) => part.type === "month" || part.type === "day").map((part) => part.value).join("");
  return lunarFestivals[lunar] ?? formulaFestival(day) ?? lunar;
};

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
  loadSettings: () => Promise<DeskCalendarSettings>;
  loadSnapshot: () => Promise<DeskCalendarSnapshotMessage>;
  setView: (view: DeskCalendarView) => Promise<unknown>;
  setShowClock: (showClock: boolean) => Promise<unknown>;
  close: () => Promise<unknown>;
  openMain: (entityId: string) => Promise<unknown>;
  completeTask: (taskId: string) => Promise<unknown>;
  saveTask: (input: LocalTaskInput) => Promise<unknown>;
  saveSettings: (patch: Partial<DeskCalendarSettings>) => Promise<unknown>;
  refreshWeather: () => Promise<unknown>;
  subscribe: (listener: (message: DeskCalendarSnapshotMessage) => void) => () => void;
}

export const DeskCalendarApp = ({ api }: { api: DeskCalendarWindowApi }): JSX.Element => {
  const [view, setView] = useState<DeskCalendarView>("month");
  const [snapshot, setSnapshot] = useState<CampusWorkspaceSnapshot | null>(null);
  const [latestMessage, setLatestMessage] = useState<DeskCalendarSnapshotMessage | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [selectedEvent, setSelectedEvent] = useState<DeskCalendarEvent | null>(null);
  const [showClock, setShowClock] = useState(true);
  const [deskSettings, setDeskSettings] = useState<DeskCalendarSettings | null>(null);
  const [showWidgetSettings, setShowWidgetSettings] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [error, setError] = useState<string | null>(null);
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);
  const [taskForm, setTaskForm] = useState<DeskTaskForm | null>(null);
  const [savingTask, setSavingTask] = useState(false);
  const wheelDeltaRef = useRef(0);

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
      setDeskSettings(settings);
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
      setDeskSettings((current) => current ? { ...current, showClock: next } : current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法保存时钟设置。");
    }
  };

  const saveWidgetSettings = async (patch: Partial<DeskCalendarSettings>): Promise<void> => {
    try {
      const next = await api.saveSettings(patch) as DeskCalendarSettings;
      setDeskSettings(next);
      setShowClock(next.showClock);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "桌面组件设置保存失败。");
    }
  };

  const widgetEnabled = (id: DeskCalendarSettings["widgets"][number]["id"]): boolean =>
    deskSettings?.widgets.find((widget) => widget.id === id)?.enabled ?? false;

  const addCountdown = (): void => {
    const title = window.prompt("倒计时标题");
    const targetAt = window.prompt("目标时间（YYYY-MM-DDTHH:mm）");
    if (!title?.trim() || !targetAt || !Number.isFinite(Date.parse(targetAt))) return;
    void saveWidgetSettings({ countdowns: [...(deskSettings?.countdowns ?? []), { id: crypto.randomUUID(), title: title.trim(), targetAt: new Date(targetAt).toISOString() }] });
  };

  const addProgress = (): void => {
    const title = window.prompt("进度条标题");
    const startAt = window.prompt("开始时间（YYYY-MM-DDTHH:mm）");
    const endAt = window.prompt("结束时间（YYYY-MM-DDTHH:mm）");
    if (!title?.trim() || !startAt || !endAt || Date.parse(startAt) >= Date.parse(endAt)) return;
    void saveWidgetSettings({ progress: [...(deskSettings?.progress ?? []), { id: crypto.randomUUID(), title: title.trim(), startAt: new Date(startAt).toISOString(), endAt: new Date(endAt).toISOString() }] });
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
  const sidebarTasks = useMemo(() => (
    (latestMessage?.localTasks ?? [])
      .filter((task) => !(latestMessage?.localTaskPeriods ?? []).some((period) => period.taskId === task.id))
      .filter((task) => task.status !== "completed")
      .sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt))
  ), [latestMessage]);

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

  const handleCalendarWheel = (event: React.WheelEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement;
    const scrollable = target.closest(".desk-cal-day-list, .desk-cal-agenda-list") as HTMLElement | null;
    if (scrollable) {
      const canScrollDown = event.deltaY > 0 && scrollable.scrollTop < scrollable.scrollHeight - scrollable.clientHeight - 1;
      const canScrollUp = event.deltaY < 0 && scrollable.scrollTop > 0;
      if (canScrollDown || canScrollUp) return;
    }
    wheelDeltaRef.current += event.deltaY;
    const threshold = 120;
    if (Math.abs(wheelDeltaRef.current) < threshold) return;
    const forward = wheelDeltaRef.current > 0;
    wheelDeltaRef.current = 0;
    const order: DeskCalendarView[] = ["month", "week", "day"];
    const next = order[(order.indexOf(view) + (forward ? 1 : 2)) % 3];
    event.preventDefault();
    void switchView(next);
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

  const openEventInMain = (event: DeskCalendarEvent): void => {
    void api.openMain(event.id);
  };

  const renderEventChip = (event: DeskCalendarEvent): JSX.Element => (
    <button
      className={`desk-cal-event desk-cal-event-${event.kind}`}
      key={event.id}
      type="button"
      data-detail={`${formatEventTime(event)}${event.location ? ` · ${event.location}` : ""}`}
      onClick={() => openEventInMain(event)}
      onContextMenu={(contextEvent) => {
        contextEvent.preventDefault();
        contextEvent.stopPropagation();
        setSelectedEvent(event);
      }}
    >
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
    const isSelected = isSameDayKey(key, toDayKey(selectedDate));
    const holiday = deskSettings?.statutoryHolidays.find((item) => item.date === key);
    const makeup = deskSettings?.makeupDays.find((item) => item.date === key);
    return (
      <section
        className={`desk-cal-cell${outside ? " is-outside" : ""}${isToday ? " is-today" : ""}${isSelected ? " is-selected" : ""}${holiday ? " is-holiday" : ""}`}
        key={key}
        onContextMenu={(event) => {
          event.preventDefault();
          if (!outside) setTaskForm(createDeskTaskForm(day));
        }}
      >
        <button className={`desk-cal-day-button${isSelected ? " is-selected" : ""}`} type="button" aria-pressed={isSelected} aria-label={`查看 ${key}`} onClick={() => setSelectedDate(day)}>
          <time dateTime={key}>{Number(key.slice(8, 10))}</time>
          <small className="desk-cal-lunar">{calendarAnnotation(day, deskSettings?.statutoryHolidays ?? [])}</small>
        </button>
        {makeup ? <small className="desk-cal-makeup-label">补{weekdayLabels[(makeup.weekday + 6) % 7]}</small> : null}
        <div className="desk-cal-cell-events">
          {dayEvents.slice(0, 3).map(renderEventChip)}
          {dayEvents.length > 3 ? <small className="desk-cal-more">+{dayEvents.length - 3} 项</small> : null}
        </div>
      </section>
    );
  };

  const selectedKey = toDayKey(selectedDate);
  const selectedHoliday = deskSettings?.statutoryHolidays.find((item) => item.date === selectedKey);
  const selectedMakeup = deskSettings?.makeupDays.find((item) => item.date === selectedKey);

  return (
    <div
      className="desk-cal-shell"
      role="dialog"
      aria-label="桌面日历"
      data-theme={deskSettings?.appearance.theme ?? "midnight"}
      style={{ "--desk-cal-alpha": String(deskSettings?.appearance.opacity ?? 0.92) } as CSSProperties}
    >
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
          <button className="desk-cal-clock-toggle" type="button" aria-pressed={showWidgetSettings} onClick={() => setShowWidgetSettings((value) => !value)}>组件</button>
          <button className="desk-cal-clock-toggle" type="button" aria-pressed={showClock} onClick={() => void toggleClock()}>时钟</button>
        </div>
        <button className="desk-cal-close" type="button" aria-label="关闭桌面日历" onClick={() => void api.close()}>
          ×
        </button>
      </header>
      {showClock && widgetEnabled("clock") ? <time className="desk-cal-clock" dateTime={now.toISOString()}>{new Intl.DateTimeFormat("zh-CN", { timeZone: SHANGHAI_TIME_ZONE, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(now)}</time> : null}

      {deskSettings ? <section className="desk-cal-widgets">
        {widgetEnabled("weather") ? <div className="desk-cal-widget"><strong>天气</strong><span>{deskSettings.weather?.error ? `天气暂不可用：${deskSettings.weather.error}` : deskSettings.weather ? `${deskSettings.weather.location} ${deskSettings.weather.temperatureC}°C` : "尚未刷新天气"}</span><button type="button" onClick={() => void api.refreshWeather().then((weather) => setDeskSettings((current) => current ? { ...current, weather: weather as DeskCalendarSettings["weather"] } : current)).catch((cause) => setError(cause instanceof Error ? cause.message : "天气刷新失败。"))}>刷新</button></div> : null}
        {widgetEnabled("countdown") ? deskSettings.countdowns.map((item) => <div className="desk-cal-widget" key={item.id}><strong>{item.title}</strong><span>{Math.max(0, Math.ceil((Date.parse(item.targetAt) - now.getTime()) / 86_400_000))} 天</span><button type="button" onClick={() => void saveWidgetSettings({ countdowns: deskSettings.countdowns.filter((candidate) => candidate.id !== item.id) })}>删除</button></div>) : null}
        {widgetEnabled("progress") ? deskSettings.progress.map((item) => { const percent = Math.max(0, Math.min(100, ((now.getTime() - Date.parse(item.startAt)) / (Date.parse(item.endAt) - Date.parse(item.startAt))) * 100)); return <div className="desk-cal-widget desk-cal-progress" key={item.id}><strong>{item.title}</strong><span>{percent.toFixed(0)}%</span><div role="progressbar" aria-label={item.title} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${percent}%` }} /></div><button type="button" onClick={() => void saveWidgetSettings({ progress: deskSettings.progress.filter((candidate) => candidate.id !== item.id) })}>删除</button></div>; }) : null}
      </section> : null}

      {showWidgetSettings && deskSettings ? <section className="desk-cal-widget-settings" aria-label="桌面组件设置">
        <header><strong>桌面组件</strong><button type="button" onClick={() => setShowWidgetSettings(false)}>关闭</button></header>
        {deskSettings.widgets.map((widget, index) => <div key={widget.id}><label><input type="checkbox" checked={widget.enabled} onChange={(event) => void saveWidgetSettings({ widgets: deskSettings.widgets.map((candidate) => candidate.id === widget.id ? { ...candidate, enabled: event.target.checked } : candidate) })} />{widget.id === "clock" ? "时钟" : widget.id === "weather" ? "天气" : widget.id === "countdown" ? "倒计时" : "进度条"}</label><button type="button" disabled={index === 0} onClick={() => { const widgets = [...deskSettings.widgets]; [widgets[index - 1], widgets[index]] = [widgets[index], widgets[index - 1]]; void saveWidgetSettings({ widgets }); }}>上移</button><button type="button" disabled={index === deskSettings.widgets.length - 1} onClick={() => { const widgets = [...deskSettings.widgets]; [widgets[index + 1], widgets[index]] = [widgets[index], widgets[index + 1]]; void saveWidgetSettings({ widgets }); }}>下移</button></div>)}
        <div><button type="button" onClick={addCountdown}>添加倒计时</button><button type="button" onClick={addProgress}>添加进度条</button><button type="button" onClick={() => { const location = window.prompt("天气地点", deskSettings.weather?.location ?? "Hangzhou"); if (!location?.trim()) return; void saveWidgetSettings({ weather: { location: location.trim(), temperatureC: 0, weatherCode: -1, observedAt: new Date(0).toISOString(), cachedAt: new Date(0).toISOString(), error: null } }).then(() => api.refreshWeather()).then((weather) => setDeskSettings((current) => current ? { ...current, weather: weather as DeskCalendarSettings["weather"] } : current)); }}>设置地点并刷新</button></div>
        <button type="button" onClick={() => { const raw = window.prompt("粘贴法定假期 JSON（[{date,label}]）"); if (!raw) return; try { const statutoryHolidays = JSON.parse(raw) as DeskCalendarSettings["statutoryHolidays"]; void saveWidgetSettings({ statutoryHolidays }); } catch { setError("法定假期 JSON 格式无效。"); } }}>导入法定假期 JSON</button>
        <label>透明度<input type="range" min="0.2" max="1" step="0.05" value={deskSettings.appearance.opacity} onChange={(event) => void saveWidgetSettings({ appearance: { ...deskSettings.appearance, opacity: Number(event.target.value) } })} /></label>
        <div className="desk-cal-theme-row" aria-label="配色主题">主题{DESK_CALENDAR_THEMES.map((theme) => <button key={theme.id} type="button" className={deskSettings.appearance.theme === theme.id ? "is-active" : undefined} aria-pressed={deskSettings.appearance.theme === theme.id} onClick={() => void saveWidgetSettings({ appearance: { ...deskSettings.appearance, theme: theme.id } })}>{theme.label}</button>)}</div>
      </section> : null}

      <aside className="desk-cal-task-rail" aria-label="待办事项">
        <div className="desk-cal-rail-header"><div><span>待办</span><strong>{sidebarTasks.length}</strong></div><button type="button" aria-label="新建待办" onClick={() => setTaskForm(createDeskTaskForm(new Date()))}>＋</button></div>
        <div className="desk-cal-task-tabs"><span className="is-active">进行中</span><span>已完成</span></div>
        <div className="desk-cal-sidebar-list">
          {sidebarTasks.map((task) => <button className="desk-cal-sidebar-task" key={task.id} type="button" onDoubleClick={() => setTaskForm(createDeskTaskForm(selectedDate, task))} onContextMenu={(event) => { event.preventDefault(); setTaskForm(createDeskTaskForm(selectedDate, task)); }}><span className="desk-cal-task-dot" /><span><strong>{task.title}</strong><small>{toDayKey(new Date(task.startAt))}</small></span></button>)}
          {sidebarTasks.length === 0 ? <p className="desk-cal-sidebar-empty">没有待办事项<br /><small>用“新建任务”添加第一项</small></p> : null}
        </div>
        <button className="desk-cal-sidebar-new" type="button" onClick={() => setTaskForm(createDeskTaskForm(selectedDate))}>＋ 添加待办</button>
      </aside>
      {error ? <p className="desk-cal-error" role="alert">{error}</p> : null}
      {!snapshot && !error ? <p className="desk-cal-nodata">暂无日历数据，请先在工作台完成同步。</p> : null}

      <div className="desk-cal-calendar" onWheel={handleCalendarWheel}>
        {view === "month" ? (
          <div className="desk-cal-month-area">
            <div className="desk-cal-month-grid">
              {weekdayLabels.map((label) => <span className="desk-cal-weekday" key={label}>{label}</span>)}
              {monthDays.map(renderDayCell)}
            </div>
            <section className="desk-cal-agenda" aria-label="当日议程">
              <header>
                <strong>当日议程</strong>
                <span>{dayLabel}{selectedHoliday ? ` · ${selectedHoliday.label}` : ""}{selectedMakeup ? ` · 补${weekdayLabels[(selectedMakeup.weekday + 6) % 7]}` : ""}</span>
              </header>
              <div className="desk-cal-agenda-list">
                {(eventsByDay.get(selectedKey) ?? []).map((event) => (
                  <button
                    className={`desk-cal-agenda-row desk-cal-event-${event.kind}`}
                    key={event.id}
                    type="button"
                    data-detail={`${formatEventTime(event)}${event.location ? ` · ${event.location}` : ""}`}
                    onClick={() => openEventInMain(event)}
                    onContextMenu={(contextEvent) => {
                      contextEvent.preventDefault();
                      contextEvent.stopPropagation();
                      setSelectedEvent(event);
                    }}
                  >
                    <time>{formatEventTime(event)}</time>
                    <strong>{event.title}</strong>
                    {event.location ? <small>{event.location}</small> : null}
                  </button>
                ))}
                {(eventsByDay.get(selectedKey) ?? []).length === 0 ? (
                  <p className="desk-cal-agenda-empty">这一天没有安排</p>
                ) : null}
              </div>
            </section>
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
              <button className={`desk-cal-day-row desk-cal-event-${event.kind}`} key={event.id} type="button" onClick={() => openEventInMain(event)} onContextMenu={(contextEvent) => { contextEvent.preventDefault(); contextEvent.stopPropagation(); setSelectedEvent(event); }}>
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
      </div>

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
