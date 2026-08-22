import type {
  AcademicExamRecord,
  AcademicExamsData,
  AcademicCourseCatalogData,
  AcademicCourseRecord,
  AcademicGradeRecord,
  AcademicGradesData,
  AcademicTimetableData,
  AcademicTimetableTermData,
  AcademicTimetableSeason,
  AcademicTimetableSession,
  CapabilityPublication,
  CampusPermission,
  PluginCapability,
  PluginCapabilityBinding
} from "@campusos/shared";
import { manifest } from "./manifest";

type GraduateTerm = 11 | 12 | 13 | 14;

export interface GraduateTermQuery {
  academicYearStart: number;
  term: GraduateTerm;
  season: AcademicTimetableSeason;
}

interface AcademicProfileProof {
  studentId: string;
  verifiedAt: string;
  verifiedService: string;
}

interface FetchSuccess {
  ok: true;
  body: string;
}

interface FetchFailure {
  ok: false;
  message: string;
}

type FetchResult = FetchSuccess | FetchFailure;

type TermFetchResult = FetchResult & {
  query: GraduateTermQuery;
};

type ExamFetchResult = FetchResult & {
  academicYearStart: number;
  term: 11 | 12;
};

interface ConnectorRefreshResult {
  sourceId: typeof manifest.id;
  status: "live" | "cache" | "fallback" | "unavailable";
  updatedAt: string;
  message?: string;
}

interface ConnectorActivationContext {
  pluginId: string;
  grantedPermissions: readonly CampusPermission[];
  bindings: Readonly<Partial<Record<PluginCapability, PluginCapabilityBinding>>>;
}

export interface ZjuGraduateConnectorDependencies {
  loadAcademicProfileProof: () => Promise<AcademicProfileProof | null>;
  fetchTimetableTerms: (
    queries: readonly GraduateTermQuery[]
  ) => Promise<TermFetchResult[]>;
  loadCachedTimetable: (accountId: string | null) => Promise<AcademicTimetableData | null>;
  fetchExams: (
    queries: readonly { academicYearStart: number; term: 11 | 12 }[]
  ) => Promise<ExamFetchResult[]>;
  loadCachedExams: (accountId: string | null) => Promise<AcademicExamsData | null>;
  fetchGrades: () => Promise<FetchResult>;
  loadCachedGrades: (accountId: string | null) => Promise<AcademicGradesData | null>;
  loadCachedCourseCatalog?: (accountId: string | null) => Promise<AcademicCourseCatalogData | null>;
  publish: <T>(publication: CapabilityPublication<T>) => Promise<void>;
  registerRefreshJob: (
    sourceId: string,
    job: () => Promise<ConnectorRefreshResult>
  ) => () => void;
  now?: () => Date;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const asString = (value: unknown): string | null => {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized ? normalized : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
};

const asNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

// Celechron lib/model/grade.dart:28-34. The raw source id remains available
// for provenance; realId is the stable course key shown to the user.
export const deriveCelechronRealId = (id: string): string => {
  const match = id.match(/(\(.*\)-.*?)-.*/);
  return match?.[1] ?? (id.length < 22 ? id : id.slice(0, 22));
};

const parseBody = (body: string, context: string): Record<string, unknown> => {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch (error) {
    throw new Error(`${context}响应不是有效 JSON。`, { cause: error });
  }
  const record = asRecord(payload);
  if (!record || record.success !== true) {
    throw new Error(`${context}响应未声明成功。`);
  }
  return record;
};

const resultRecord = (
  payload: Record<string, unknown>,
  context: string
): Record<string, unknown> => {
  const result = asRecord(payload.result);
  if (!result) throw new Error(`${context}响应缺少 result 对象。`);
  return result;
};

const parseWeeks = (value: unknown): number[] => {
  const text = asString(value) ?? "";
  const weeks = new Set<number>();
  const rangePattern = /(\d+)\s*[-~至]\s*(\d+)/g;
  for (const match of text.matchAll(rangePattern)) {
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end > 30 || start > end) {
      continue;
    }
    for (let week = start; week <= end; week += 1) weeks.add(week);
  }
  const withoutRanges = text.replace(rangePattern, " ");
  for (const match of withoutRanges.matchAll(/\d+/g)) {
    const week = Number(match[0]);
    if (Number.isInteger(week) && week >= 1 && week <= 30) weeks.add(week);
  }
  let result = [...weeks].sort((left, right) => left - right);
  if (/单/.test(text) && !/双/.test(text)) {
    result = result.filter((week) => week % 2 === 1);
  } else if (/双/.test(text) && !/单/.test(text)) {
    result = result.filter((week) => week % 2 === 0);
  }
  return result;
};

