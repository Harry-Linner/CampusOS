import { useMemo, useState } from "react";
import type {
  CampusPriority,
  CampusSourceId,
  CampusWorkspaceSnapshot
} from "@campusos/shared";
import { firstWaveSourceCatalog } from "@campusos/shared";
import { AppIcon } from "../components/AppIcon";
import { formatDateTime, formatTimeRange } from "../lib/formatters";

interface CalendarViewProps {
  loading: boolean;
  snapshot: CampusWorkspaceSnapshot | null;
}

type CalendarViewMode = "month" | "agenda" | "day";

type CalendarTask =
  | {
      id: string;
      title: string;
      kind: "course";
      at: string;
      startAt: string;
      endAt: string;
      location: string;
      sourceId: CampusSourceId;
      note?: string;
      instructor?: string;
    }
  | {
      id: string;
      title: string;
      kind: "deadline";
      at: string;
      dueAt: string;
      sourceId: CampusSourceId;
      priority: CampusPriority;
      courseName?: string;
      note?: string;
    };

type CalendarTaskVariant = "month" | "agenda" | "day";

interface CalendarTaskButtonProps {
  task: CalendarTask;
  variant: CalendarTaskVariant;
  selected: boolean;
  onToggle: (id: string) => void;
}

const weekdayLabels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const fullDayHours = Array.from({ length: 24 }, (_, hour) => hour);

const monthLabelFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long"
});

const timeLabelFormatter = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit"
});

const dayNumberFormatter = new Intl.DateTimeFormat("zh-CN", {
  day: "numeric"
});

const priorityLabelMap: Record<CampusPriority, string> = {
  routine: "常规",
  important: "重要",
  urgent: "紧急"
};

const sourceLabelMap = new Map<CampusSourceId, string>(
  firstWaveSourceCatalog.map((source) => [source.id, source.shortLabel] as const)
);

const addDays = (value: Date, days: number): Date => {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
};

const addMonths = (value: Date, months: number): Date => {
  const next = new Date(value);
  next.setMonth(next.getMonth() + months);
  return next;
};

const alignDateToMonth = (value: Date, month: Date): Date => {
  const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  return new Date(
    month.getFullYear(),
    month.getMonth(),
    Math.min(value.getDate(), lastDay)
  );
};

const startOfMonth = (value: Date): Date =>
  new Date(value.getFullYear(), value.getMonth(), 1);

const startOfWeek = (value: Date): Date => {
  const day = value.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return new Date(value.getFullYear(), value.getMonth(), value.getDate() + diff);
};

const isSameMonth = (left: Date, right: Date): boolean =>
  left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth();

const toDayKey = (value: Date | string): string => {
  const date = typeof value === "string" ? new Date(value) : value;
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
};

const getWeekdayLabel = (value: Date): string => weekdayLabels[(value.getDay() + 6) % 7];

const formatDateHeading = (value: Date): string =>
  `${value.getMonth() + 1}月${value.getDate()}日 ${getWeekdayLabel(value)}`;

const buildMonthGrid = (month: Date): Date[] => {
  const firstVisibleDay = startOfWeek(startOfMonth(month));
  return Array.from({ length: 42 }, (_, index) => addDays(firstVisibleDay, index));
};

const buildCalendarTasks = (snapshot: CampusWorkspaceSnapshot): CalendarTask[] =>
  [
    ...snapshot.courses.map((course) => ({
      id: course.id,
      title: course.title,
      kind: "course" as const,
      at: course.startAt,
      startAt: course.startAt,
      endAt: course.endAt,
      location: course.location,
      sourceId: course.sourceId,
      note: course.note,
      instructor: course.instructor
    })),
    ...snapshot.deadlines.map((deadline) => ({
      id: deadline.id,
      title: deadline.title,
      kind: "deadline" as const,
      at: deadline.dueAt,
      dueAt: deadline.dueAt,
      sourceId: deadline.sourceId,
      priority: deadline.priority,
      courseName: deadline.courseName,
      note: deadline.note
    }))
  ].sort((left, right) => Date.parse(left.at) - Date.parse(right.at));

const groupTasksByDay = (tasks: CalendarTask[]): Map<string, CalendarTask[]> => {
  const groups = new Map<string, CalendarTask[]>();

  for (const task of tasks) {
    const key = toDayKey(task.at);
    const current = groups.get(key) ?? [];
    current.push(task);
    groups.set(key, current);
  }

  return groups;
};

const getTaskTone = (task: CalendarTask): string => {
  const value = task.kind === "course" ? task.title : task.courseName ?? task.sourceId;
  const hash = Array.from(value).reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return `course-tone-${hash % 6}`;
};

const getTaskMeta = (task: CalendarTask): string =>
  task.kind === "course"
    ? timeLabelFormatter.format(new Date(task.startAt))
    : timeLabelFormatter.format(new Date(task.dueAt));

const getTaskTimeRange = (task: CalendarTask): string =>
  task.kind === "course"
    ? formatTimeRange(task.startAt, task.endAt)
    : `截止 ${timeLabelFormatter.format(new Date(task.dueAt))}`;

