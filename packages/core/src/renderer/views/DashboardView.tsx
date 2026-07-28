import type {
  CampusCourseSession,
  CampusDeadline,
  CampusPriority,
  CampusWorkspaceSnapshot
} from "@campusos/shared";
import {
  formatDateTime,
  formatRelativeToNow,
  formatTimeRange
} from "../lib/formatters";

interface DashboardViewProps {
  loading: boolean;
  snapshot: CampusWorkspaceSnapshot | null;
}

type CourseState = "complete" | "current" | "next" | "later";

const pageDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "long",
  day: "numeric",
  weekday: "long"
});

const weekdayFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  weekday: "long"
});

const shanghaiDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
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

const toShanghaiDateKey = (dateTime: string): string => {
  const values = Object.fromEntries(
    shanghaiDateFormatter
      .formatToParts(new Date(dateTime))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  return `${values.year}-${values.month}-${values.day}`;
};

const weekdayIndex = (dateKey: string): number =>
  new Date(`${dateKey}T00:00:00Z`).getUTCDay();

const selectUpcomingWeekdayPreview = (
  courses: CampusCourseSession[],
  generatedAt: string
): CampusCourseSession[] => {
  const now = Date.parse(generatedAt);
  const futureCourses = sortCourses(courses).filter(
    (course) => Date.parse(course.startAt) > now
  );
  const currentWeekday = weekdayIndex(toShanghaiDateKey(generatedAt));
  const matchingCourses = futureCourses.filter(
    (course) => weekdayIndex(toShanghaiDateKey(course.startAt)) === currentWeekday
  );
  const previewDate = matchingCourses[0]
    ? toShanghaiDateKey(matchingCourses[0].startAt)
    : null;
  if (previewDate === null) return [];

  // Use the first real occurrence of today's weekday in the upcoming term;
  // late-week term starts therefore cannot point the preview before classes begin.
  return matchingCourses.filter(
    (course) => toShanghaiDateKey(course.startAt) === previewDate
  );
};

const sortDeadlines = (deadlines: CampusDeadline[]): CampusDeadline[] =>
  [...deadlines].sort(
    (left, right) => Date.parse(left.dueAt) - Date.parse(right.dueAt)
  );

const DashboardSkeleton = (): JSX.Element => (
  <section className="page-shell" aria-busy="true" aria-label="正在加载总览">
    <header className="page-heading">
      <div>
        <div className="skeleton-line skeleton-title" />
        <div className="skeleton-line skeleton-copy" />
      </div>
    </header>
    <div className="dashboard-layout">
      <div className="content-section">
        <div className="skeleton-line skeleton-section" />
        <div className="skeleton-block skeleton-tall" />
      </div>
      <div className="content-section">
        <div className="skeleton-line skeleton-section" />
        <div className="skeleton-block skeleton-tall" />
      </div>
    </div>
  </section>
);

export const DashboardView = ({
  loading,
  snapshot
}: DashboardViewProps): JSX.Element => {
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
  const isUpcomingPreview = snapshot.term.phase === "upcoming";
  const courses = sortCourses(
    isUpcomingPreview
      ? selectUpcomingWeekdayPreview(snapshot.courses, snapshot.generatedAt)
      : snapshot.todayCourses
  );
  const courseStates = isUpcomingPreview
    ? new Map<string, CourseState>()
    : getCourseStates(courses, now);
  const deadlines = sortDeadlines(snapshot.deadlines);
  const weekdayLabel = weekdayFormatter
    .format(new Date(snapshot.generatedAt))
    .replace("星期", "周");
  const courseHeading = isUpcomingPreview
    ? `下学期${weekdayLabel}预览`
    : "今日课程";

  return (
    <section className="page-shell">
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
              : snapshot.term.phase === "upcoming"
                ? "未开始"
                : snapshot.term.phase === "unavailable"
                  ? "校历不可用"
                  : snapshot.term.currentWeek
                    ? `第 ${snapshot.term.currentWeek} 周 · mock`
                    : "mock"}
          </span>
        </div>
      </header>

      <div className="dashboard-layout">
        <section className="content-section schedule-section" aria-labelledby="today-heading">
          <header className="section-heading">
            <h2 id="today-heading">{courseHeading}</h2>
            <span>{courses.length} 节课</span>
          </header>

          {courses.length === 0 ? (
            <div className="quiet-empty-state quiet-empty-compact">
              {isUpcomingPreview ? `${courseHeading}没有课程` : "今日没有课程"}
            </div>
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
      </div>
    </section>
  );
};
