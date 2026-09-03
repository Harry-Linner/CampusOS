import { useEffect, useMemo, useState, useCallback, Fragment, useRef } from "react";
import { createRoot } from "react-dom/client";
import "./globals.css";
import "./theme.css";
import "./styles.css";

// ===== 日期工具（照搬自 ScheduleView，本地独立窗口用）=====
type CalKind = "course" | "exam" | "deadline" | "task";
interface ScheduleEvent {
  id: string;
  title: string;
  kind: CalKind;
  startAt: string;
  endAt: string;
  location?: string;
  note?: string;
  taskId?: string;
  status?: string;
}
type ViewMode = "month" | "week" | "day";

interface RawItem {
  id: string;
  title: string;
  date: string;
  kind: "course" | "exam" | "assignment" | "task";
  time?: string;
  note?: string;
  location?: string;
  status?: string;
}
interface DeskCalendarSettings {
  showWeeks: boolean;
  showHolidays: boolean;
  showLunar: boolean;
  showFestival: boolean;
  showJieqi: boolean;
  showJiyi: boolean;
  glass: boolean;
  bgColor: string;
  opacity: number;
  colors: { calendar: string; cell: string; todayBorder: string; lunar: string; holiday: string };
  autoStart: boolean;
}

interface CalData {
  today: string;
  items: RawItem[];
  holidays?: { date: string; label: string; holiday: boolean }[];
  weeks?: Record<string, number>;
  theme?: "light" | "dark" | "high-contrast";
  currentWeek?: number | null;
}
type RepeatType = "once" | "daily-range" | "weekly" | "specific-dates";

declare global {
  interface Window {
    deskCalendar?: {
      getCalendarData: () => Promise<CalData>;
      subscribe: (cb: (d: CalData) => void) => () => void;
      setTransparency: (v: number) => void;
      moveWindow: (dx: number, dy: number) => void;
      dragEnd: () => void;
      closeWindow: () => void;
      getSettings: () => Promise<DeskCalendarSettings>;
      saveSettings: (patch: Partial<DeskCalendarSettings>) => Promise<DeskCalendarSettings>;
      subscribeSettings: (cb: (s: DeskCalendarSettings) => void) => () => void;
      onOpenSettings: (cb: () => void) => () => void;
      completeTask: (id: string, completed: boolean) => Promise<{ ok: boolean; error?: string }>;
      createEvent: (input: {
        date: string;
        title: string;
        priority?: string;
        repeatType?: string;
        startAt?: string;
        endAt?: string;
        location?: string;
        note?: string;
        reminderLeadMinutes?: number;
      }) => Promise<{ ok: boolean; error?: string }>;
    };
  }
}

const SHANGHAI_TIME_ZONE = "Asia/Shanghai";
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const getShanghaiDateParts = (value: Date): Record<string, string> => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHANGHAI_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(value);
  return Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
};
const fromShanghaiParts = (y: number, mo: number, d: number, h = 0, mi = 0): Date =>
  new Date(Date.UTC(y, mo - 1, d, h, mi) - SHANGHAI_OFFSET_MS);
