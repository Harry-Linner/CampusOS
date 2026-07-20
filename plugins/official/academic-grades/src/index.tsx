import { useEffect, useState } from "react";
import type {
  AcademicGradesData,
  CapabilityDataState,
  CapabilityRecord,
  PluginComponentProps
} from "@campusos/shared";
import { inferGpaScale, summarizeAcademicGrades } from "./model";

export { manifest } from "./manifest";

const numberFormatter = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 2
});

const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
});

const stateLabels: Record<CapabilityDataState, string> = {
  live: "实时获取",
  cache: "本地缓存",
  fallback: "回退数据",
  unavailable: "当前不可用"
};

const aggregateState = (
  records: readonly CapabilityRecord<AcademicGradesData>[]
): CapabilityDataState => {
  if (records.length === 0) return "unavailable";
  const states = records.map((record) => record.state);
  if (states.every((state) => state === "live")) return "live";
  if (states.every((state) => state === "unavailable")) return "unavailable";
  if (states.every((state) => state === "cache")) return "cache";
  return "fallback";
};

export const Component = ({
  capabilities,
  loading: workspaceLoading,
  onRefresh,
  snapshot
}: PluginComponentProps): JSX.Element => {
  const [records, setRecords] = useState<CapabilityRecord<AcademicGradesData>[]>(
    []
  );
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshRequest, setRefreshRequest] = useState(0);
  const [privacyMask, setPrivacyMask] = useState(true);

  useEffect(() => {
    let active = true;
    setLoaded(false);

    void capabilities.read<AcademicGradesData>("academic.grades@1")
      .then((records) => {
        if (!active) return;
        setRecords(records);
        setError(null);
      })
      .catch((nextError: unknown) => {
        if (!active) return;
        setError(
          nextError instanceof Error ? nextError.message : "成绩数据读取失败。"
        );
      })
      .finally(() => {
        if (active) setLoaded(true);
      });

    return () => {
      active = false;
    };
  }, [capabilities, refreshRequest, snapshot?.generatedAt]);

  const handleRefresh = async (): Promise<void> => {
    setRefreshing(true);
    try {
      await onRefresh();
      setRefreshRequest((current) => current + 1);
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "成绩刷新失败。"
      );
    } finally {
      setRefreshing(false);
    }
  };

  const grades = records.flatMap((record) =>
    (record.data?.grades ?? []).map((grade) => ({
      ...grade,
      sourceId: `${record.providerId}:${grade.sourceId}`
    }))
  );
  const summary = summarizeAcademicGrades(grades);
  const gpaScale = inferGpaScale(grades);
  const busy = !loaded || workspaceLoading || refreshing;
  const availableRecords = records.filter((record) => record.data !== null);
  const state = aggregateState(records);
  const updatedAt = records
    .map((record) => record.updatedAt)
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort()
    .at(-1) ?? null;

  return (
    <section className="page academic-grades-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Academic records</p>
          <h1>学业成绩</h1>
        </div>
        <div className="grade-header-actions">
          <label className="setting-switch" title={privacyMask ? "点击显示原始成绩" : "点击隐藏原始成绩"}>
            <input
              type="checkbox"
              checked={privacyMask}
              onChange={(event) => setPrivacyMask(event.target.checked)}
            />
            <span className="switch-track" aria-hidden="true">
              <span />
            </span>
            <span>隐私遮罩</span>
          </label>
          <button
            className="primary-button"
            disabled={busy}
            type="button"
            onClick={() => void handleRefresh()}
          >
            {refreshing ? "正在刷新" : "刷新成绩"}
          </button>
        </div>
      </header>

      {error ? (
        <article className="panel-card" role="alert">
          <h2>成绩读取失败</h2>
          <p className="muted">{error}</p>
        </article>
      ) : null}

      {!loaded ? (
        <article className="panel-card" aria-live="polite">
          <h2>正在读取</h2>
          <p className="muted">正在通过插件能力绑定读取当前账号的成绩记录。</p>
        </article>
      ) : null}

      {loaded && availableRecords.length === 0 ? (
        <article className="panel-card">
          <h2>暂无可用成绩</h2>
          <p className="muted">
            {records.map((record) => record.message).find(Boolean) ??
              "请先在设置页连接并验证统一身份认证账号。"}
          </p>
        </article>
      ) : null}

      {loaded && availableRecords.length > 0 ? (
        <>
          <div className="grade-summary-grid">
            <article className="grade-summary-card">
              <span>课程记录</span>
              <strong>{summary.courseCount}</strong>
            </article>
            <article className="grade-summary-card">
              <span>课程学分</span>
              <strong>{numberFormatter.format(summary.totalCredits)}</strong>
            </article>
            <article className="grade-summary-card">
              <span>加权绩点 · {gpaScale} 制</span>
              <strong>
                {summary.weightedGradePoint === null
                  ? "暂无"
                  : numberFormatter.format(summary.weightedGradePoint)}
              </strong>
            </article>
            <article className="grade-summary-card">
              <span>主修加权绩点</span>
              <strong>
                {summary.majorWeightedGradePoint === null
                  ? "暂无"
                  : numberFormatter.format(summary.majorWeightedGradePoint)}
              </strong>
            </article>
          </div>

          <div className="badge-row" aria-label="成绩数据来源">
            <span className="badge">{stateLabels[state]}</span>
            {updatedAt ? (
              <span className="badge">
                更新于 {dateTimeFormatter.format(new Date(updatedAt))}
              </span>
            ) : null}
            <span className="badge">{availableRecords.length} 个学业数据源</span>
            <span className="badge">
              绩点覆盖 {numberFormatter.format(summary.gradedCredits)} 学分
            </span>
            <span className="badge">
              主修 {numberFormatter.format(summary.majorGradedCredits)} 学分
            </span>
          </div>
          <p className="muted grade-method-note">
            加权绩点仅使用教务接口明确返回的绩点与学分；缺少绩点的课程不会被推算。
          </p>

          {summary.terms.length === 0 ? (
            <article className="panel-card">
              <h2>当前没有成绩记录</h2>
              <p className="muted">数据源已连接，但本次返回的成绩列表为空。</p>
            </article>
          ) : null}

          {summary.terms.map((term) => (
            <article key={term.key} className="panel-card">
              <div className="grade-term-heading">
                <h2>{term.label}</h2>
                <span>{numberFormatter.format(term.credits)} 学分</span>
              </div>
              <ul className="data-list">
                {term.grades.map((grade) => (
                  <li key={grade.sourceId} className="data-row">
                    <div>
                      <strong>
                        {grade.courseName}
                        {grade.isMajorCourse ? (
                          <span className="grade-major-tag">主修</span>
                        ) : null}
                      </strong>
                      <span className="meta-line">
                        {grade.courseCode ?? "课程代码未返回"} / {numberFormatter.format(grade.credit)} 学分
                        {grade.courseCategory ? ` · ${grade.courseCategory}` : ""}
                      </span>
                    </div>
                    <div className="row-side">
                      <strong>
                        {privacyMask
                          ? "***"
                          : (grade.originalScore || "未返回成绩")}
                      </strong>
                      <span className="meta-line">
                        {grade.gradePoint === null
                          ? "绩点未返回"
                          : `绩点 ${numberFormatter.format(grade.gradePoint)}`}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </>
      ) : null}
    </section>
  );
};
