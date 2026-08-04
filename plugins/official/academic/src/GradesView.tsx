import { useEffect, useRef, useState } from "react";
import type {
  AcademicGradesData,
  CapabilityRecord,
  PluginComponentProps
} from "@campusos/shared";
import { inferGpaScale, summarizeAcademicGrades } from "./gradesModel";

const numberFormatter = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 2
});

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
  const [weights, setWeights] = useState<Record<string, number>>({});
  const savedWeights = useRef<Record<string, number>>({});
  const [weightError, setWeightError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoaded(false);

    const weightsPromise = window.campusos?.academic?.loadGpaWeights()
      .catch(() => ({ weights: {}, savedAt: null }));
    void Promise.all([
      capabilities.read<AcademicGradesData>("academic.grades@1"),
      weightsPromise ?? Promise.resolve({ weights: {}, savedAt: null })
    ])
      .then(([nextRecords, nextWeights]) => {
        if (!active) return;
        setRecords(nextRecords);
        setWeights(nextWeights.weights);
        savedWeights.current = nextWeights.weights;
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
  const summary = summarizeAcademicGrades(grades, new Map(Object.entries(weights)));
  const gpaScale = inferGpaScale(grades);
  const busy = !loaded || workspaceLoading || refreshing;
  const availableRecords = records.filter((record) => record.data !== null);

  const saveWeight = async (sourceId: string, value: string): Promise<void> => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
      setWeightError("权重必须是 0 到 100 之间的数值。");
      return;
    }
    const next = { ...weights, [sourceId]: parsed };
    setWeights(next);
    setWeightError(null);
    try {
      const saved = await window.campusos?.academic?.saveGpaWeights(next);
      if (saved) {
        savedWeights.current = saved.weights;
        setWeights(saved.weights);
      }
    } catch (nextError) {
      setWeights(savedWeights.current);
      setWeightError(nextError instanceof Error ? nextError.message : "权重保存失败。");
    }
  };

  return (
    <section className="page academic-grades-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Academic records</p>
          <h1>学业成绩</h1>
        </div>
        <div className="grade-header-actions">
          <label className="setting-switch" title={privacyMask ? "点击显示成绩与绩点" : "点击隐藏成绩与绩点"}>
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
      {weightError ? <p className="panel-error" role="alert">{weightError}</p> : null}

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
              <span>获得学分</span>
              <strong>{numberFormatter.format(summary.totalCredits)}</strong>
            </article>
            <article className="grade-summary-card">
              <span>加权绩点 · {gpaScale} 制</span>
              <strong>
                {privacyMask
                  ? "***"
                  : summary.weightedGradePoint === null
                  ? "暂无"
                  : numberFormatter.format(summary.weightedGradePoint)}
              </strong>
            </article>
            <article className="grade-summary-card">
              <span>主修加权绩点</span>
              <strong>
                {privacyMask
                  ? "***"
                  : summary.majorWeightedGradePoint === null
                  ? "暂无"
                  : numberFormatter.format(summary.majorWeightedGradePoint)}
              </strong>
            </article>
          </div>

          <section className="grade-gpa-matrix" aria-label="多口径 GPA">
            <div className="grade-gpa-matrix-heading"><strong>GPA 口径</strong><span>总成绩 / 主修成绩</span></div>
            {[
              ["五分制", summary.fivePointGpa, summary.majorFivePointGpa],
              ["4.3 制", summary.fourPointGpa, summary.majorFourPointGpa],
              ["原始四分制", summary.fourPointLegacyGpa, summary.majorFourPointLegacyGpa],
              ["百分制", summary.hundredPointGpa, summary.majorHundredPointGpa]
            ].map(([label, overall, major]) => <div key={String(label)} className="grade-gpa-matrix-row"><span>{label}</span><strong>{privacyMask ? "***" : overall === null ? "暂无" : numberFormatter.format(overall as number)}</strong><strong>{privacyMask ? "***" : major === null ? "暂无" : numberFormatter.format(major as number)}</strong></div>)}
          </section>

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
                        {grade.realId ?? grade.courseCode ?? "课程代码未返回"} / {numberFormatter.format(grade.credit)} 学分
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
                        {privacyMask
                          ? "***"
                          : grade.gradePoint === null
                          ? "绩点未返回"
                          : `绩点 ${numberFormatter.format(grade.gradePoint)}`}
                        </span>
                        <label className="grade-weight-control">
                          <span>权重</span>
                          <input
                            aria-label={`${grade.courseName} 权重`}
                            type="number"
                            min="0"
                            max="100"
                            step="0.05"
                            value={weights[grade.sourceId] ?? 1}
                            onChange={(event) => setWeights((current) => ({ ...current, [grade.sourceId]: Number(event.target.value) }))}
                            onBlur={(event) => void saveWeight(grade.sourceId, event.target.value)}
                          />
                        </label>
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