const toDateInput = (value: Date): string => {
  const p = getShanghaiDateParts(value);
  return `${p.year}-${p.month}-${p.day}`;
};
const startOfDay = (value: Date): Date => {
  const p = getShanghaiDateParts(value);
  return fromShanghaiParts(Number(p.year), Number(p.month), Number(p.day));
};
const addDays = (value: Date, n: number): Date => new Date(value.getTime() + n * 86400000);
const getShanghaiWeekday = (value: Date): number => {
  const w = new Intl.DateTimeFormat("en-US", { timeZone: SHANGHAI_TIME_ZONE, weekday: "short" }).format(value);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(w);
};
const startOfWeek = (value: Date): Date => {
  const day = getShanghaiWeekday(value);
  return addDays(startOfDay(value), day === 0 ? -6 : 1 - day);
};
const dayKey = (value: Date | string): string => toDateInput(typeof value === "string" ? new Date(value) : value);
const monthKey = (value: Date | string): string => dayKey(value).slice(0, 7);
// 自然周 = 该日期在"其所在月份"的第几周（周一起始；月初所在的周为第 1 周）。
// 校历周(已导入)优先，否则回退月内周。
const monthWeekNumber = (value: Date, refMonth: Date): number => {
  const p = getShanghaiDateParts(refMonth);
  const firstMonday = startOfWeek(fromShanghaiParts(Number(p.year), Number(p.month), 1));
  return 1 + Math.round((startOfWeek(value).getTime() - firstMonday.getTime()) / (7 * 86400000));
};
const getShanghaiDayNumber = (value: Date): number => Number(getShanghaiDateParts(value).day);
const weekdayLabels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const buildMonthDays = (month: Date): Date[] => {
  const p = getShanghaiDateParts(month);
  const first = startOfWeek(fromShanghaiParts(Number(p.year), Number(p.month), 1));
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
};
const formatTimeRange = (startAt: string, endAt: string): string => {
  const sp = getShanghaiDateParts(new Date(startAt));
  const ep = getShanghaiDateParts(new Date(endAt));
  const f = (q: Record<string, string>): string => `${Number(q.hour)}:${q.minute}`;
  if (toDateInput(new Date(startAt)) === toDateInput(new Date(endAt))) return `${f(sp)} - ${f(ep)}`;
  return `${Number(sp.month)}/${Number(sp.day)} ${f(sp)} - ${Number(ep.month)}/${Number(ep.day)} ${f(ep)}`;
};
const formatDateTime = (value: string): string => {
  const p = getShanghaiDateParts(new Date(value));
  return `${Number(p.month)}月${Number(p.day)}日 ${Number(p.hour)}:${p.minute}`;
};
const formatEventMeta = (event: ScheduleEvent): string =>
  event.kind === "deadline" ? `截止 ${formatDateTime(event.endAt)}` : formatTimeRange(event.startAt, event.endAt);
const eventClassName = (event: ScheduleEvent): string =>
  `schedule-event schedule-event-${event.kind}${event.status === "completed" ? " is-complete" : ""}`;

interface Range { start: Date; end: Date }
const groupEventsByDay = (events: ScheduleEvent[], range: Range): Map<string, ScheduleEvent[]> => {
  const result = new Map<string, ScheduleEvent[]>();
  for (const event of events) {
    if (Date.parse(event.endAt) <= range.start.getTime() || Date.parse(event.startAt) >= range.end.getTime()) continue;
    const es = Math.max(Date.parse(event.startAt), range.start.getTime());
    const ee = Math.min(Date.parse(event.endAt), range.end.getTime());
    for (let c = startOfDay(new Date(es)); c.getTime() < ee; c = addDays(c, 1)) {
      const k = dayKey(c);
      result.set(k, [...(result.get(k) ?? []), event]);
    }
  }
  for (const items of result.values()) items.sort((l, r) => Date.parse(l.startAt) - Date.parse(r.startAt));
  return result;
};

const REPEAT_OPTIONS: { value: RepeatType; label: string }[] = [
  { value: "once", label: "单次" },
  { value: "daily-range", label: "范围每天" },
  { value: "weekly", label: "范围内每周几" },
  { value: "specific-dates", label: "指定多日" }
];
const REMIND_UNITS = ["分钟", "小时", "天"] as const;

interface TaskForm {
  id?: string;
  title: string;
  repeatType: RepeatType;
  startAt: string;
  endAt: string;
  location: string;
  note: string;
  remindEnabled: boolean;
  remindValue: number;
  remindUnit: string;
}

const emptyForm = (date: string): TaskForm => ({
  title: "",
  repeatType: "once",
  startAt: `${date}T09:00`,
  endAt: `${date}T10:00`,
  location: "",
  note: "",
  remindEnabled: false,
  remindValue: 30,
  remindUnit: "分钟"
});

const DEFAULT_DESK_SETTINGS: DeskCalendarSettings = {
  showWeeks: true,
  showHolidays: true,
  showLunar: false,
  showFestival: false,
  showJieqi: false,
  showJiyi: false,
  glass: false,
  bgColor: "",
  opacity: 0.98,
  colors: { calendar: "", cell: "", todayBorder: "", lunar: "", holiday: "" },
  autoStart: false
};