const getTaskContext = (task: CalendarTask): string => {
  if (task.kind === "course") {
    return task.location;
  }

  return [task.courseName, sourceLabelMap.get(task.sourceId)].filter(Boolean).join(" · ") || "待提交";
};

const CalendarTaskPopover = ({ task }: { task: CalendarTask }): JSX.Element => (
  <span className="calendar-popover" role="tooltip">
    <strong>{task.title}</strong>
    {task.kind === "course" ? (
      <span className="popover-details">
        <span>
          <small>时间</small>
          {formatTimeRange(task.startAt, task.endAt)}
        </span>
        <span>
          <small>地点</small>
          {task.location}
        </span>
        {task.instructor ? (
          <span>
            <small>教师</small>
            {task.instructor}
          </span>
        ) : null}
        {task.note ? (
          <span>
            <small>准备</small>
            {task.note}
          </span>
        ) : null}
      </span>
    ) : (
      <span className="popover-details">
        <span>
          <small>截止</small>
          {formatDateTime(task.dueAt)}
        </span>
        <span>
          <small>提交</small>
          {[task.courseName, sourceLabelMap.get(task.sourceId)].filter(Boolean).join(" · ")}
        </span>
        <span>
          <small>优先级</small>
          {priorityLabelMap[task.priority]}
        </span>
        {task.note ? (
          <span>
            <small>要求</small>
            {task.note}
          </span>
        ) : null}
      </span>
    )}
  </span>
);

const CalendarTaskButton = ({
  task,
  variant,
  selected,
  onToggle
}: CalendarTaskButtonProps): JSX.Element => {
  const className = [
    variant === "month" ? "calendar-event" : `${variant}-event`,
    getTaskTone(task),
    task.kind === "deadline" ? "is-deadline" : "",
    selected ? "is-open" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      className={className}
      type="button"
      aria-expanded={selected}
      onClick={() => onToggle(task.id)}
    >
      {variant === "month" ? (
        <>
          <span className="calendar-event-time">{getTaskMeta(task)}</span>
          <span className="calendar-event-title">{task.title}</span>
        </>
      ) : (
        <>
          <span className={`${variant}-event-time`}>{getTaskTimeRange(task)}</span>
          <span className={`${variant}-event-copy`}>
            <span className={`${variant}-event-title`}>{task.title}</span>
            <span className={`${variant}-event-meta`}>{getTaskContext(task)}</span>
          </span>
        </>
      )}
      <CalendarTaskPopover task={task} />
    </button>
  );
};

const CalendarSkeleton = (): JSX.Element => (
  <section className="page-shell" aria-busy="true" aria-label="正在加载日历">
    <header className="page-heading">
      <div className="skeleton-line skeleton-title" />
    </header>
    <div className="skeleton-block skeleton-calendar" />
  </section>
);

