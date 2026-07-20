import type {
  CampusCourseSession,
  CampusReminder,
  PluginComponentProps
} from "@campusos/shared";

export { manifest } from "./manifest";

const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit"
});

const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
});

const formatTimeRange = (course: CampusCourseSession): string =>
  `${timeFormatter.format(new Date(course.startAt))} - ${timeFormatter.format(new Date(course.endAt))}`;

const formatReminder = (reminder: CampusReminder): string =>
  `${dateTimeFormatter.format(new Date(reminder.fireAt))} / 提前 ${reminder.leadMinutes} 分钟`;

const renderEmptyState = (title: string, detail: string): JSX.Element => (
  <li className="data-row">
    <div>
      <strong>{title}</strong>
      <span className="meta-line">{detail}</span>
    </div>
  </li>
);

export const Component = ({
  loading,
  snapshot
}: PluginComponentProps): JSX.Element => {
  if (!snapshot) {
    return (
      <section className="page">
        <header className="page-header">
          <div>
            <p className="eyebrow">Calendar</p>
            <h1>桌面课程与提醒总览</h1>
          </div>
          <p className="page-copy">
            {loading
              ? "正在从本地工作台加载课程、DDL 和提醒队列。"
              : "工作台快照暂时还没有加载完成。"}
          </p>
        </header>
      </section>
    );
  }

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Calendar</p>
          <h1>桌面课程与提醒总览</h1>
        </div>
        <p className="page-copy">
          这里直接消费统一工作台快照，把今天课程、临近截止和提醒队列放到同一个桌面视图里。
        </p>
      </header>

      <div className="card-grid">
        <article className="panel-card">
          <h2>Today</h2>
          <ul className="data-list">
            {snapshot.todayCourses.length > 0
              ? snapshot.todayCourses.map((course) => (
                  <li key={course.id} className="data-row">
                    <div>
                      <strong>{course.title}</strong>
                      <span className="meta-line">{course.location}</span>
                    </div>
                    <div className="row-side">
                      <strong>{formatTimeRange(course)}</strong>
                      <span className="meta-line">{course.instructor ?? "待补充教师信息"}</span>
                    </div>
                  </li>
                ))
              : renderEmptyState("今天没有课程快照", "如果教务处账号尚未配置，这里会保持为空。")}
          </ul>
        </article>

        <article className="panel-card">
          <h2>Next reminders</h2>
          <ul className="data-list">
            {snapshot.reminders.slice(0, 6).length > 0
              ? snapshot.reminders.slice(0, 6).map((reminder) => (
                  <li key={reminder.id} className="data-row">
                    <div>
                      <strong>{reminder.title}</strong>
                      <span className="meta-line">
                        {reminder.location ?? "桌面通知"} / {reminder.kind}
                      </span>
                    </div>
                    <div className="row-side">
                      <strong>{formatReminder(reminder)}</strong>
                      <span className="meta-line">{reminder.sourceId}</span>
                    </div>
                  </li>
                ))
              : renderEmptyState("当前没有待排程提醒", "可以去设置页检查提醒开关和提前分钟数。")}
          </ul>
        </article>
      </div>

      <article className="panel-card">
        <h2>Due soon</h2>
        <ul className="data-list">
          {snapshot.deadlines.slice(0, 5).length > 0
            ? snapshot.deadlines.slice(0, 5).map((deadline) => (
                <li key={deadline.id} className="data-row">
                  <div>
                    <strong>{deadline.title}</strong>
                    <span className="meta-line">
                      {deadline.courseName ?? "通用待办"} / {deadline.priority}
                    </span>
                  </div>
                  <div className="row-side">
                    <strong>{dateTimeFormatter.format(new Date(deadline.dueAt))}</strong>
                    <span className="meta-line">{deadline.sourceId}</span>
                  </div>
                </li>
              ))
            : renderEmptyState("没有临近截止事项", "工作台同步后，近期待办会显示在这里。")}
        </ul>
      </article>
    </section>
  );
};
