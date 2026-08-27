import { useEffect, useMemo, useState } from "react";
import type {
  AcademicCalendarConfigData,
  AcademicCourseCatalogData,
  AcademicPracticeData,
  AcademicTimetableData,
  AcademicTimetableSessionContext,
  CapabilityRecord,
  PluginCapabilityClient,
  PluginComponentProps
} from "@campusos/shared";
import {
  academicSemesterKey,
  academicSemesterNumberForSeason,
  formatAcademicSemesterLabel,
  mergeAcademicTimetableSessions,
  selectAcademicSemesterWindow
} from "@campusos/shared";
import { Component as AcademicGradesView } from "./GradesView";
import { Component as ExamCountdownView } from "./ExamCountdownView";
import { Input } from "@/components/ui/input";

type AcademicSection = "timetable" | "courses" | "exams" | "grades" | "practice";

const academicSections: ReadonlyArray<{ id: AcademicSection; label: string }> = [
  { id: "timetable", label: "课表" },
  { id: "courses", label: "课程" },
  { id: "exams", label: "考试" },
  { id: "grades", label: "成绩" },
  { id: "practice", label: "素拓" }
];

const numberFormatter = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 2
});

const readRecords = async <T,>(
  capabilities: PluginCapabilityClient,
  capability: Parameters<PluginCapabilityClient["read"]>[0]
): Promise<CapabilityRecord<T>[]> => capabilities.read<T>(capability);

interface TimetableSemester {
  key: string;
  academicYearStart: number;
  semesterNumber: 1 | 2;
  label: string;
  sessions: AcademicTimetableSessionContext[];
}

const buildTimetableSemesters = (
  records: readonly CapabilityRecord<AcademicTimetableData>[]
): TimetableSemester[] => {
  const grouped = new Map<
    string,
    Omit<TimetableSemester, "label" | "sessions"> & {
      sessions: AcademicTimetableSessionContext[];
    }
  >();

  for (const record of records) {
    for (const term of record.data?.terms ?? []) {
      const semesterNumber = academicSemesterNumberForSeason(term.season);
      if (semesterNumber === null) continue;
      const key = academicSemesterKey(term.academicYearStart, semesterNumber);
      const semester = grouped.get(key) ?? {
        key,
        academicYearStart: term.academicYearStart,
        semesterNumber,
        sessions: []
      };
      for (const session of term.sessions) {
        semester.sessions.push({
          session,
          providerId: record.providerId,
          academicYearStart: term.academicYearStart,
          semesterNumber
        });
      }
      grouped.set(key, semester);
    }
  }

  return [...grouped.values()]
    .map((semester) => ({
      ...semester,
      label: formatAcademicSemesterLabel(
        semester.academicYearStart,
        semester.semesterNumber
      ),
      sessions: mergeAcademicTimetableSessions(semester.sessions)
    }))
    .sort(
      (left, right) =>
        right.academicYearStart - left.academicYearStart ||
        right.semesterNumber - left.semesterNumber
    );
};