export default function DeskCalendar(): JSX.Element {
  const [data, setData] = useState<CalData>({ today: "", items: [] });
  const [settings, setSettings] = useState<DeskCalendarSettings>(DEFAULT_DESK_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [cursor, setCursor] = useState<{ y: number; m: number; d: number } | null>(null);
  const [, setSelected] = useState<string | null>(null);
  const [infoEvent, setInfoEvent] = useState<ScheduleEvent | null>(null);
  const [form, setForm] = useState<TaskForm | null>(null);
  const [glass, setGlass] = useState(false);

  const applySettings = useCallback((s: DeskCalendarSettings): void => {
    const next: DeskCalendarSettings = {
      ...DEFAULT_DESK_SETTINGS,
      ...s,
      colors: { ...DEFAULT_DESK_SETTINGS.colors, ...(s.colors ?? /* istanbul ignore next */ DEFAULT_DESK_SETTINGS.colors) }
    };
    setSettings(next);
    setGlass(next.glass);
    window.deskCalendar?.setTransparency(next.opacity);
    const root = document.documentElement;
    const setVar = (name: string, value: string): void => {
      if (value) root.style.setProperty(name, value);
      else root.style.removeProperty(name);
    };
    setVar("--dk-calendar-fg", next.colors.calendar);
    setVar("--dk-cell-bg", next.colors.cell);
    setVar("--dk-today-border", next.colors.todayBorder);
    setVar("--dk-lunar-fg", next.colors.lunar);
    setVar("--dk-holiday-fg", next.colors.holiday);
    setVar("--dk-bg", next.bgColor);
  }, []);
  const patchSetting = (patch: Partial<DeskCalendarSettings>): void => {
    void window.deskCalendar?.saveSettings(patch).then(applySettings);
  };

  const load = useCallback(async (): Promise<void> => {
    const bridge = window.deskCalendar;
    if (!bridge) return;
    const [d, s] = await Promise.all([bridge.getCalendarData(), bridge.getSettings()]);
    setData(d);
    applySettings(s);
    document.documentElement.setAttribute("data-theme", d.theme ?? "light");
    if (d.today) {
      const t = d.today;
      setCursor({ y: Number(t.slice(0, 4)), m: Number(t.slice(5, 7)), d: Number(t.slice(8, 10)) });
      setSelected(d.today);
    }
  }, [applySettings]);
  useEffect(() => {
    void load();
    const unsub = window.deskCalendar?.subscribe(() => { void load(); });
    const unsubSettings = window.deskCalendar?.subscribeSettings(applySettings);
    const unsubOpen = window.deskCalendar?.onOpenSettings(() => setShowSettings(true));
    return () => { unsub?.(); unsubSettings?.(); unsubOpen?.(); };
  }, [load, applySettings]);

  const events: ScheduleEvent[] = useMemo(
    () =>
      data.items.map((item) => {
        const kind: CalKind = item.kind === "assignment" ? "deadline" : item.kind;
        const start = fromShanghaiParts(
          Number(item.date.slice(0, 4)), Number(item.date.slice(5, 7)), Number(item.date.slice(8, 10)),
          item.time ? Number(item.time.slice(0, 2)) : 0, item.time ? Number(item.time.slice(3, 5)) : 0
        );
        const end = new Date(start.getTime() + 60 * 60 * 1000);
        return { id: item.id, title: item.title, kind, startAt: start.toISOString(), endAt: end.toISOString(), taskId: item.kind === "task" ? item.id.replace(/^task:/, "") : undefined, location: item.location, note: item.note, status: item.status };
      }),
    [data.items]
  );

  const selDate = cursor ? fromShanghaiParts(cursor.y, cursor.m, cursor.d) : new Date();
  const monthDays = useMemo(() => buildMonthDays(selDate), [selDate]);
  const eventRange: Range = useMemo(() => {
    if (viewMode === "month") {
      const p = getShanghaiDateParts(selDate);
      const first = startOfWeek(fromShanghaiParts(Number(p.year), Number(p.month), 1));
      return { start: first, end: addDays(first, 42) };
    }
    if (viewMode === "week") {
      const first = startOfWeek(selDate);
      return { start: first, end: addDays(first, 7) };
    }
    const s = startOfDay(selDate);
    return { start: s, end: addDays(s, 1) };
  }, [selDate, viewMode]);
  const eventsByDay = useMemo(() => groupEventsByDay(events, eventRange), [events, eventRange]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(selDate), i)), [selDate]);
  const holidayMap = useMemo(() => {
    const m = new Map<string, { label: string; holiday: boolean }>();
    for (const h of data.holidays ?? []) m.set(h.date, { label: h.label, holiday: h.holiday });
    return m;
  }, [data.holidays]);
  // 周次：有校历周（已导入）用校历周，否则回退月内自然周（该月第几周）。
  const weekNumberFor = (day: Date): number => data.weeks?.[dayKey(day)] ?? monthWeekNumber(day, selDate);

  const shiftMonth = (delta: number): void => {
    if (!cursor) return;
    const d = new Date(cursor.y, cursor.m - 1 + delta, 1);
    setCursor({ y: d.getFullYear(), m: d.getMonth() + 1, d: 1 });
  };
  const shiftDay = (delta: number): void => {
    const base = cursor ? fromShanghaiParts(cursor.y, cursor.m, cursor.d) : new Date();
    const next = addDays(base, delta);
    setCursor({ y: next.getFullYear(), m: next.getMonth() + 1, d: next.getDate() });
    setSelected(toDateInput(next));
  };
  const shiftWeek = (delta: number): void => {
    const base = cursor ? fromShanghaiParts(cursor.y, cursor.m, cursor.d) : new Date();
    const next = addDays(base, delta * 7);
    setCursor({ y: next.getFullYear(), m: next.getMonth() + 1, d: next.getDate() });
    setSelected(toDateInput(next));
  };
  const shiftView = (delta: number): void => {
    if (viewMode === "month") shiftMonth(delta);
    else if (viewMode === "week") shiftWeek(delta);
    else shiftDay(delta);
  };
  const goToday = (): void => {
    if (!data.today) return;
    const t = data.today;
    setCursor({ y: Number(t.slice(0, 4)), m: Number(t.slice(5, 7)), d: Number(t.slice(8, 10)) });
    setSelected(data.today);
  };

  // 双击空白格子 → 新增（日期默认那天）
  const onDoubleDay = (day: { y: number; m: number; d: number }): void => {
    const dkey = dayKey(fromShanghaiParts(day.y, day.m, day.d));
    setForm(emptyForm(dkey));
  };
  // 双击事件条 → 编辑
  const onDoubleEvent = (event: ScheduleEvent): void => {
    const dk = dayKey(new Date(event.startAt));
    setForm({ ...emptyForm(dk), id: event.id, title: event.title, location: event.location ?? "", note: event.note ?? "", startAt: toDateInput(new Date(event.startAt)) + "T" + getShanghaiDateParts(new Date(event.startAt)).hour + ":" + getShanghaiDateParts(new Date(event.startAt)).minute, endAt: toDateInput(new Date(event.endAt)) + "T" + getShanghaiDateParts(new Date(event.endAt)).hour + ":" + getShanghaiDateParts(new Date(event.endAt)).minute });
  };
  // 单击事件条 → 信息卡片，显示节次/时间/教师/地点
  const onInfoClick = (event: ScheduleEvent): void => setInfoEvent(event);
  // 单击/双击区分：单击延迟 ~250ms 等待第二次左键；若期间来了第二次则为双击(编辑)，取消信息卡片。
  // 否则到点弹信息卡片。避免"单击已弹卡片、双击编辑"冲突。
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onEventClick = (event: ScheduleEvent): void => {
    if (clickTimer.current) clearTimeout(clickTimer.current);
    clickTimer.current = setTimeout(() => {
      clickTimer.current = null;
      onInfoClick(event);
    }, 250);
  };
  const onEventDoubleClick = (event: ScheduleEvent): void => {
    if (clickTimer.current) clearTimeout(clickTimer.current);
    clickTimer.current = null;
    onDoubleEvent(event);
  };
  useEffect(() => () => {
    if (clickTimer.current) clearTimeout(clickTimer.current);
  }, []);

  const saveEvent = async (): Promise<void> => {
    if (!form) return;
    if (!form.title.trim()) return;
    await window.deskCalendar?.createEvent({
      date: form.startAt.slice(0, 10),
      title: form.title.trim(),
      repeatType: form.repeatType,
      startAt: form.repeatType === "once" ? form.startAt : undefined,
      endAt: form.repeatType === "once" ? form.endAt : undefined,
      location: form.location,
      note: form.note,
      reminderLeadMinutes: form.remindEnabled ? (form.remindUnit === "小时" ? form.remindValue * 60 : form.remindUnit === "天" ? form.remindValue * 1440 : form.remindValue) : undefined
    });
    setForm(null);
    void load();
  };

  // 标记完成 / 恢复未完成：任务类事件通过后端 mutate（status=completed | restore）。
  const completeTask = async (event: ScheduleEvent): Promise<void> => {
    if (!event.taskId) return;
    const completed = event.status !== "completed";
    const res = await window.deskCalendar?.completeTask(event.taskId, completed);
    if (res?.ok) {
      setInfoEvent(null);
      void load();
    }
  };

  const monthLabel = cursor ? `${cursor.y}年${cursor.m}月` : "";
  const weekLabel = cursor ? `${cursor.y}年${cursor.m}月 第${monthWeekNumber(fromShanghaiParts(cursor.y, cursor.m, cursor.d), fromShanghaiParts(cursor.y, cursor.m, 1))}周` : "";
  const dayLabel = cursor ? `${cursor.y}年${cursor.m}月${cursor.d}日` : "";
  const headerLabel = viewMode === "week" ? weekLabel : viewMode === "day" ? dayLabel : monthLabel;

  return (
    <div className="desk-cal-root" data-glass={glass ? "on" : "off"} data-show-weeks={settings.showWeeks ? "on" : "off"} data-show-holidays={settings.showHolidays ? "on" : "off"}>
      <header className="desk-cal-header">
        <div className="desk-cal-title">
          <button className="desk-cal-nav" type="button" onClick={() => shiftView(-1)} aria-label="上一段">‹</button>
          <strong>{headerLabel}</strong>
          <button className="desk-cal-nav" type="button" onClick={() => shiftView(1)} aria-label="下一段">›</button>
        </div>
        <div className="desk-cal-head-actions">
          <nav className="desk-cal-tabs" aria-label="视图切换">
            {(["month", "week", "day"] as const).map((m) => (
              <button key={m} type="button" className={viewMode === m ? "is-active" : undefined} aria-pressed={viewMode === m} onClick={() => setViewMode(m)}>{m === "month" ? "月" : m === "week" ? "周" : "日"}</button>
            ))}
          </nav>
          <button className="desk-cal-mini" type="button" onClick={goToday}>今天</button>
          <button className="desk-cal-mini" type="button" onClick={() => setGlass((g) => !g)} aria-pressed={glass}>玻璃</button>
          <button className="desk-cal-mini" type="button" onClick={() => setShowSettings(true)}>⚙ 设置</button>
        </div>
      </header>

      <div className="desk-cal-body">
        {/* 月视图：DeskToDo 拆解式 —— 顶部横条标题(header) → 细周名行 → 视图区(左侧第N周列 + 7天) */}
        {viewMode === "month" ? (
          <div className="dk-month-view">
            <div className="dk-month-weekrow">
              <span className="dk-weeknum-head">周</span>
              {weekdayLabels.map((l) => <span className="dk-month-weekday" key={l}>{l}</span>)}
            </div>
            <div className="dk-month-grid">
              {Array.from({ length: 6 }, (_, row) => {
                const rowDays = monthDays.slice(row * 7, (row + 1) * 7);
                return (
                  <Fragment key={row}>
                    <div className="dk-weeknum-cell">{weekNumberFor(rowDays[0])}</div>
                    {rowDays.map((day) => {
                      const k = dayKey(day);
                      const outside = monthKey(day) !== monthKey(selDate);
                      const today = k === dayKey(new Date());
                      const items = eventsByDay.get(k) ?? [];
                      const holiday = holidayMap.get(k);
                      return (
                        <div key={k} className={`dk-month-cell${outside ? " is-outside" : ""}${today ? " is-today" : ""}`} onDoubleClick={() => onDoubleDay({ y: day.getFullYear(), m: day.getMonth() + 1, d: day.getDate() })}>
                          <div className="dk-month-cell-head">
                            <time>{getShanghaiDayNumber(day)}</time>
                            {today ? <span className="dk-today-badge">今天</span> : null}
                            {holiday ? <span className={holiday.holiday ? "dk-holiday" : "dk-makeup"}>{holiday.label}</span> : null}
                          </div>
                          <div className="dk-month-cell-list">
                            {items.map((event) => (
                              <button key={event.id} className={eventClassName(event)} type="button"
                                onClick={(e) => { e.stopPropagation(); onEventClick(event); }}
                                onDoubleClick={(e) => { e.stopPropagation(); onEventDoubleClick(event); }}>
                                {event.title}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </Fragment>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* 周视图：7 列 */}
        {viewMode === "week" ? (
          <div className="dk-week-grid">
            {weekDays.map((day) => (
              <div key={dayKey(day)} className={`dk-week-col${dayKey(day) === dayKey(new Date()) ? " is-today" : ""}`}>
                <header><span>{weekdayLabels[(getShanghaiWeekday(day) + 6) % 7]}</span><strong>{getShanghaiDayNumber(day)}</strong></header>
                <div className="dk-week-col-list">
                  {(eventsByDay.get(dayKey(day)) ?? []).map((event) => (
                    <button key={event.id} className={eventClassName(event)} type="button"
                      onClick={() => onEventClick(event)} onDoubleClick={() => onEventDoubleClick(event)}>
                      <strong>{event.title}</strong><small>{formatEventMeta(event)}</small>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {/* 日视图：时间线 */}
        {viewMode === "day" ? (
          <div className="dk-day-timeline">
            {(eventsByDay.get(dayKey(selDate)) ?? []).map((event) => (
              <button key={event.id} className={eventClassName(event)} type="button" onClick={() => onEventClick(event)} onDoubleClick={() => onEventDoubleClick(event)}>
                <strong>{event.title}</strong><small>{formatEventMeta(event)}</small>
              </button>
            ))}
            {(eventsByDay.get(dayKey(selDate)) ?? []).length === 0 ? <div className="dk-empty">这一天没有安排</div> : null}
          </div>
        ) : null}
      </div>

      {/* 单击事件 → 信息小卡片 */}
      {infoEvent ? (
        <div className="dk-info-backdrop" onClick={() => setInfoEvent(null)}>
          <div className="dk-info-card" onClick={(e) => e.stopPropagation()}>
            <strong>{infoEvent.title}</strong>
            {infoEvent.note ? <p className="dk-info-note">{infoEvent.note}</p> : null}
            {infoEvent.location ? <p>📍 {infoEvent.location}</p> : null}
            <p>{formatEventMeta(infoEvent)}</p>
            <div className="dk-info-actions">
              {infoEvent.taskId ? (
                <button type="button" className="dk-info-primary" onClick={() => void completeTask(infoEvent)}>
                  {infoEvent.status === "completed" ? "恢复未完成" : "标记完成"}
                </button>
              ) : null}
              <button type="button" onClick={() => setInfoEvent(null)}>关闭</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 新增/编辑事件窗口 */}
      {form ? (
        <div className="dk-form-backdrop" onClick={() => setForm(null)}>
          <div className="dk-form-card" onClick={(e) => e.stopPropagation()}>
            <h3>{form.id ? "编辑事件" : "新增事件"}</h3>
            <label>名称<input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
            <label>重复
              <select value={form.repeatType} onChange={(e) => setForm({ ...form, repeatType: e.target.value as RepeatType })}>
                {REPEAT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <div className="dk-form-row">
              <label>开始<input type="datetime-local" value={form.startAt} onChange={(e) => setForm({ ...form, startAt: e.target.value })} /></label>
              <label>结束<input type="datetime-local" value={form.endAt} onChange={(e) => setForm({ ...form, endAt: e.target.value })} /></label>
            </div>
            <label>地点<input type="text" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></label>
            <label>备注<textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
            <div className="dk-form-remind">
              <label className="dk-remind-toggle"><input type="checkbox" checked={form.remindEnabled} onChange={(e) => setForm({ ...form, remindEnabled: e.target.checked })} /> 提醒</label>
              <div className="dk-form-row">
                <label>提前<input type="number" value={form.remindValue} onChange={(e) => setForm({ ...form, remindValue: Number(e.target.value), remindEnabled: true })} /></label>
                <select value={form.remindUnit} onChange={(e) => setForm({ ...form, remindUnit: e.target.value, remindEnabled: true })}>
                  {REMIND_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>
            <div className="dk-form-actions">
              <button type="button" onClick={() => setForm(null)}>取消</button>
              <button type="button" className="dk-primary" onClick={() => void saveEvent()}>保存</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 设置面板：显示项/外观/颜色/通用 */}
      {showSettings ? (
        <div className="dk-settings-backdrop" onClick={() => setShowSettings(false)}>
          <div className="dk-settings-card" onClick={(e) => e.stopPropagation()}>
            <h3>日历设置</h3>
            <section className="dk-settings-section">
              <h4>显示</h4>
              <label className="dk-settings-row"><input type="checkbox" checked={settings.showWeeks} onChange={(e) => patchSetting({ showWeeks: e.target.checked })} /> 周数列</label>
              <label className="dk-settings-row"><input type="checkbox" checked={settings.showHolidays} onChange={(e) => patchSetting({ showHolidays: e.target.checked })} /> 节假日 / 补班</label>
              <label className="dk-settings-row"><input type="checkbox" checked={settings.showLunar} onChange={(e) => patchSetting({ showLunar: e.target.checked })} /> 农历</label>
              <label className="dk-settings-row"><input type="checkbox" checked={settings.showFestival} onChange={(e) => patchSetting({ showFestival: e.target.checked })} /> 节日</label>
              <label className="dk-settings-row"><input type="checkbox" checked={settings.showJieqi} onChange={(e) => patchSetting({ showJieqi: e.target.checked })} /> 24 节气</label>
              <label className="dk-settings-row"><input type="checkbox" checked={settings.showJiyi} onChange={(e) => patchSetting({ showJiyi: e.target.checked })} /> 宜忌黄历</label>
            </section>
            <section className="dk-settings-section">
              <h4>外观</h4>
              <label className="dk-settings-row">背景玻璃<input type="checkbox" checked={settings.glass} onChange={(e) => patchSetting({ glass: e.target.checked })} /></label>
              <label className="dk-settings-row">透明度 <input type="range" min={0.3} max={1} step={0.01} value={settings.opacity} onChange={(e) => patchSetting({ opacity: Number(e.target.value) })} /> {Math.round(settings.opacity * 100)}%</label>
              <label className="dk-settings-row">背景色 <input type="color" value={settings.bgColor || "#f3efe6"} onChange={(e) => patchSetting({ bgColor: e.target.value })} /></label>
            </section>
            <section className="dk-settings-section">
              <h4>颜色</h4>
              <label className="dk-settings-row">日历文字 <input type="color" value={settings.colors.calendar || "#111111"} onChange={(e) => patchSetting({ colors: { ...settings.colors, calendar: e.target.value } })} /></label>
              <label className="dk-settings-row">单元格背景 <input type="color" value={settings.colors.cell || "#f8f9f7"} onChange={(e) => patchSetting({ colors: { ...settings.colors, cell: e.target.value } })} /></label>
              <label className="dk-settings-row">今天边框 <input type="color" value={settings.colors.todayBorder || "#b8860b"} onChange={(e) => patchSetting({ colors: { ...settings.colors, todayBorder: e.target.value } })} /></label>
              <label className="dk-settings-row">农历文字 <input type="color" value={settings.colors.lunar || "#888888"} onChange={(e) => patchSetting({ colors: { ...settings.colors, lunar: e.target.value } })} /></label>
              <label className="dk-settings-row">节假日文字 <input type="color" value={settings.colors.holiday || "#c0392b"} onChange={(e) => patchSetting({ colors: { ...settings.colors, holiday: e.target.value } })} /></label>
            </section>
            <section className="dk-settings-section">
              <h4>通用</h4>
              <label className="dk-settings-row">开机自启<input type="checkbox" checked={settings.autoStart} onChange={(e) => patchSetting({ autoStart: e.target.checked })} /></label>
            </section>
            <div className="dk-form-actions"><button type="button" onClick={() => setShowSettings(false)}>关闭</button></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(<DeskCalendar />);
}