const weekPatternFor = (weeks: readonly number[]): "all" | "odd" | "even" => {
  if (weeks.length === 0) return "all";
  if (weeks.every((week) => week % 2 === 1)) return "odd";
  if (weeks.every((week) => week % 2 === 0)) return "even";
  return "all";
};

const halfFlags = (term: number): { firstHalf: boolean; secondHalf: boolean } => {
  if (term === 15 || term === 16) {
    return { firstHalf: true, secondHalf: true };
  }
  return {
    firstHalf: term === 11 || term === 13,
    secondHalf: term === 12 || term === 14
  };
};

export const parseGraduateTimetableResponse = (
  query: GraduateTermQuery,
  body: string
): AcademicTimetableSession[] => {
  const payload = parseBody(body, "研究生院课表");
  const dayMap = asRecord(resultRecord(payload, "研究生院课表").kcbMap);
  if (!dayMap) throw new Error("研究生院课表响应缺少 result.kcbMap。");

  const sessions = new Map<string, AcademicTimetableSession>();
  for (let day = 1; day <= 7; day += 1) {
    const periods = asRecord(dayMap[String(day)]);
    if (!periods) continue;
    for (let period = 1; period <= 15; period += 1) {
      const wrapper = asRecord(periods[String(period)]);
      const classes = wrapper?.pyKcbjSjddVOList;
      if (!Array.isArray(classes)) continue;
      for (const value of classes) {
        const item = asRecord(value);
        const classId = asString(item?.bjbh);
        if (!item || !classId || asString(item.xkzt) === "12") continue;
        const key = `${query.academicYearStart}:${query.term}:${day}:${classId}`;
        const existing = sessions.get(key);
        if (existing) {
          if (!existing.periods.includes(period)) {
            existing.periods.push(period);
            existing.periods.sort((left, right) => left - right);
          }
          continue;
        }

        const weeks = parseWeeks(item.zc);
        const flags = halfFlags(asNumber(item.pkxq) ?? query.term);
        sessions.set(key, {
          sourceId: key,
          courseName: asString(item.kcmc) ?? "未知课程",
          teacher: asString(item.xm) ?? "未知教师",
          location: asString(item.cdmc),
          dayOfWeek: day,
          periods: [period],
          ...flags,
          weekPattern: weekPatternFor(weeks),
          ...(weeks.length > 0 ? { weeks } : {}),
          confirmed: true
        });
      }
    }
  }
  return [...sessions.values()];
};

