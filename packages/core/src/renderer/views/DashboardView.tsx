import type {
  CampusCourseSession,
  CampusDeadline,
  CampusPriority,
  CampusWorkspaceSnapshot
} from "@campusos/shared";
import { useEffect, useRef, useState } from "react";
import {
  formatDateTime,
  formatRelativeToNow,
  formatTimeRange
} from "../lib/formatters";
import { Skeleton } from "../components/ui/skeleton";
import { Button } from "../components/ui/button";
import {
  exportElementAsPng,
  exportViewAsMarkdown
} from "../lib/exportView";

interface DashboardViewProps {
  loading: boolean;
  snapshot: CampusWorkspaceSnapshot | null;
  deskCalendar?: {
    loadSettings: () => Promise<import("@campusos/shared").DeskCalendarSettings>;
    subscribe: (listener: () => void) => () => void;
  };
}

interface MakeupDayInfo {
  date: string;
  weekday: number;
  source: "builtin" | "manual";
}

interface HolidayInfo {
  date: string;
  label: string;
}

type CourseState = "complete" | "current" | "next" | "later";

const pageDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "long",
  day: "numeric",
  weekday: "long"
});

const priorityLabelMap: Record<CampusPriority, string> = {
  routine: "常规",
  important: "重要",
  urgent: "紧急"
};

const deadlineKindLabelMap: Record<CampusDeadline["kind"], string> = {
  assignment: "作业",
  exam: "考试",
  workflow: "事项"
};

const getCourseStates = (
  courses: CampusCourseSession[],
  now: number
): Map<string, CourseState> => {
  const states = new Map<string, CourseState>();
  let nextCourseFound = false;

  for (const course of courses) {
    const startsAt = Date.parse(course.startAt);
    const endsAt = Date.parse(course.endAt);

    if (now >= startsAt && now <= endsAt) {
      states.set(course.id, "current");
    } else if (endsAt < now) {
      states.set(course.id, "complete");
    } else if (!nextCourseFound) {
      states.set(course.id, "next");
      nextCourseFound = true;
    } else {
      states.set(course.id, "later");
    }
  }

  return states;
};

const sortCourses = (courses: CampusCourseSession[]): CampusCourseSession[] =>
  [...courses].sort(
    (left, right) => Date.parse(left.startAt) - Date.parse(right.startAt)
  );

const sortDeadlines = (deadlines: CampusDeadline[]): CampusDeadline[] =>
  [...deadlines].sort(
    (left, right) => Date.parse(left.dueAt) - Date.parse(right.dueAt)
  );

const DashboardSkeleton = (): JSX.Element => (
  <section className="page-shell" aria-busy="true" aria-label="正在加载总览">
    <header className="page-heading">
      <div>
        <Skeleton className="h-9 w-28" />
        <Skeleton className="mt-3 h-4 w-40" />
      </div>
    </header>
    <div className="dashboard-layout">
      <div className="content-section">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="mt-4 h-80 w-full" />
      </div>
      <div className="content-section">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="mt-4 h-80 w-full" />
      </div>
    </div>
  </section>
);