const TimetablePanel = ({
  capabilities,
  snapshot
}: PluginComponentProps): JSX.Element => {
  const [records, setRecords] = useState<
    CapabilityRecord<AcademicTimetableData>[]
  >([]);
  const [calendar, setCalendar] = useState<AcademicCalendarConfigData | null>(null);
  const [termKey, setTermKey] = useState("");
  const [summerOnly, setSummerOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      readRecords<AcademicTimetableData>(capabilities, "academic.timetable@1"),
      readRecords<AcademicCalendarConfigData>(
        capabilities,
        "academic.calendar-config@1"
      )
    ]).then(([timetableResult, calendarResult]) => {
      if (!active) return;
      if (timetableResult.status === "rejected") {
        setRecords([]);
        setError(
          timetableResult.reason instanceof Error
            ? timetableResult.reason.message
            : "课表读取失败。"
        );
      } else {
        setRecords(timetableResult.value);
        setError(null);
      }
      setCalendar(
        calendarResult.status === "fulfilled"
          ? calendarResult.value.find((record) => record.data)?.data ?? null
          : null
      );
    });
    return () => {
      active = false;
    };
  }, [capabilities, snapshot?.generatedAt]);

  const semesters = useMemo(() => buildTimetableSemesters(records), [records]);
  const calendarSelection = useMemo(
    () =>
      calendar
        ? selectAcademicSemesterWindow(
            calendar.quarters,
            snapshot?.generatedAt ?? new Date().toISOString()
          )
        : null,
    [calendar, snapshot?.generatedAt]
  );
  const defaultKey = calendarSelection
    ? academicSemesterKey(
        calendarSelection.academicYearStart,
        calendarSelection.semesterNumber
      )
    : "";
  const fallbackKey =
    semesters.find((semester) => semester.sessions.length > 0)?.key ??
    semesters[0]?.key ??
    "";
  const selectedKey = semesters.some((semester) => semester.key === termKey)
    ? termKey
    : semesters.some((semester) => semester.key === defaultKey)
      ? defaultKey
      : fallbackKey;
  const selected =
    semesters.find((semester) => semester.key === selectedKey) ?? null;
  const visibleSessions = selected?.sessions.filter(
    ({ session }) => !summerOnly || session.secondHalf
  ) ?? [];

  // Merge the same course (same provider + course + teacher) that meets at
  // different times into one row; slots are ordered by weekday then period,
  // and rows by their earliest slot.
  const mergedRows = useMemo(() => {
    interface MergedSlot {
      dayOfWeek: number;
      periods: number[];
      weekPattern: string;
    }
    interface MergedRow {
      key: string;
      courseName: string;
      teacher: string;
      locations: Set<string>;
      weekPatterns: Set<string>;
      slots: MergedSlot[];
    }
    const groups = new Map<string, MergedRow>();
    for (const { providerId, session } of visibleSessions) {
      const key = `${providerId}::${session.courseName}::${session.teacher}`;
      let group = groups.get(key);
      if (!group) {
        group = {
          key,
          courseName: session.courseName,
          teacher: session.teacher,
          locations: new Set(),
          weekPatterns: new Set(),
          slots: []
        };
        groups.set(key, group);
      }
      group.locations.add(session.location ?? "地点待定");
      group.weekPatterns.add(session.weekPattern);
      group.slots.push({
        dayOfWeek: session.dayOfWeek,
        periods: session.periods,
        weekPattern: session.weekPattern
      });
    }
    const rows = [...groups.values()];
    for (const row of rows) {
      row.slots.sort(
        (left, right) =>
          left.dayOfWeek - right.dayOfWeek ||
          Math.min(...left.periods) - Math.min(...right.periods)
      );
    }
    rows.sort((left, right) => {
      const leftFirst = left.slots[0];
      const rightFirst = right.slots[0];
      if (!leftFirst || !rightFirst) return 0;
      return (
        leftFirst.dayOfWeek - rightFirst.dayOfWeek ||
        Math.min(...leftFirst.periods) - Math.min(...rightFirst.periods)
      );
    });
    return rows;
  }, [visibleSessions]);

  const weekPatternLabel = (value: string): string =>
    value === "all" ? "全周" : value === "odd" ? "单周" : "双周";

  return (
    <section className="academic-panel" aria-label="课表">
      <div className="academic-panel-heading">
        <div>
          <h2>课表</h2>
        </div>
        {semesters.length > 0 ? (
          <label className="academic-select-label">
            <span>学期</span>
            <select
              aria-label="学期"
              value={selectedKey}
              onChange={(event) => {
                setTermKey(event.target.value);
                setSummerOnly(false);
              }}
            >
              {semesters.map((semester) => (
                <option key={semester.key} value={semester.key}>
                  {semester.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {selected?.semesterNumber === 2 ? (
          <label className="academic-select-label academic-checkbox-label">
            <input
              type="checkbox"
              checked={summerOnly}
              onChange={(event) => setSummerOnly(event.target.checked)}
            />
            <span>只看短学期</span>
          </label>
        ) : null}
      </div>
      {error ? (
        <p className="panel-error" role="alert">
          {error}
        </p>
      ) : null}
      {!selected ? (
        <p className="muted">当前没有可用课表。</p>
      ) : visibleSessions.length === 0 ? (
        <p className="muted">
          {summerOnly ? "这个学期暂时没有短学期课程安排。" : "这个学期暂时没有课程安排。"}
        </p>
      ) : (
        <ul className="academic-record-list">
          {mergedRows.map((row) => (
            <li key={row.key} className="academic-record-row">
              <div>
                <strong>{row.courseName}</strong>
                <span className="meta-line">
                  {row.slots.map((slot) => `周${slot.dayOfWeek} · 第 ${slot.periods.join(", ")} 节`).join("、")}
                  {row.weekPatterns.size === 1
                    ? ` · ${weekPatternLabel([...row.weekPatterns][0]!)}`
                    : ""}
                </span>
              </div>
              <div className="row-side">
                <strong>{row.teacher}</strong>
                <span className="meta-line">{[...row.locations].join("、")}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

const CourseCatalogPanel = ({
  capabilities,
  snapshot
}: PluginComponentProps): JSX.Element => {
  const [records, setRecords] = useState<
    CapabilityRecord<AcademicCourseCatalogData>[]
  >([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void capabilities
      .read<AcademicCourseCatalogData>("academic.course-catalog@1")
      .then((next) => {
        if (!active) return;
        setRecords(next);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : "课程目录读取失败。");
        }
      });
    return () => {
      active = false;
    };
  }, [capabilities, snapshot?.generatedAt]);

  const courses = useMemo(
    () =>
      records.flatMap((record) =>
        (record.data?.courses ?? []).map((course) => ({
          ...course,
          key: `${record.providerId}:${course.sourceId}`
        }))
      ),
    [records]
  );
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = courses.filter((course) =>
    `${course.courseName} ${course.courseCode ?? ""} ${
      course.semesterLabel ?? ""
    }`
      .toLowerCase()
      .includes(normalizedQuery)
  );
  const selected =
    filtered.find((course) => course.key === selectedId) ?? filtered[0] ?? null;

  return (
    <section className="academic-panel" aria-label="课程目录">
      <div className="academic-panel-heading">
        <div>
          <h2>课程目录</h2>
        </div>
        <Input
          className="w-[min(280px,42vw)]"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索课程、代码或学期"
          aria-label="搜索课程"
        />
      </div>
      {error ? (
        <p className="panel-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="academic-course-layout">
        <ul className="academic-record-list academic-course-list">
          {filtered.map((course) => (
            <li key={course.key}>
              <button
                type="button"
                className={
                  course.key === selected?.key
                    ? "academic-course-option is-active"
                    : "academic-course-option"
                }
                onClick={() => setSelectedId(course.key)}
              >
                <strong>{course.courseName}</strong>
                <span className="meta-line">
                  {course.realId ?? course.courseCode ?? "课程代码未返回"} · {" "}
                  {course.semesterLabel ?? "学期待确认"} · {" "}
                  {course.derivedOnly ? "学分待出" : `${numberFormatter.format(course.credit)} 学分`}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {selected ? (
          <article className="academic-course-detail">
            <h3>{selected.courseName}</h3>
            <dl className="academic-detail-list">
              <div>
                <dt>课程标识</dt>
                <dd>{selected.realId ?? selected.courseCode ?? "未返回"}</dd>
              </div>
              <div>
                <dt>课程代码</dt>
                <dd>{selected.courseCode ?? "未返回"}</dd>
              </div>
              <div>
                <dt>教师</dt>
                <dd>{selected.teachers.join("、") || "未返回"}</dd>
              </div>
              <div>
                <dt>学分</dt>
                <dd>{selected.derivedOnly ? "待出（暂无成绩记录）" : numberFormatter.format(selected.credit)}</dd>
              </div>
              <div>
                <dt>学期</dt>
                <dd>{selected.semesterLabel ?? "待确认"}</dd>
              </div>
              <div>
                <dt>考试</dt>
                <dd>
                  {selected.examSourceIds.length > 0
                    ? `${selected.examSourceIds.length} 条`
                    : "无记录"}
                </dd>
              </div>
            </dl>
          </article>
        ) : (
          <p className="muted">没有匹配的课程。</p>
        )}
      </div>
    </section>
  );
};

const PracticePanel = ({
  capabilities,
  snapshot
}: PluginComponentProps): JSX.Element => {
  const [records, setRecords] = useState<CapabilityRecord<AcademicPracticeData>[]>(
    []
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void capabilities
      .read<AcademicPracticeData>("practice.records@1")
      .then((next) => {
        if (!active) return;
        setRecords(next);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : "素拓记录读取失败。");
        }
      });
    return () => {
      active = false;
    };
  }, [capabilities, snapshot?.generatedAt]);

  const data = records.find((record) => record.data)?.data ?? null;
  return (
    <section className="academic-panel" aria-label="素质拓展实践">
      <div className="academic-panel-heading">
        <div>
          <h2>素拓实践</h2>
        </div>
      </div>
      {error ? (
        <p className="panel-error" role="alert">
          {error}
        </p>
      ) : null}
      {!data ? (
        <p className="muted">当前没有可用素拓记录。</p>
      ) : (
        <>
          {data.summary ? (
            <div className="academic-stat-strip">
              <span>
                第二课堂
                <strong>{numberFormatter.format(data.summary.secondClassPoints)}</strong>
              </span>
              <span>
                第三课堂
                <strong>{numberFormatter.format(data.summary.thirdClassPoints)}</strong>
              </span>
              <span>
                第四课堂
                <strong>{numberFormatter.format(data.summary.fourthClassPoints)}</strong>
              </span>
              <span>
                合计
                <strong>{numberFormatter.format(data.summary.totalPoints)}</strong>
              </span>
            </div>
          ) : null}
          <ul className="academic-record-list">
            {data.records.map((record) => (
              <li key={record.sourceId} className="academic-record-row">
                <div>
                  <strong>{record.projectName}</strong>
                  <span className="meta-line">
                    {record.categoryName} · {record.projectType} · {record.statusLabel}
                  </span>
                </div>
                <div className="row-side">
                  <strong>
                    {record.score >= 0
                      ? numberFormatter.format(record.score)
                      : "待评分"}
                  </strong>
                  <span className="meta-line">
                    {record.approved ? "审核通过" : "未通过"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
};

export const AcademicView = (props: PluginComponentProps): JSX.Element => {
  const [section, setSection] = useState<AcademicSection>("timetable");

  return (
    <section className="module-workspace academic-module-workspace">
      <nav className="module-tabs" aria-label="学业视图">
        {academicSections.map((item) => (
          <button
            key={item.id}
            className={section === item.id ? "is-active" : undefined}
            type="button"
            aria-pressed={section === item.id}
            onClick={() => setSection(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {section === "timetable" ? <TimetablePanel {...props} /> : null}
      {section === "courses" ? <CourseCatalogPanel {...props} /> : null}
      {section === "exams" ? <ExamCountdownView {...props} /> : null}
      {section === "grades" ? <AcademicGradesView {...props} /> : null}
      {section === "practice" ? <PracticePanel {...props} /> : null}
    </section>
  );
};