const parseClock = (value: unknown): { hour: number; minute: number } | null => {
  const match = asString(value)?.match(/(\d{1,2})\s*:\s*(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
    ? { hour, minute }
    : null;
};

const parseExamDate = (value: unknown): string | null => {
  const digits = (asString(value) ?? "").replace(/\D/g, "");
  if (digits.length < 8) return null;
  const raw = digits.slice(0, 8);
  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(4, 6));
  const day = Number(raw.slice(6, 8));
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
};

const toShanghaiDateTime = (
  date: string,
  clock: { hour: number; minute: number }
): string => `${date}T${String(clock.hour).padStart(2, "0")}:${String(clock.minute).padStart(2, "0")}:00+08:00`;

const normalizeExamDateLabel = (value: string): string => {
  const normalized = value.replace(/第\s*(\d+)\s*天/, (_, day: string) =>
    `第 ${Number.parseInt(day, 10)} 天`
  );
  return normalized.startsWith("第") ? `考试周${normalized}` : normalized;
};

export const parseGraduateExamsResponse = (
  academicYearStart: number,
  body: string
): AcademicExamRecord[] => {
  const payload = parseBody(body, "研究生院考试");
  const result = payload.result;
  const records = Array.isArray(result)
    ? result
    : asRecord(result)?.records;
  if (!Array.isArray(records)) {
    throw new Error("研究生院考试响应缺少 records 数组。");
  }

  return records.flatMap((value, index): AcademicExamRecord[] => {
    const item = asRecord(value);
    if (!item || asString(item.xn) !== String(academicYearStart)) return [];
    const courseId = asString(item.kcbh);
    const courseName = asString(item.kcmc);
    if (!courseId || !courseName) return [];
    const date = parseExamDate(item.rq);
    const combinedTimes = [...(asString(item.ksTime) ?? "").matchAll(/\d{1,2}\s*:\s*\d{2}/g)]
      .map((match) => match[0]);
    const startClock = parseClock(item.kssj ?? combinedTimes[0]);
    const endClock = parseClock(item.jssj ?? combinedTimes[1]);
    const startAt = date && startClock ? toShanghaiDateTime(date, startClock) : null;
    const endAt = date && endClock ? toShanghaiDateTime(date, endClock) : null;
    // Deviation from Celechron 1.3.0 lib/http/zjuServices/grs_new.dart:346-353,
    // which falls back a missing start clock to 08:00 and a missing end clock to
    // 22:00 (a full-day placeholder). CampusOS deliberately does NOT invent
    // clocks: an exam without an explicit clock keeps startAt/endAt null and
    // surfaces only the raw schedule text via dateLabel, so the UI never shows a
    // fabricated all-day time. Covered by zjuGraduateConnector.test.ts records
    // with startAt/endAt null. Impact: undated or clock-less exams appear in the
    // exam list with "时间待确认" instead of a guessed time slot.
    const validRange = startAt && endAt && Date.parse(endAt) > Date.parse(startAt);
    const scheduleText = [asString(item.rq), asString(item.ksTime)]
      .filter(Boolean)
      .join(" ") || "时间待确认";
    const dateLabel = date
      ? null
      : normalizeExamDateLabel(scheduleText);
    const sourceId = asString(item.id) ?? `${courseId}:${date ?? "undated"}:${index}`;
    return [{
      sourceId,
      courseId,
      courseName,
      kind: "final",
      scheduleText,
      startAt: validRange ? startAt : null,
      endAt: validRange ? endAt : null,
      dateLabel,
      location: asString(item.mc) ?? asString(item.ksdd),
      seat: asString(item.zwh)
    }];
  });
};

const parseAcademicPeriod = (
  value: string
): { academicYearStart: number | null; termNumber: 1 | 2 | null } => {
  const match = value.match(/(20\d{2})[-_](?:20\d{2})[-_](1|2)/);
  return {
    academicYearStart: match ? Number(match[1]) : null,
    termNumber: match ? Number(match[2]) as 1 | 2 : null
  };
};

export const parseGraduateGradesResponse = (body: string): AcademicGradesData => {
  const payload = parseBody(body, "研究生院成绩");
  const list = resultRecord(payload, "研究生院成绩").xxjhnList;
  if (!Array.isArray(list)) {
    throw new Error("研究生院成绩响应缺少 xxjhnList 数组。");
  }
  const grades = list.flatMap((value): AcademicGradeRecord[] => {
    const item = asRecord(value);
    if (!item || asString(item.xkztMc) === "未处理") return [];
    const sourceId = asString(item.sjddBz);
    const courseName = asString(item.kcmc);
    if (!sourceId || !courseName) return [];
    const period = parseAcademicPeriod(sourceId);
    return [{
      sourceId,
      realId: deriveCelechronRealId(sourceId),
      courseCode: asString(item.kcbh) ?? asString(item.kcdm),
      courseName,
      credit: asNumber(item.xf) ?? 0,
      originalScore: asString(item.zf) ?? "",
      // Celechron lib/http/zjuServices/grs_new.dart:276-286 sets graduate
      // fivePoint to 0 and gpaIncluded to false regardless of jd payload.
      gradePoint: null,
      isMajorCourse: true,
      courseCategory: null,
      gpaIncluded: false,
      creditIncluded: true,
      ...period
    }];
  });
  return {
    grades: [...new Map(grades.map((grade) => [grade.sourceId, grade])).values()]
  };
};

export const buildGraduateCourseCatalog = ({
  terms,
  exams,
  grades
}: {
  terms: readonly AcademicTimetableTermData[];
  exams: readonly AcademicExamRecord[];
  grades: readonly AcademicGradeRecord[];
}): AcademicCourseCatalogData => {
  const byKey = new Map<string, AcademicCourseRecord>();
  const sourceToKey = new Map<string, string>();
  for (const grade of grades) {
    const key = `${grade.academicYearStart ?? "unknown"}:${grade.termNumber ?? "unknown"}:${grade.courseName}`;
    sourceToKey.set(grade.sourceId, key);
    byKey.set(key, {
      sourceId: grade.sourceId,
      realId: grade.realId ?? deriveCelechronRealId(grade.sourceId),
      courseCode: grade.courseCode,
      courseName: grade.courseName,
      teachers: [],
      credit: grade.credit,
      academicYearStart: grade.academicYearStart,
      season: grade.termNumber === 1 ? "1|秋" : grade.termNumber === 2 ? "2|春" : null,
      semesterLabel: grade.academicYearStart === null || grade.termNumber === null
        ? null
        : `${grade.academicYearStart}-${grade.academicYearStart + 1} ${grade.termNumber === 1 ? "1|秋" : "2|春"}`,
      courseCategory: grade.courseCategory,
      gradeSourceId: grade.sourceId,
      examSourceIds: [],
      sessions: []
    });
  }
  for (const term of terms) {
    for (const session of term.sessions) {
      const termNumber = term.season.startsWith("1|") ? 1 : 2;
      const key = `${term.academicYearStart}:${termNumber}:${session.courseName}`;
      const existing = byKey.get(key) ?? {
        sourceId: session.sourceId,
        realId: null,
        courseCode: null,
        courseName: session.courseName,
        teachers: [],
        credit: 0,
        academicYearStart: term.academicYearStart,
        season: term.season,
        semesterLabel: `${term.academicYearStart}-${term.academicYearStart + 1} ${term.season}`,
        courseCategory: null,
        gradeSourceId: null,
        examSourceIds: [],
        sessions: []
      };
      if (!existing.teachers.includes(session.teacher)) existing.teachers.push(session.teacher);
      const firstPeriod = session.periods[0];
      const duplicate = existing.sessions.find((candidate) =>
        candidate.dayOfWeek === session.dayOfWeek &&
        candidate.weekPattern === session.weekPattern &&
        candidate.location === session.location &&
        candidate.periods.includes(firstPeriod)
      );
      if (duplicate) {
        duplicate.firstHalf ||= session.firstHalf;
        duplicate.secondHalf ||= session.secondHalf;
      } else {
        const adjacent = existing.sessions.find((candidate) =>
          candidate.dayOfWeek === session.dayOfWeek &&
          candidate.weekPattern === session.weekPattern &&
          candidate.location === session.location &&
          candidate.periods.at(-1)! + 1 === firstPeriod
        );
        if (adjacent) {
          adjacent.periods.push(...session.periods);
          adjacent.firstHalf ||= session.firstHalf;
          adjacent.secondHalf ||= session.secondHalf;
        } else {
          existing.sessions.push({
            ...session,
            periods: [...session.periods],
            ...(session.weeks ? { weeks: [...session.weeks] } : {})
          });
        }
      }
      byKey.set(key, existing);
    }
  }
  for (const exam of exams) {
    const existingKey = sourceToKey.get(exam.courseId) ??
      [...byKey.entries()].find(([, course]) => course.courseCode === exam.courseId)?.[0] ??
      [...byKey.entries()].find(([, course]) => course.courseName === exam.courseName)?.[0] ??
      `unknown:unknown:${exam.courseName}`;
    const existing = byKey.get(existingKey) ?? {
      sourceId: exam.courseId,
      realId: deriveCelechronRealId(exam.courseId),
      courseCode: exam.courseId,
      courseName: exam.courseName,
      teachers: [],
      credit: 0,
      academicYearStart: null,
      season: null,
      semesterLabel: null,
      courseCategory: null,
      gradeSourceId: null,
      examSourceIds: [],
      sessions: []
    };
    if (!existing.examSourceIds.includes(exam.sourceId)) existing.examSourceIds.push(exam.sourceId);
    byKey.set(existingKey, existing);
    sourceToKey.set(exam.courseId, existingKey);
  }
  return {
    courses: [...byKey.values()].sort((left, right) =>
      (right.academicYearStart ?? -1) - (left.academicYearStart ?? -1) ||
      left.courseName.localeCompare(right.courseName, "zh-CN")
    )
  };
};

const academicYearStartFor = (date: Date): number => {
  const shanghai = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "numeric"
  }).formatToParts(date);
  const year = Number(shanghai.find((part) => part.type === "year")?.value);
  const month = Number(shanghai.find((part) => part.type === "month")?.value);
  return month >= 8 ? year : year - 1;
};