export const CalendarView = ({
  loading,
  snapshot
}: CalendarViewProps): JSX.Element => {
  const [viewMode, setViewMode] = useState<CalendarViewMode>("month");
  const [visibleMonth, setVisibleMonth] = useState<Date>(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const monthDays = useMemo(() => buildMonthGrid(visibleMonth), [visibleMonth]);
  const calendarTasks = useMemo(
    () => (snapshot ? buildCalendarTasks(snapshot) : []),
    [snapshot]
  );
  const taskGroups = useMemo(() => groupTasksByDay(calendarTasks), [calendarTasks]);
  const agendaGroups = useMemo(
    () =>
      groupTasksByDay(
        calendarTasks.filter((task) => isSameMonth(new Date(task.at), visibleMonth))
      ),
    [calendarTasks, visibleMonth]
  );
  const selectedDayTasks = useMemo(
    () => calendarTasks.filter((task) => toDayKey(task.at) === toDayKey(selectedDate)),
    [calendarTasks, selectedDate]
  );
  const dayHourGroups = useMemo(
    () =>
      fullDayHours.map((hour) => ({
        hour,
        tasks: selectedDayTasks.filter((task) => new Date(task.at).getHours() === hour)
      })),
    [selectedDayTasks]
  );

  if (!snapshot) {
    return loading ? (
      <CalendarSkeleton />
    ) : (
      <section className="page-shell">
        <header className="page-heading">
          <div>
            <h1>日历</h1>
          </div>
        </header>
        <div className="quiet-empty-state">暂无日历数据</div>
      </section>
    );
  }

  const today = new Date();
  const todayKey = toDayKey(today);
  const isDayView = viewMode === "day";
  const periodLabel = isDayView ? formatDateHeading(selectedDate) : monthLabelFormatter.format(visibleMonth);
  const periodName = isDayView ? "日期" : "月份";

  const toggleTask = (id: string): void => {
    setSelectedTaskId((current) => (current === id ? null : id));
  };

  const changeView = (nextView: CalendarViewMode): void => {
    setSelectedTaskId(null);

    if (nextView === "day" && !isSameMonth(selectedDate, visibleMonth)) {
      setSelectedDate((current) => alignDateToMonth(current, visibleMonth));
    }

    setViewMode(nextView);
  };

  const changePeriod = (direction: -1 | 1): void => {
    setSelectedTaskId(null);

    if (isDayView) {
      const next = addDays(selectedDate, direction);
      setSelectedDate(next);
      setVisibleMonth(startOfMonth(next));
      return;
    }

    const nextMonth = addMonths(visibleMonth, direction);
    setVisibleMonth(nextMonth);
    setSelectedDate((current) => alignDateToMonth(current, nextMonth));
  };

  const returnToCurrentPeriod = (): void => {
    const nextToday = new Date();

    setSelectedTaskId(null);
    setVisibleMonth(startOfMonth(nextToday));
    setSelectedDate(nextToday);
  };

  return (
    <section className="page-shell calendar-page">
      <header className="page-heading calendar-page-heading">
        <div>
          <h1>日历</h1>
        </div>

        <div className="calendar-page-tools">
          <div className="calendar-view-switcher" role="group" aria-label="日历视图">
            {(
              [
                ["month", "月历"],
                ["agenda", "日程"],
                ["day", "日视图"]
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                className={viewMode === mode ? "is-active" : ""}
                type="button"
                aria-pressed={viewMode === mode}
                onClick={() => changeView(mode)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="calendar-controls" aria-label={`${periodName}导航`}>
            <button
              className="icon-button"
              type="button"
              aria-label={`上一个${periodName}`}
              onClick={() => changePeriod(-1)}
            >
              <AppIcon name="chevron-left" size={18} />
            </button>
            <strong>{periodLabel}</strong>
            <button
              className="icon-button"
              type="button"
              aria-label={`下一个${periodName}`}
              onClick={() => changePeriod(1)}
            >
              <AppIcon name="chevron-right" size={18} />
            </button>
            <button className="text-button" type="button" onClick={returnToCurrentPeriod}>
              {isDayView ? "本日" : "本月"}
            </button>
          </div>
        </div>
      </header>

      {viewMode === "month" ? (
        <div className="calendar-scroll">
          <div className="calendar-frame">
            <div className="calendar-weekdays" aria-hidden="true">
              {weekdayLabels.map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>

            <div className="calendar-grid">
              {monthDays.map((day) => {
                const dayKey = toDayKey(day);
                const tasks = taskGroups.get(dayKey) ?? [];
                const outsideMonth = !isSameMonth(day, visibleMonth);
                const isToday = dayKey === todayKey;

                return (
                  <section
                    key={dayKey}
                    className={[
                      "calendar-cell",
                      outsideMonth ? "is-outside" : "",
                      isToday ? "is-today" : ""
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    aria-label={`${day.getMonth() + 1}月${day.getDate()}日`}
                  >
                    <header className="calendar-cell-head">
                      <time dateTime={day.toISOString()}>
                        {dayNumberFormatter.format(day)}
                      </time>
                    </header>

                    <div className="calendar-events">
                      {tasks.map((task) => (
                        <CalendarTaskButton
                          key={task.id}
                          task={task}
                          variant="month"
                          selected={selectedTaskId === task.id}
                          onToggle={toggleTask}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {viewMode === "agenda" ? (
        <div className="agenda-view" aria-label={`${monthLabelFormatter.format(visibleMonth)}日程`}>
          {Array.from(agendaGroups.entries()).map(([dayKey, tasks]) => {
            const date = new Date(tasks[0].at);

            return (
              <section className="agenda-day" key={dayKey}>
                <header className="agenda-day-heading">
                  <time dateTime={date.toISOString()}>
                    <strong>{date.getDate()}</strong>
                    <span>{getWeekdayLabel(date)}</span>
                  </time>
                  <span>{date.getMonth() + 1}月</span>
                </header>
                <div className="agenda-day-events">
                  {tasks.map((task) => (
                    <CalendarTaskButton
                      key={task.id}
                      task={task}
                      variant="agenda"
                      selected={selectedTaskId === task.id}
                      onToggle={toggleTask}
                    />
                  ))}
                </div>
              </section>
            );
          })}

          {agendaGroups.size === 0 ? <div className="quiet-empty-state">本月没有安排</div> : null}
        </div>
      ) : null}

      {viewMode === "day" ? (
        <section className="day-view" aria-label={`${formatDateHeading(selectedDate)}日程`}>
          {dayHourGroups.map(({ hour, tasks }) => (
            <section className="day-hour" key={hour} aria-label={`${hour}点`}>
              <time className="day-hour-label">
                <span>{String(hour).padStart(2, "0")}:00</span>
              </time>
              <div className="day-hour-canvas">
                <div className="day-hour-events">
                  {tasks.map((task) => (
                    <CalendarTaskButton
                      key={task.id}
                      task={task}
                      variant="day"
                      selected={selectedTaskId === task.id}
                      onToggle={toggleTask}
                    />
                  ))}
                </div>
              </div>
            </section>
          ))}
        </section>
      ) : null}
    </section>
  );
};
