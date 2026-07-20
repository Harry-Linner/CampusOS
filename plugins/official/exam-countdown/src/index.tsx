import { useEffect, useState } from "react";
import type { CalendarEventsData, CapabilityRecord, PluginComponentProps } from "@campusos/shared";
import { computeExamCountdowns, type ExamCountdownEntry } from "./main";

export { manifest } from "./manifest";

export const Component = ({
  capabilities,
  loading: workspaceLoading,
  onRefresh
}: PluginComponentProps): JSX.Element => {
  const [entries, setEntries] = useState<ExamCountdownEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    let active = true;

    void capabilities.read<CalendarEventsData>("calendar.events@1")
      .then((records) => {
        if (!active) return;
        setEntries(computeExamCountdowns(records, new Date()));
        setError(null);
      })
      .catch((e: unknown) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : "考试数据读取失败。");
      })
      .finally(() => {
        if (active) setLoaded(true);
      });

    return () => { active = false; clearInterval(interval); };
  }, [capabilities]);

  const busy = !loaded || workspaceLoading;

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Countdown</p>
          <h1>考试倒计时</h1>
        </div>
        <button className="primary-button" disabled={busy} type="button" onClick={() => void onRefresh()}>
          刷新
        </button>
      </header>

      {error ? (
        <article className="panel-card" role="alert">
          <h2>读取失败</h2>
          <p className="muted">{error}</p>
        </article>
      ) : null}

      {loaded && entries.length === 0 ? (
        <article className="panel-card">
          <h2>暂无即将到来的考试</h2>
          <p className="muted">当前日历事件中没有未来时间的考试记录。</p>
        </article>
      ) : null}

      {entries.length > 0 ? (
        <ul className="data-list">
          {entries.map((entry) => (
            <li key={entry.eventId} className="data-row">
              <div>
                <strong>
                  {entry.examTitle}
                  {entry.isUrgent ? <span className="badge" style={{ color: "var(--danger)", marginLeft: 8 }}>临近</span> : null}
                </strong>
                <span className="meta-line">
                  {entry.courseName ?? "未知课程"}
                  {entry.location ? ` · ${entry.location}` : ""}
                </span>
              </div>
              <div className="row-side">
                <strong>
                  {entry.daysUntil > 0
                    ? `${entry.daysUntil} 天 ${entry.hoursUntil} 小时`
                    : `${entry.hoursUntil} 小时`}
                </strong>
                <span className="meta-line">
                  {new Date(entry.startAt).toLocaleDateString("zh-CN", {
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit"
                  })}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
};