export const createGraduateTimetableQueries = (now: Date): GraduateTermQuery[] => {
  const current = academicYearStartFor(now);
  const terms: readonly [GraduateTerm, AcademicTimetableSeason][] = [
    [13, "1|秋"],
    [14, "1|冬"],
    [11, "2|春"],
    [12, "2|夏"]
  ];
  return [current, current + 1].flatMap((academicYearStart) =>
    terms.map(([term, season]) => ({ academicYearStart, term, season }))
  );
};

const aggregateStatus = (
  states: readonly ("live" | "cache" | "fallback" | "unavailable")[]
): ConnectorRefreshResult["status"] => {
  if (states.every((state) => state === "live")) return "live";
  if (states.every((state) => state === "unavailable")) return "unavailable";
  if (states.includes("live") || states.includes("fallback")) return "fallback";
  return "cache";
};

export const createZjuGraduateConnector = ({
  loadAcademicProfileProof,
  fetchTimetableTerms,
  loadCachedTimetable,
  fetchExams,
  loadCachedExams,
  fetchGrades,
  loadCachedGrades,
  loadCachedCourseCatalog,
  publish,
  registerRefreshJob,
  now = () => new Date()
}: ZjuGraduateConnectorDependencies) => {
  const publishUnavailable = async (updatedAt: string, message: string) => {
    // Preserve the last successful content instead of clobbering it with
    // unavailable/null when the account is not verified (startup default:
    // show the previous cache). academic.profile has no cache and stays
    // unavailable.
    await publish({
      capability: "academic.profile@1",
      accountId: null,
      state: "unavailable",
      updatedAt,
      data: null,
      message
    });
    const [cachedTimetable, cachedExams, cachedGrades, cachedCatalog] =
      await Promise.all([
        loadCachedTimetable(null).catch(() => null),
        loadCachedExams(null).catch(() => null),
        loadCachedGrades(null).catch(() => null),
        loadCachedCourseCatalog?.(null).catch(() => null) ?? Promise.resolve(null)
      ]);
    const cachedByCapability: Record<string, unknown> = {
      "academic.timetable@1": cachedTimetable,
      "academic.exams@1": cachedExams,
      "academic.grades@1": cachedGrades,
      "academic.course-catalog@1": cachedCatalog
    };
    for (const capability of manifest.provides) {
      if (capability === "academic.profile@1") continue;
      const data = cachedByCapability[capability] ?? null;
      await publish({
        capability,
        accountId: null,
        state: data ? "cache" : "unavailable",
        updatedAt,
        data,
        message: data ? "未连接账号，继续显示上次成功数据。" : message
      });
    }
  };

  const refresh = async (): Promise<ConnectorRefreshResult> => {
    const proof = await loadAcademicProfileProof();
    const refreshedAt = now();
    const updatedAt = refreshedAt.toISOString();
    if (!proof) {
      const message = "尚未配置并验证浙大统一身份认证账号。";
      await publishUnavailable(updatedAt, message);
      return { sourceId: manifest.id, status: "unavailable", updatedAt, message };
    }

    const timetableQueries = createGraduateTimetableQueries(refreshedAt);
    const examQueries = [academicYearStartFor(refreshedAt), academicYearStartFor(refreshedAt) + 1]
      .flatMap((academicYearStart) => ([12, 11] as const).map((term) => ({ academicYearStart, term })));
    const [timetableResults, examResults, gradeResult] = await Promise.all([
      fetchTimetableTerms(timetableQueries).catch(() => []),
      fetchExams(examQueries).catch(() => []),
      fetchGrades().catch((error: unknown): FetchFailure => ({
        ok: false,
        message: error instanceof Error ? error.message : "研究生院成绩请求失败。"
      }))
    ]);

    const terms: AcademicTimetableTermData[] = timetableQueries.map((query) => {
      const result = timetableResults.find((candidate) =>
        candidate.query.academicYearStart === query.academicYearStart && candidate.query.term === query.term
      );
      if (!result?.ok) {
        return { academicYearStart: query.academicYearStart, season: query.season, state: "unavailable" as const, sessions: [], message: result?.message ?? "课表请求没有返回结果。" };
      }
      try {
        return { academicYearStart: query.academicYearStart, season: query.season, state: "live" as const, sessions: parseGraduateTimetableResponse(query, result.body) };
      } catch (error) {
        return { academicYearStart: query.academicYearStart, season: query.season, state: "unavailable" as const, sessions: [], message: error instanceof Error ? error.message : "研究生院课表解析失败。" };
      }
    });
    const hasLiveTimetable = terms.some((term) => term.state === "live");
    let effectiveTerms = terms;
    let timetableState: "live" | "cache" | "fallback" | "unavailable";
    if (hasLiveTimetable) {
      const hasUnavailableTerm = terms.some((term) => term.state === "unavailable");
      const cached = hasUnavailableTerm
        ? await loadCachedTimetable(proof.studentId)
        : null;
      effectiveTerms = terms.map((term) => {
        if (term.state === "live") return term;
        const cachedTerm = cached?.terms.find((candidate) =>
          candidate.academicYearStart === term.academicYearStart &&
          candidate.season === term.season
        );
        return cachedTerm
          ? {
              ...cachedTerm,
              state: "cache" as const,
              message: "本学季实时课表不可用，继续使用上次成功数据。"
            }
          : term;
      });
      timetableState = hasUnavailableTerm ? "fallback" : "live";
      await publish({
        capability: "academic.timetable@1",
        accountId: proof.studentId,
        state: timetableState,
        updatedAt,
        data: { terms: effectiveTerms },
        ...(hasUnavailableTerm
          ? { message: "研究生课表部分学季已刷新，其余学季使用缓存或当前不可用。" }
          : {})
      });
    } else {
      const cached = await loadCachedTimetable(proof.studentId);
      effectiveTerms = cached?.terms ?? terms;
      await publish({ capability: "academic.timetable@1", accountId: proof.studentId, state: cached ? "cache" : "unavailable", updatedAt, data: cached, message: cached ? "实时研究生课表不可用，继续使用上次成功数据。" : "研究生院课表当前不可用。" });
      timetableState = cached ? "cache" : "unavailable";
    }

    const parsedExamResults = examResults.map((result) => {
      if (!result.ok) return { ok: false as const, exams: [] };
      try {
        return {
          ok: true as const,
          exams: parseGraduateExamsResponse(result.academicYearStart, result.body)
        };
      } catch {
        return { ok: false as const, exams: [] };
      }
    });
    const parsedExams = parsedExamResults.flatMap((result) => result.exams);
    let effectiveExams = parsedExams;
    const parsedExamQueryCount = parsedExamResults.filter((result) => result.ok).length;
    const hasLiveExams = parsedExamQueryCount > 0;
    let examsState: "live" | "cache" | "fallback" | "unavailable";
    if (hasLiveExams) {
      const complete = parsedExamQueryCount === examQueries.length;
      const cached = complete ? null : await loadCachedExams(proof.studentId);
      const mergedExams = [
        ...(cached?.exams ?? []),
        ...parsedExams
      ];
      effectiveExams = [...new Map(mergedExams.map((exam) => [exam.sourceId, exam])).values()];
      examsState = complete ? "live" : "fallback";
      await publish({
        capability: "academic.exams@1",
        accountId: proof.studentId,
        state: examsState,
        updatedAt,
        data: {
          exams: effectiveExams
        },
        ...(!complete
          ? { message: "研究生考试部分学期已刷新，其余记录保留缓存。" }
          : {})
      });
    } else {
      const cached = await loadCachedExams(proof.studentId);
      effectiveExams = cached?.exams ?? [];
      await publish({ capability: "academic.exams@1", accountId: proof.studentId, state: cached ? "cache" : "unavailable", updatedAt, data: cached, message: cached ? "实时研究生考试不可用，继续使用上次成功数据。" : "研究生院考试当前不可用。" });
      examsState = cached ? "cache" : "unavailable";
    }

    let gradesState: "live" | "cache" | "unavailable";
    let gradesData: AcademicGradesData | null = null;
    if (gradeResult.ok) {
      try {
        gradesData = parseGraduateGradesResponse(gradeResult.body);
        await publish({ capability: "academic.grades@1", accountId: proof.studentId, state: "live", updatedAt, data: gradesData });
        gradesState = "live";
      } catch {
        const cached = await loadCachedGrades(proof.studentId);
        gradesData = cached;
        await publish({ capability: "academic.grades@1", accountId: proof.studentId, state: cached ? "cache" : "unavailable", updatedAt, data: cached, message: cached ? "研究生成绩响应异常，继续使用上次成功数据。" : "研究生成绩响应无法解析。" });
        gradesState = cached ? "cache" : "unavailable";
      }
    } else {
      const cached = await loadCachedGrades(proof.studentId);
      gradesData = cached;
      await publish({ capability: "academic.grades@1", accountId: proof.studentId, state: cached ? "cache" : "unavailable", updatedAt, data: cached, message: cached ? "实时研究生成绩不可用，继续使用上次成功数据。" : gradeResult.message });
      gradesState = cached ? "cache" : "unavailable";
    }

    const courseCatalog = buildGraduateCourseCatalog({
      terms: effectiveTerms,
      exams: effectiveExams,
      grades: gradesData?.grades ?? []
    });
    let courseCatalogState: "live" | "cache" | "fallback" | "unavailable" = "unavailable";
    if (courseCatalog.courses.length > 0) {
      const sourceStates = [timetableState, examsState, gradesState];
      const hasLiveSource = sourceStates.some((state) => state === "live" || state === "fallback");
      courseCatalogState = sourceStates.every((state) => state === "live")
        ? "live"
        : hasLiveSource
          ? "fallback"
          : "cache";
      await publish({
        capability: "academic.course-catalog@1",
        accountId: proof.studentId,
        state: courseCatalogState,
        updatedAt,
        data: courseCatalog
      });
    } else {
      const cached = (await loadCachedCourseCatalog?.(proof.studentId)) ?? null;
      await publish({
        capability: "academic.course-catalog@1",
        accountId: proof.studentId,
        state: cached ? "cache" : "unavailable",
        updatedAt,
        data: cached,
        ...(cached ? { message: "课程目录实时数据不可用，继续使用上次成功数据。" } : {})
      });
      courseCatalogState = cached ? "cache" : "unavailable";
    }

    const hasLiveGraduateData = [timetableState, examsState, gradesState, courseCatalogState]
      .some((state) => state === "live" || state === "fallback");
    await publish({
      capability: "academic.profile@1",
      accountId: proof.studentId,
      state: hasLiveGraduateData ? "live" : "unavailable",
      updatedAt,
      data: hasLiveGraduateData ? {
        studentId: proof.studentId,
        educationLevel: "graduate",
        verifiedAt: proof.verifiedAt,
        verifiedService: "graduate-academic-affairs"
      } : null,
      ...(!hasLiveGraduateData ? { message: "研究生院业务身份尚未得到实时数据确认。" } : {})
    });

    const status = aggregateStatus([timetableState, examsState, gradesState, courseCatalogState]);
    return {
      sourceId: manifest.id,
      status,
      updatedAt,
      ...(status === "fallback" ? { message: "研究生教务部分模块已实时刷新，其余模块使用缓存或当前不可用。" } : {})
    };
  };

  return {
    manifest,
    activate: async (context: ConnectorActivationContext) => {
      if (context.pluginId !== manifest.id) throw new Error("研究生教务连接器收到错误的插件身份。");
      const missingPermission = manifest.permissions.find((permission) => !context.grantedPermissions.includes(permission));
      if (missingPermission) throw new Error(`研究生教务连接器缺少权限：${missingPermission}`);
      const unregister = registerRefreshJob(manifest.id, refresh);
      try {
        await refresh();
      } catch (error) {
        unregister();
        throw error;
      }
      return { deactivate: unregister };
    }
  };
};