export const DashboardView = ({
  loading,
  snapshot,
  deskCalendar
}: DashboardViewProps): JSX.Element => {
  const [makeupDays, setMakeupDays] = useState<MakeupDayInfo[]>([]);
  const [holidays, setHolidays] = useState<HolidayInfo[]>([]);
  const pageRef = useRef<HTMLElement | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    if (!deskCalendar) return undefined;
    const load = (): void => {
      void deskCalendar.loadSettings().then((record) => {
        setMakeupDays(record.makeupDays ?? []);
        setHolidays(record.statutoryHolidays ?? []);
      }).catch(() => undefined);
    };
    load();
    return deskCalendar.subscribe(load);
  }, [deskCalendar]);

  if (!snapshot) {
    return loading ? (
      <DashboardSkeleton />
    ) : (
      <section className="page-shell">
        <header className="page-heading">
          <div>
            <h1>总览</h1>
          </div>
        </header>
        <div className="quiet-empty-state">暂无数据</div>
      </section>
    );
  }

  const now = Date.parse(snapshot.generatedAt);
  const courses = sortCourses(snapshot.todayCourses);
  const courseStates = getCourseStates(courses, now);
  const deadlines = sortDeadlines(snapshot.deadlines);

  const exportMarkdown = async (): Promise<void> => {
    setExportBusy(true);
    setExportError(null);
    try {
      const courseRows = courses.map((course) => [
        formatTimeRange(course.startAt, course.endAt),
        course.title,
        course.location ?? "-",
        [course.instructor, course.courseCode].filter(Boolean).join(" · ") || "-"
      ]);
      const deadlineRows = deadlines.map((deadline) => [
        formatDateTime(deadline.dueAt),
        deadline.title,
        deadline.courseName ?? deadlineKindLabelMap[deadline.kind],
        priorityLabelMap[deadline.priority]
      ]);
      await exportViewAsMarkdown(
        {
          title: "总览导出",
          generatedAt: snapshot.generatedAt,
          sections: [
            {
              heading: "今日课程",
              rows: [
                ["时间", "课程", "地点", "教师 / 课号"],
                ...courseRows
              ]
            },
            {
              heading: "待办",
              rows: [
                ["截止", "事项", "课程", "优先级"],
                ...deadlineRows
              ]
            }
          ]
        },
        `总览导出-${new Date().toISOString().slice(0, 10)}`
      );
    } catch (cause) {
      setExportError(cause instanceof Error ? cause.message : "Markdown 导出失败。");
    } finally {
      setExportBusy(false);
    }
  };

  const exportPng = async (): Promise<void> => {
    setExportBusy(true);
    setExportError(null);
    try {
      const element = pageRef.current;
      if (!element) throw new Error("总览视图暂不可导出。");
      await exportElementAsPng(
        element,
        `总览导出-${new Date().toISOString().slice(0, 10)}`
      );
    } catch (cause) {
      setExportError(cause instanceof Error ? cause.message : "图片导出失败。");
    } finally {
      setExportBusy(false);
    }
  };

  return (
    <section className="page-shell" ref={pageRef}>
      <header className="page-heading">
        <div>
          <h1>总览</h1>
          <p>{pageDateFormatter.format(new Date(snapshot.generatedAt))}</p>
        </div>
        <div className="term-context">
          <strong>{snapshot.term.label}</strong>
          <span>
            {snapshot.term.phase === "active" && snapshot.term.currentWeek
              ? `第 ${snapshot.term.currentWeek} 周`
              : snapshot.term.phase === "active"
                ? "学期进行中"
              : snapshot.term.phase === "upcoming"
                ? "未开始"
                : snapshot.term.phase === "unavailable"
                  ? "校历不可用"
                  : snapshot.term.currentWeek
                    ? `第 ${snapshot.term.currentWeek} 周 · 开发数据`
                    : "开发数据"}
          </span>
        </div>
        <div className="schedule-actions">
          <Button
            variant="ghost"
            type="button"
            disabled={exportBusy}
            onClick={() => void exportMarkdown()}
          >
            导出 MD
          </Button>
          <Button
            variant="ghost"
            type="button"
            disabled={exportBusy}
            onClick={() => void exportPng()}
          >
            导出图片
          </Button>
        </div>
      </header>
      {exportError ? (
        <p className="error-copy" role="alert">{exportError}</p>
      ) : null}

      <div className="dashboard-layout">
        <section className="content-section schedule-section" aria-labelledby="today-heading">
          <header className="section-heading">
            <h2 id="today-heading">今日事项预览</h2>
            <span>{courses.length} 项</span>
          </header>

          {courses.length === 0 ? (
            <div className="quiet-empty-state quiet-empty-compact">今日暂无课程安排</div>
          ) : (
            <ol className="course-timeline">
              {courses.map((course) => {
                const state = courseStates.get(course.id) ?? "later";
                const stateLabel =
                  state === "current" ? "进行中" : state === "next" ? "下一节" : null;

                return (
                  <li key={course.id} className={`course-item is-${state}`}>
                    <div className="course-time">
                      <strong>{formatTimeRange(course.startAt, course.endAt)}</strong>
                      {stateLabel ? <span>{stateLabel}</span> : null}
                    </div>
                    <div className="timeline-marker" aria-hidden="true">
                      <span />
                    </div>
                    <div className="course-content">
                      <strong>{course.title}</strong>
                      <span>{course.location}</span>
                      {course.instructor || course.courseCode ? (
                        <small>
                          {[course.instructor, course.courseCode].filter(Boolean).join(" · ")}
                        </small>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section className="content-section todo-section" aria-labelledby="todo-heading">
          <header className="section-heading">
            <h2 id="todo-heading">待办</h2>
            <span>{deadlines.length} 项</span>
          </header>

          {deadlines.length === 0 ? (
            <div className="quiet-empty-state quiet-empty-compact">暂无待办</div>
          ) : (
            <ol className="todo-list">
              {deadlines.map((deadline) => (
                <li key={deadline.id} className="todo-item">
                  <span
                    className={`priority-mark priority-${deadline.priority}`}
                    aria-label={priorityLabelMap[deadline.priority]}
                  />
                  <div className="todo-content">
                    <strong>{deadline.title}</strong>
                    <span>
                      {deadline.courseName ?? deadlineKindLabelMap[deadline.kind]}
                    </span>
                  </div>
                  <div className="todo-deadline">
                    <strong>{formatRelativeToNow(deadline.dueAt)}</strong>
                    <span>{formatDateTime(deadline.dueAt)}</span>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        {makeupDays.length > 0 || holidays.length > 0 ? (
          <section className="content-section makeup-card" aria-labelledby="makeup-heading">
            <header className="section-heading">
              <h2 id="makeup-heading">本周调休</h2>
              <span>仅提醒 · 以校历为准</span>
            </header>
            <div className="makeup-card-body">
              {holidays.map((holiday) => (
                <p key={`h-${holiday.date}`}><strong>{holiday.date.slice(5, 7)}月{holiday.date.slice(8, 10)}日</strong> {holiday.label}</p>
              ))}
              {makeupDays.map((makeup) => (
                <p key={`m-${makeup.date}`}><strong>{makeup.date.slice(5, 7)}月{makeup.date.slice(8, 10)}日</strong> 补{["周一", "周二", "周三", "周四", "周五", "周六", "周日"][makeup.weekday - 1]}的课</p>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </section>
  );
};
