import type {
  AcademicExamRecord,
  AcademicExamsData,
  AcademicCourseCatalogData,
  AcademicCourseRecord,
  AcademicGradeRecord,
  AcademicGradesData,
  AcademicMajorGradeSummary,
  AcademicPracticeData,
  AcademicPracticeRecord,
  AcademicPracticeSummary,
  AcademicPracticeSummarySource,
  AcademicProfileData,
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

export interface AcademicProfileProof {
  studentId: string;
  verifiedAt: string;
  verifiedService: string;
}

interface ConnectorRefreshResult {
  sourceId: typeof manifest.id;
  status: "live" | "cache" | "fallback" | "unavailable";
  updatedAt: string;
  message?: string;
}

export interface TimetableQuery {
  academicYearStart: number;
  season: AcademicTimetableSeason;
}

export type TimetableTermFetchResult =
  | { query: TimetableQuery; ok: true; body: string }
  | { query: TimetableQuery; ok: false; message: string };

export type ExamsFetchResult =
  | { ok: true; body: string }
  | { ok: false; message: string };

export type GradesFetchResult =
  | { ok: true; body: string; majorBody?: string; majorMessage?: string }
  | { ok: false; message: string };

export type PracticeFetchResult =
  | {
      ok: true;
      body?: string;
      summaryBody?: string;
      detailsMessage?: string;
      summaryMessage?: string;
    }
  | { ok: false; message: string };

export interface ZjuUndergraduateConnectorDependencies {
  loadAcademicProfileProof: () => Promise<AcademicProfileProof | null>;
  fetchTimetableTerms: (
    queries: readonly TimetableQuery[]
  ) => Promise<TimetableTermFetchResult[]>;
  loadCachedTimetable: (
    accountId: string | null
  ) => Promise<AcademicTimetableData | null>;
  fetchExams: () => Promise<ExamsFetchResult>;
  loadCachedExams: (accountId: string | null) => Promise<AcademicExamsData | null>;
  fetchGrades: () => Promise<GradesFetchResult>;
  loadCachedGrades: (accountId: string | null) => Promise<AcademicGradesData | null>;
  fetchPractice?: () => Promise<PracticeFetchResult>;
  loadCachedPractice?: (accountId: string | null) => Promise<AcademicPracticeData | null>;
  loadCachedCourseCatalog?: (accountId: string | null) => Promise<AcademicCourseCatalogData | null>;
  publish: (
    publication: CapabilityPublication<
      | AcademicProfileData
      | AcademicTimetableData
      | AcademicExamsData
      | AcademicGradesData
      | AcademicCourseCatalogData
      | AcademicPracticeData
    >
  ) => Promise<void>;
  registerRefreshJob: (
    sourceId: string,
    job: () => Promise<ConnectorRefreshResult>
  ) => () => void;
  now?: () => Date;
}

interface ConnectorActivationContext {
  pluginId: string;
  grantedPermissions: readonly CampusPermission[];
  bindings: Readonly<Partial<Record<PluginCapability, PluginCapabilityBinding>>>;
}

const seasons: readonly AcademicTimetableSeason[] = [
  "1|秋",
  "1|冬",
  "2|春",
  "2|夏"
];

const shanghaiAcademicClock = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "numeric"
});

export const createTimetableQueries = (
  now: Date,
  studentId?: string
): TimetableQuery[] => {
  // Celechron derives the academic year from the university's Shanghai
  // calendar, rather than the host process timezone.
  const parts = shanghaiAcademicClock.formatToParts(now);
  const calendarYear = Number(
    parts.find((part) => part.type === "year")?.value
  );
  const calendarMonth = Number(
    parts.find((part) => part.type === "month")?.value
  );
  const currentAcademicYearStart =
    calendarMonth >= 9 ? calendarYear : calendarYear - 1;
  // Celechron lib/http/ugrs_spider.dart:354-371 and
  // lib/http/calendar_config_parser.dart:14-51 derive the enrollment year
  // from the student number, fetch every year through the current academic
  // year, then probe exactly one future year without crossing graduation.
  const enrollmentDigits = studentId?.trim().match(/^\d(\d{2})/)?.[1];
  const parsedEnrollmentYear = enrollmentDigits
    ? Number.parseInt(enrollmentDigits, 10) + 2000
    : null;
  const enrollmentYearStart = parsedEnrollmentYear !== null &&
      Number.isSafeInteger(parsedEnrollmentYear)
    ? parsedEnrollmentYear
    : currentAcademicYearStart;
  const graduationYearStart = enrollmentYearStart + 7;
  const probeUpperBound = Math.min(
    currentAcademicYearStart + 1,
    graduationYearStart
  );
  const academicYears = Array.from(
    { length: Math.max(1, probeUpperBound - enrollmentYearStart + 1) },
    (_unused, index) => enrollmentYearStart + index
  );

  return academicYears.flatMap(
    (academicYearStart) =>
      seasons.map((season) => ({ academicYearStart, season }))
  );
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asString = (value: unknown): string | null =>
  typeof value === "string"
    ? value
    : typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : null;

const asInteger = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return Number.parseInt(value, 10);
  }
  return null;
};

const asNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

// Celechron lib/model/grade.dart:28-34. Keep the raw xkkh as sourceId while
// exposing the same stable display id used to join a course's public details.
export const deriveCelechronRealId = (id: string): string => {
  const match = id.match(/(\(.*\)-.*?)-.*/);
  return match?.[1] ?? (id.length < 22 ? id : id.slice(0, 22));
};

const decodeText = (value: string): string =>
  value
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .trim();

const parseSession = (
  query: TimetableQuery,
  value: unknown
): AcademicTimetableSession | null => {
  const item = asRecord(value);
  if (!item || item.kcb === null || asString(item.sfyjskc) === "1") {
    return null;
  }

  const courseBlock = asString(item.kcb);
  const courseMatch = courseBlock?.match(
    /^(.*?)<br>(.*?)<br>(.*?)<br>(.*?)zwf/s
  );
  const dayOfWeek = asInteger(item.xqj);
  const initialPeriod = asInteger(item.djj);
  const duration = asInteger(item.skcd);
  if (
    !courseMatch ||
    dayOfWeek === null ||
    dayOfWeek < 1 ||
    dayOfWeek > 7 ||
    initialPeriod === null ||
    initialPeriod < 1 ||
    duration === null ||
    duration < 1 ||
    duration > 20
  ) {
    return null;
  }

  const courseName = decodeText(courseMatch[1])
    .replaceAll("(", "（")
    .replaceAll(")", "）");
  if (!courseName) return null;

  const teacher = decodeText(courseMatch[3]) || "未知教师";
  const location = decodeText(courseMatch[4]) || null;
  const periods = Array.from(
    { length: duration },
    (_unused, index) => initialPeriod + index
  );
  const half = asString(item.xxq) ?? "";
  const weekCode = asString(item.dsz);
  const weekPattern =
    weekCode === "0" ? "odd" : weekCode === "1" ? "even" : "all";
  const sourceId = [
    query.academicYearStart,
    query.season,
    courseName,
    teacher,
    location ?? "",
    dayOfWeek,
    periods.join(","),
    weekPattern
  ].map(String).map(encodeURIComponent).join(":");

  return {
    sourceId,
    ...(asString(item.xkkh)?.trim()
      ? { courseId: asString(item.xkkh)!.trim() }
      : {}),
    courseName,
    teacher,
    location,
    dayOfWeek,
    periods,
    firstHalf: half.includes("秋") || half.includes("春"),
    secondHalf: half.includes("冬") || half.includes("夏"),
    weekPattern,
    confirmed: asString(item.sfqd) === "1"
  };
};

export const parseTimetableResponse = (
  query: TimetableQuery,
  body: string
): AcademicTimetableSession[] => {
  if (body.trim() === "null") return [];

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch (error) {
    throw new Error("教务网课表响应不是有效 JSON。", { cause: error });
  }
  const kbList = asRecord(payload)?.kbList;
  if (!Array.isArray(kbList)) {
    throw new Error("教务网课表响应缺少 kbList 数组。");
  }

  return kbList
    .map((item) => parseSession(query, item))
    .filter((item): item is AcademicTimetableSession => item !== null);
};

const datePattern =
  /(\d{4})\s*(?:年|[-/.])\s*(\d{1,2})\s*(?:月|[-/.])\s*(\d{1,2})\s*日?/;
const timeRangePattern =
  /[（(]?\s*(\d{1,2}:\d{2})\s*[-–—~～至]\s*(\d{1,2}:\d{2})\s*[）)]?/;

const isValidCalendarDate = (year: number, month: number, day: number): boolean => {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
};

const toZjuDateTime = (
  year: number,
  month: number,
  day: number,
  time: string
): string =>
  `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${time}:00+08:00`;

const normalizeExamDateLabel = (value: string): string => {
  const normalized = value.replace(/第\s*(\d+)\s*天/, (_, day: string) =>
    `第 ${Number.parseInt(day, 10)} 天`
  );
  return normalized.startsWith("第") ? `考试周${normalized}` : normalized;
};

const parseExamRecord = (
  item: Record<string, unknown>,
  kind: "midterm" | "final"
): AcademicExamRecord | null => {
  const courseId = asString(item.xkkh)?.trim() ?? "";
  const scheduleText = asString(
    kind === "midterm" ? item.qzkssj : item.kssj
  )?.trim() ?? "";
  if (!courseId || !scheduleText) return null;

  const courseName = (asString(item.kcmc)?.trim() || "未知课程")
    .replaceAll("(", "（")
    .replaceAll(")", "）");
  const timeMatch = scheduleText.match(timeRangePattern);
  const dateMatch = scheduleText.match(datePattern);
  let startAt: string | null = null;
  let endAt: string | null = null;
  if (timeMatch && dateMatch) {
    const year = Number.parseInt(dateMatch[1], 10);
    const month = Number.parseInt(dateMatch[2], 10);
    const day = Number.parseInt(dateMatch[3], 10);
    if (isValidCalendarDate(year, month, day)) {
      startAt = toZjuDateTime(year, month, day, timeMatch[1]);
      endAt = toZjuDateTime(year, month, day, timeMatch[2]);
    }
  }
  const dateLabel =
    startAt === null
      ? (() => {
          const label = scheduleText
            .slice(0, timeMatch?.index ?? scheduleText.length)
            .replace(/[（(\s]+$/, "")
            .trim();
          return label ? normalizeExamDateLabel(label) : null;
        })()
      : null;
  const location = asString(
    kind === "midterm" ? item.qzjsmc : item.jsmc
  )?.trim() || null;
  const seat = asString(
    kind === "midterm" ? item.qzzwxh : item.zwxh
  )?.trim() || null;
  const sourceId = [courseId, kind, scheduleText, location ?? "", seat ?? ""]
    .map(encodeURIComponent)
    .join(":");

  return {
    sourceId,
    courseId,
    courseName,
    kind,
    scheduleText,
    startAt,
    endAt,
    dateLabel,
    location,
    seat
  };
};

export const parseExamsResponse = (body: string): AcademicExamRecord[] => {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch (error) {
    throw new Error("教务网考试响应不是有效 JSON。", { cause: error });
  }
  const items = asRecord(payload)?.items;
  if (!Array.isArray(items)) {
    throw new Error("教务网考试响应缺少 items 数组。");
  }

  return items.flatMap((value) => {
    const item = asRecord(value);
    if (!item) return [];
    return (["midterm", "final"] as const)
      .map((kind) => parseExamRecord(item, kind))
      .filter((exam): exam is AcademicExamRecord => exam !== null);
  });
};

const parseGradeRecord = (
  value: unknown,
  majorCourseIds: ReadonlySet<string>
): AcademicGradeRecord | null => {
  const item = asRecord(value);
  if (!item) return null;
  const sourceId = asString(item.xkkh)?.trim();
  if (!sourceId) return null;

  const termMatch = sourceId.match(/^\((\d{4})-(\d{4})-([12])\)-([^-]+)/);
  const firstYear = termMatch ? Number.parseInt(termMatch[1], 10) : null;
  const secondYear = termMatch ? Number.parseInt(termMatch[2], 10) : null;
  const academicYearStart =
    firstYear !== null && secondYear === firstYear + 1 ? firstYear : null;
  const parsedTerm = termMatch ? Number.parseInt(termMatch[3], 10) : null;
  const termNumber = parsedTerm === 1 || parsedTerm === 2 ? parsedTerm : null;
  const credit = asNumber(item.xf);
  const gradePoint = asNumber(item.jd);

  return {
    sourceId,
    realId: deriveCelechronRealId(sourceId),
    courseCode: asString(item.kch)?.trim() || termMatch?.[4] || null,
    courseName: (asString(item.kcmc)?.trim() || "未知课程")
      .replaceAll("(", "（")
      .replaceAll(")", "）"),
    credit: credit !== null && credit >= 0 ? credit : 0,
    originalScore: asString(item.cj)?.trim() ?? "",
    // Celechron lib/model/grade.dart:80-87 defaults a missing jd to 0.0.
    gradePoint: gradePoint !== null && gradePoint >= 0 ? gradePoint : 0,
    academicYearStart,
    termNumber,
    isMajorCourse: majorCourseIds.has(sourceId),
    courseCategory: asString(item.kcxz)?.trim() || null
  };
};

export const parseMajorCourseIdsResponse = (body: string): Set<string> => {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch (error) {
    throw new Error("教务网主修成绩响应不是有效 JSON。", { cause: error });
  }
  const items = asRecord(payload)?.items;
  if (!Array.isArray(items)) {
    throw new Error("教务网主修成绩响应缺少 items 数组。");
  }
  return new Set(
    items
      .map((value) => asString(asRecord(value)?.xkkh)?.trim())
      .filter((sourceId): sourceId is string => Boolean(sourceId))
  );
};

const majorGradeGpaIncluded = (grade: AcademicGradeRecord): boolean =>
  !["弃修", "待录", "缓考", "无效", "合格", "不合格"].includes(grade.originalScore) &&
  !grade.sourceId.includes("xtwkc");

const majorGradeCreditIncluded = (grade: AcademicGradeRecord): boolean =>
  !["弃修", "待录", "缓考", "无效"].includes(grade.originalScore);

const majorGradeHundredPoint = (grade: AcademicGradeRecord): number => {
  const labels: Record<string, number> = {
    "A+": 95, A: 90, "A-": 87, "B+": 83, B: 80, "B-": 77,
    "C+": 73, C: 70, "C-": 67, D: 60, F: 0, 优秀: 90, 良好: 80,
    中等: 70, 及格: 60, 不及格: 0, 合格: 75, 不合格: 0,
    弃修: 0, 缺考: 0, 缓考: 0, 待录: 0, 无效: 0
  };
  return labels[grade.originalScore] ?? Number.parseInt(grade.originalScore.match(/\d+/)?.[0] ?? "0", 10);
};

/** Mirrors Celechron lib/http/zjuServices/zdbk.dart:getMajorGrade. */
export const parseMajorGradeSummaryResponse = (body: string): AcademicMajorGradeSummary => {
  const payload = JSON.parse(body) as { items?: unknown };
  if (!Array.isArray(payload.items)) {
    throw new Error("教务网主修成绩响应缺少 items 数组。");
  }
  const majorIds = new Set(
    payload.items
      .map((value) => asString(asRecord(value)?.xkkh)?.trim())
      .filter((sourceId): sourceId is string => Boolean(sourceId))
  );
  const grades = parseGradesResponse(body, majorIds).grades;
  const gpaGrades = grades.filter(majorGradeGpaIncluded);
  const credits = gpaGrades.reduce((sum, grade) => sum + Math.max(0, grade.credit), 0);
  const earnedCredits = grades.reduce(
    (sum, grade) => sum + (majorGradeCreditIncluded(grade) && ((grade.gradePoint ?? 0) !== 0 || grade.sourceId.includes("xtwkc")) ? Math.max(0, grade.credit) : 0),
    0
  );
  if (credits === 0) {
    return { fivePointGpa: null, fourPointGpa: null, fourPointLegacyGpa: null, hundredPointGpa: null, gpaCredits: credits, earnedCredits };
  }
  const totals = gpaGrades.reduce(
    (sum, grade) => {
      const five = grade.gradePoint ?? 0;
      const four = five > 4 ? ({ 5: 4.3, 4.8: 4.2, 4.5: 4.1, 4.2: 4 }[five] ?? 4) : five;
      sum.five += five * grade.credit;
      sum.four += four * grade.credit;
      sum.legacy += (five > 4 ? 4 : five) * grade.credit;
      sum.hundred += majorGradeHundredPoint(grade) * grade.credit;
      return sum;
    },
    { five: 0, four: 0, legacy: 0, hundred: 0 }
  );
  return {
    fivePointGpa: totals.five / credits,
    fourPointGpa: totals.four / credits,
    fourPointLegacyGpa: totals.legacy / credits,
    hundredPointGpa: totals.hundred / credits,
    gpaCredits: credits,
    earnedCredits
  };
};

export const parseGradesResponse = (
  body: string,
  majorCourseIds: ReadonlySet<string> = new Set()
): AcademicGradesData => {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch (error) {
    throw new Error("教务网成绩响应不是有效 JSON。", { cause: error });
  }
  const items = asRecord(payload)?.items;
  if (!Array.isArray(items)) {
    throw new Error("教务网成绩响应缺少 items 数组。");
  }
  const grades = items
    .map((item) => parseGradeRecord(item, majorCourseIds))
    .filter((grade): grade is AcademicGradeRecord => grade !== null);
  return {
    grades: [...new Map(grades.map((grade) => [grade.sourceId, grade])).values()]
  };
};

const seasonForTerm = (termNumber: 1 | 2 | null): AcademicTimetableSeason | null =>
  termNumber === 1 ? "1|秋" : termNumber === 2 ? "2|春" : null;

const academicTermFromSourceId = (
  sourceId: string
): { academicYearStart: number; termNumber: 1 | 2 } | null => {
  const match = sourceId.match(/^\((\d{4})-(\d{4})-([12])\)/);
  if (!match || Number(match[2]) !== Number(match[1]) + 1) return null;
  return {
    academicYearStart: Number(match[1]),
    termNumber: Number(match[3]) as 1 | 2
  };
};

/**
 * Celechron's scholar model exposes one course record which owns its grade,
 * sessions and exams. CampusOS keeps the same projection at the capability
 * boundary so the renderer never has to join raw connector responses.
 */
export const buildCourseCatalog = ({
  terms,
  exams,
  grades
}: {
  terms: readonly AcademicTimetableTermData[];
  exams: readonly AcademicExamRecord[];
  grades: readonly AcademicGradeRecord[];
}): AcademicCourseCatalogData => {
  const byKey = new Map<string, AcademicCourseRecord>();
  const identityKeysByName = new Map<string, Set<string>>();
  const gradeKeysById = new Map<string, string>();
  const sessionBucketsByName = new Map<string, string>();
  const termNameKey = (academicYearStart: number | null, season: AcademicTimetableSeason | null, courseName: string): string =>
    `${academicYearStart ?? "unknown"}:${season ?? "unknown"}:${courseName}`;

  const registerIdentity = (key: string, courseName: string, academicYearStart: number | null, season: AcademicTimetableSeason | null): void => {
    const nameKey = termNameKey(academicYearStart, season, courseName);
    const keys = identityKeysByName.get(nameKey) ?? new Set<string>();
    keys.add(key);
    identityKeysByName.set(nameKey, keys);
  };

  const addSession = (course: AcademicCourseRecord, session: AcademicTimetableSession): void => {
    if (!course.teachers.includes(session.teacher)) course.teachers.push(session.teacher);
    const firstPeriod = session.periods[0];
    if (firstPeriod === undefined) return;
    const duplicate = course.sessions.find((candidate) =>
      candidate.dayOfWeek === session.dayOfWeek &&
      candidate.weekPattern === session.weekPattern &&
      candidate.location === session.location &&
      candidate.periods.includes(firstPeriod)
    );
    if (duplicate) {
      duplicate.firstHalf ||= session.firstHalf;
      duplicate.secondHalf ||= session.secondHalf;
      return;
    }
    const adjacent = course.sessions.find((candidate) =>
      candidate.dayOfWeek === session.dayOfWeek &&
      candidate.weekPattern === session.weekPattern &&
      candidate.location === session.location &&
      candidate.periods.at(-1)! + 1 === firstPeriod
    );
    if (adjacent) {
      adjacent.periods.push(...session.periods);
      adjacent.firstHalf ||= session.firstHalf;
      adjacent.secondHalf ||= session.secondHalf;
      return;
    }
    course.sessions.push({
      ...session,
      periods: [...session.periods],
      ...(session.weeks ? { weeks: [...session.weeks] } : {})
    });
  };

  for (const grade of grades) {
    const term = academicTermFromSourceId(grade.sourceId);
    const season = seasonForTerm(term?.termNumber ?? grade.termNumber);
    const key = `id:${grade.sourceId}`;
    const course: AcademicCourseRecord = {
      sourceId: grade.sourceId,
      realId: grade.realId ?? deriveCelechronRealId(grade.sourceId),
      courseCode: grade.courseCode,
      courseName: grade.courseName,
      teachers: [],
      credit: grade.credit,
      academicYearStart: term?.academicYearStart ?? grade.academicYearStart,
      season,
      semesterLabel: term?.academicYearStart && season
        ? `${term.academicYearStart}-${term.academicYearStart + 1} ${season}`
        : null,
      courseCategory: grade.courseCategory,
      gradeSourceId: grade.sourceId,
      examSourceIds: [],
      sessions: []
    };
    byKey.set(key, course);
    gradeKeysById.set(grade.sourceId, key);
    registerIdentity(key, course.courseName, course.academicYearStart, course.season);
  }

  for (const exam of exams) {
    const term = academicTermFromSourceId(exam.courseId);
    const academicYearStart = term?.academicYearStart ?? null;
    const season = seasonForTerm(term?.termNumber ?? null);
    const key = gradeKeysById.get(exam.courseId) ?? `id:${exam.courseId}`;
    const existing = byKey.get(key) ?? {
      sourceId: exam.courseId,
      realId: deriveCelechronRealId(exam.courseId),
      courseCode: null,
      courseName: exam.courseName,
      teachers: [],
      credit: 0,
      academicYearStart,
      season,
      semesterLabel: academicYearStart && season
        ? `${academicYearStart}-${academicYearStart + 1} ${season}`
        : null,
      courseCategory: null,
      gradeSourceId: null,
      examSourceIds: [],
      sessions: []
    } satisfies AcademicCourseRecord;
    if (!existing.examSourceIds.includes(exam.sourceId)) existing.examSourceIds.push(exam.sourceId);
    byKey.set(key, existing);
    registerIdentity(key, existing.courseName, existing.academicYearStart, existing.season);
  }

  for (const term of terms) {
    for (const session of term.sessions) {
      const nameKey = termNameKey(term.academicYearStart, term.season, session.courseName);
      const key = session.courseId
        ? gradeKeysById.get(session.courseId) ?? `id:${session.courseId}`
        : (identityKeysByName.get(nameKey)?.size === 1
          ? [...identityKeysByName.get(nameKey)!][0]
          : sessionBucketsByName.get(nameKey) ?? `session:${nameKey}`);
      const existing = byKey.get(key) ?? {
        sourceId: session.courseId ?? session.sourceId,
        realId: session.courseId ? deriveCelechronRealId(session.courseId) : null,
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
      } satisfies AcademicCourseRecord;
      addSession(existing, session);
      byKey.set(key, existing);
      if (!session.courseId && !identityKeysByName.get(nameKey)?.size) {
        sessionBucketsByName.set(nameKey, key);
      }
    }
  }

  return {
    courses: [...byKey.values()].sort((left, right) =>
      (right.academicYearStart ?? -1) - (left.academicYearStart ?? -1) ||
      left.courseName.localeCompare(right.courseName, "zh-CN")
    )
  };
};

const parseDateValue = (value: unknown): string | null => {
  const text = asString(value)?.trim();
  if (!text) return null;

  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) {
    const year = Number.parseInt(compact[1], 10);
    const month = Number.parseInt(compact[2], 10);
    const day = Number.parseInt(compact[3], 10);
    const candidate = new Date(Date.UTC(year, month - 1, day));
    if (
      candidate.getUTCFullYear() !== year ||
      candidate.getUTCMonth() !== month - 1 ||
      candidate.getUTCDate() !== day
    ) {
      return null;
    }
    return candidate.toISOString();
  }

  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
};

const parsePracticeNumber = (value: unknown, fallback = 0): number => {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) {
    return fallback;
  }
  const parsed = asNumber(value);
  if (parsed === null || !Number.isFinite(parsed)) {
    throw new Error("Practice score field is not a finite number.");
  }
  return parsed;
};

const practiceCategory = (value: Record<string, unknown>): { id: number; name: string } => {
  const category = asRecord(value.xmfl) ?? {};
  const actualName = asString(category.mc)?.trim() ?? "";
  const actualNameId = actualName === "\u7b2c\u4e8c\u8bfe\u5802"
    ? 1
    : actualName === "\u7b2c\u4e09\u8bfe\u5802"
      ? 2
      : actualName === "\u7b2c\u56db\u8bfe\u5802"
        ? 3
        : null;
  if (asInteger(category.id) === null && actualNameId !== null) {
    return { id: actualNameId, name: actualName };
  }
  const name = asString(category.mc)?.trim() ?? "未分类课堂";
  const id = asInteger(category.id) ??
    (name === "第二课堂" ? 1 : name === "第三课堂" ? 2 : name === "第四课堂" ? 3 : 0);
  return { id, name: name === "未分类课堂" && id > 0 ? `${["", "第二", "第三", "第四"][id]}课堂` : name };
};

export const parsePracticeRecordsResponse = (body: string): AcademicPracticeRecord[] => {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch (error) {
    throw new Error("素质拓展实践记录响应不是有效 JSON。", { cause: error });
  }
  const record = asRecord(payload);
  const values = Array.isArray(record?.data)
    ? record.data
    : Array.isArray(payload)
      ? payload
      : null;
  if (!values) throw new Error("素质拓展实践记录响应缺少 data 数组。");

  const records = new Map<string, AcademicPracticeRecord>();
  for (const value of values) {
    const item = asRecord(value);
    if (!item) continue;
    const numericId = asInteger(item.id);
    if (numericId === null) continue;
    const id = String(numericId);
    const project = asRecord(item.xm) ?? {};
    const category = practiceCategory(project);
    const projectType = asRecord(project.xmlb);
    const qualityType = asRecord(project.xmlx);
    const status = asRecord(item.cyrshzt) ?? {};
    const currentState = asRecord(item.currentState) ?? {};
    const statusValue = asInteger(status.value);
    const statusLabel = asString(status.label)?.trim() ??
      asString(currentState.name)?.trim() ?? "状态未知";
    try {
      const record: AcademicPracticeRecord = {
      sourceId: id,
      categoryId: category.id,
      categoryName: category.name,
      projectName: asString(project.mc)?.trim() ?? "未命名项目",
      projectType: asString(projectType?.mc)?.trim() ?? "未填写",
      qualityType: asString(qualityType?.mc)?.trim() ?? "未填写",
      score: parsePracticeNumber(item.jd, -1),
      statusValue,
      statusLabel,
      approved: statusValue === 5 || statusLabel === "审核通过",
      deleted: item.sfsc === true || item.sfsc === 1 || asString(item.sfsc) === "1",
      role: asString(item.hdjjygrcdgz)?.trim() || null,
      remark: asString(item.qksm)?.trim() || null,
      activityStart: parseDateValue(item.hdsj),
      activityEnd: parseDateValue(item.hdjssj),
      updatedAt: parseDateValue(item.gxsj)
      };
      // Celechron parseSztzItems uses putIfAbsent: the first valid record wins.
      if (!record.deleted && !records.has(id)) records.set(id, record);
    } catch {
      // A malformed item must not invalidate the rest of the practice list.
    }
  }
  return [...records.values()];
};

const parsePracticeBoolean = (value: unknown): boolean | null => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    throw new Error("Practice passed field has an invalid numeric value.");
  }
  const text = String(value).trim().toLowerCase();
  if (!text) return null;
  if (new Set([
    "true", "1", "1.0", "yes", "y",
    "\u662f", "\u901a\u8fc7", "\u5df2\u901a\u8fc7", "\u8fbe\u6807", "\u5408\u683c"
  ]).has(text)) return true;
  if (new Set([
    "false", "0", "0.0", "no", "n",
    "\u5426", "\u672a\u901a\u8fc7", "\u4e0d\u901a\u8fc7", "\u672a\u8fbe\u6807", "\u4e0d\u8fbe\u6807", "\u4e0d\u5408\u683c"
  ]).has(text)) return false;
  if (value === 1 || value === "1" || value === "true" || value === "通过" || value === "合格") return true;
  if (value === 0 || value === "0" || value === "false" || value === "未通过" || value === "不合格") return false;
  throw new Error("Practice passed field is not recognized.");
};

export const parsePracticeSummaryResponse = (
  body: string,
  updatedAt: string,
  source: AcademicPracticeSummarySource = "networkMyInfo"
): AcademicPracticeSummary => {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch (error) {
    throw new Error("素质拓展 getMyInfo 响应不是有效 JSON。", { cause: error });
  }
  const envelope = asRecord(payload);
  const extend = asRecord(envelope?.extend);
  const info = asRecord(extend?.myInfo) ?? asRecord(envelope?.myInfo) ?? envelope;
  if (!info) throw new Error("素质拓展 getMyInfo 响应缺少 myInfo 对象。");
  const hasPoint = ["dektJf", "dsktJf", "dsiktJf"].some((field) => Object.hasOwn(info, field));
  if (!hasPoint) throw new Error("素质拓展 getMyInfo 响应缺少记点字段。");
  const secondClassPoints = parsePracticeNumber(info.dektJf);
  const thirdClassPoints = parsePracticeNumber(info.dsktJf);
  const fourthClassPoints = parsePracticeNumber(info.dsiktJf);
  return {
    secondClassPoints,
    thirdClassPoints,
    fourthClassPoints,
    totalPoints: secondClassPoints + thirdClassPoints + fourthClassPoints,
    myPassed: parsePracticeBoolean(info.myTg),
    lastYearPassed: parsePracticeBoolean(info.lyTg),
    source,
    updatedAt,
    stale: source !== "networkMyInfo"
  };
};

export const calculatePracticeSummary = (
  records: readonly AcademicPracticeRecord[],
  updatedAt: string,
  stale: boolean
): AcademicPracticeSummary => {
  const totals = [0, 0, 0, 0];
  for (const record of records) {
    if (record.approved && !record.deleted && record.categoryId >= 1 && record.categoryId <= 3 &&
      Number.isFinite(record.score) && record.score >= 0) {
      totals[record.categoryId] += record.score;
    }
  }
  return {
    secondClassPoints: totals[1],
    thirdClassPoints: totals[2],
    fourthClassPoints: totals[3],
    totalPoints: totals[1] + totals[2] + totals[3],
    myPassed: null,
    lastYearPassed: null,
    source: "calculatedFromRecords",
    updatedAt,
    stale
  };
};

export const parsePracticeData = (
  body: string,
  summaryBody: string | undefined,
  updatedAt: string
): AcademicPracticeData => {
  const records = parsePracticeRecordsResponse(body);
  let summary: AcademicPracticeSummary;
  try {
    summary = parsePracticeSummaryResponse(summaryBody ?? "", updatedAt);
  } catch {
    summary = calculatePracticeSummary(records, updatedAt, false);
  }
  return { records, summary, detailsAvailable: true };
};

export const createZjuUndergraduateConnector = ({
  loadAcademicProfileProof,
  fetchTimetableTerms,
  loadCachedTimetable,
  fetchExams,
  loadCachedExams,
  fetchGrades,
  loadCachedGrades,
  fetchPractice,
  loadCachedPractice,
  loadCachedCourseCatalog,
  publish,
  registerRefreshJob,
  now = () => new Date()
}: ZjuUndergraduateConnectorDependencies) => {
  const refreshExams = async (
    proof: AcademicProfileProof,
    updatedAt: string
  ): Promise<{
    status: "live" | "cache" | "unavailable";
    data: AcademicExamsData | null;
  }> => {
    const result = await fetchExams().catch(
      (error: unknown): ExamsFetchResult => ({
        ok: false,
        message: error instanceof Error ? error.message : "教务网考试请求失败。"
      })
    );
    if (result.ok) {
      try {
        await publish({
          capability: "academic.exams@1",
          accountId: proof.studentId,
          state: "live",
          updatedAt,
          data: { exams: parseExamsResponse(result.body) }
        });
        return { status: "live", data: { exams: parseExamsResponse(result.body) } };
      } catch {
        // A malformed live response must not overwrite the last valid record.
      }
    }

    const cached = await loadCachedExams(proof.studentId);
    if (cached) {
      await publish({
        capability: "academic.exams@1",
        accountId: proof.studentId,
        state: "cache",
        updatedAt,
        data: cached,
        message: "实时考试安排不可用，继续使用上次成功数据。"
      });
      return { status: "cache", data: cached };
    }

    await publish({
      capability: "academic.exams@1",
      accountId: proof.studentId,
      state: "unavailable",
      updatedAt,
      data: null,
      message: result.ok ? "考试响应无法解析。" : result.message
    });
    return { status: "unavailable", data: null };
  };

  const refreshGrades = async (
    proof: AcademicProfileProof,
    updatedAt: string
  ): Promise<{
    status: "live" | "cache" | "unavailable";
    data: AcademicGradesData | null;
  }> => {
    const result = await fetchGrades().catch(
      (error: unknown): GradesFetchResult => ({
        ok: false,
        message: error instanceof Error ? error.message : "教务网成绩请求失败。"
      })
    );
    if (result.ok) {
      try {
        // Celechron: lib/http/ugrs_spider.dart:667-702, 792-795 fetches the
        // transcript and dedicated major transcript, then projects xkkh IDs.
        let data: AcademicGradesData = parseGradesResponse(
          result.body,
          result.majorBody ? parseMajorCourseIdsResponse(result.majorBody) : new Set()
        );
        if (result.majorBody) {
          data = {
            ...data,
            majorSummary: parseMajorGradeSummaryResponse(result.majorBody)
          };
        } else {
          const cached = await loadCachedGrades(proof.studentId);
          const cachedSummary = cached?.majorSummary;
          if (cachedSummary) data = { ...data, majorSummary: cachedSummary };
        }
        await publish({
          capability: "academic.grades@1",
          accountId: proof.studentId,
          state: "live",
          updatedAt,
          data,
          ...(result.majorMessage ? { message: `主修成绩接口暂不可用，已保留最近一次主修汇总。${result.majorMessage}` } : {})
        });
        return { status: "live", data };
      } catch {
        // Malformed live data must not overwrite the last valid publication.
      }
    }

    const cached = await loadCachedGrades(proof.studentId);
    if (cached) {
      await publish({
        capability: "academic.grades@1",
        accountId: proof.studentId,
        state: "cache",
        updatedAt,
        data: cached,
        message: "实时成绩不可用，继续使用上次成功数据。"
      });
      return { status: "cache", data: cached };
    }

    await publish({
      capability: "academic.grades@1",
      accountId: proof.studentId,
      state: "unavailable",
      updatedAt,
      data: null,
      message: result.ok ? "成绩响应无法解析。" : result.message
    });
    return { status: "unavailable", data: null };
  };

  const refreshPractice = async (
    proof: AcademicProfileProof,
    updatedAt: string
  ): Promise<{ status: "live" | "cache" | "fallback" | "unavailable"; data: AcademicPracticeData | null }> => {
    if (!fetchPractice) return { status: "unavailable", data: null };
    const cached = (await loadCachedPractice?.(proof.studentId)) ?? null;
    const result = await fetchPractice().catch(
      (error: unknown): PracticeFetchResult => ({
        ok: false,
        message: error instanceof Error ? error.message : "素质拓展实践记录请求失败。"
      })
    );
    if (result.ok) {
      let records: AcademicPracticeRecord[] | null = null;
      let summary: AcademicPracticeSummary | null = null;
      let detailsLive = false;
      let summaryLive = false;

      if (result.body !== undefined) {
        try {
          records = parsePracticeRecordsResponse(result.body);
          detailsLive = true;
        } catch {
          records = null;
        }
      }
      if (result.summaryBody !== undefined) {
        try {
          summary = parsePracticeSummaryResponse(result.summaryBody, updatedAt);
          summaryLive = true;
        } catch {
          summary = null;
        }
      }
      if (!summary && cached?.summary) {
        summary = { ...cached.summary, source: "cachedMyInfo", stale: true };
      }
      if (!summary && records) {
        summary = calculatePracticeSummary(records, updatedAt, !detailsLive);
      }

      const data = records
        ? { records, summary, detailsAvailable: true }
        : cached
          ? { ...cached, summary }
          : summary
            ? { records: [], summary, detailsAvailable: false }
            : null;
      if (data) {
        const state: "live" | "fallback" | "cache" = detailsLive && summaryLive
          ? "live"
          : detailsLive || summaryLive
            ? "fallback"
            : "cache";
        await publish({
          capability: "practice.records@1",
          accountId: proof.studentId,
          state,
          updatedAt,
          data
        });
        return { status: state, data };
      }
    }

    if (cached) {
      await publish({
        capability: "practice.records@1",
        accountId: proof.studentId,
        state: "cache",
        updatedAt,
        data: cached,
        message: "实时素拓数据不可用，继续使用上次成功数据。"
      });
      return { status: "cache", data: cached };
    }

    await publish({
      capability: "practice.records@1",
      accountId: proof.studentId,
      state: "unavailable",
      updatedAt,
      data: null,
      message: result.ok ? "素质拓展响应无法解析。" : result.message
    });
    return { status: "unavailable", data: null };
  };

  const refresh = async (): Promise<ConnectorRefreshResult> => {
    const proof = await loadAcademicProfileProof();
    const refreshedAt = now();
    const updatedAt = refreshedAt.toISOString();

    if (!proof) {
      await publish({
        capability: "academic.profile@1",
        accountId: null,
        state: "unavailable",
        updatedAt,
        data: null,
        message: "尚未配置并验证浙大统一身份认证账号。"
      });
      // Preserve the last successful content instead of clobbering it: a
      // startup or degraded period with no verified account must still show
      // the previous snapshot (user requirement: load last cache by default).
      const degradedMessage = "未连接账号，继续显示上次成功数据。";
      const [cachedTimetable, cachedExams, cachedGrades, cachedPractice, cachedCatalog] =
        await Promise.all([
          loadCachedTimetable(null).catch(() => null),
          loadCachedExams(null).catch(() => null),
          loadCachedGrades(null).catch(() => null),
          loadCachedPractice?.(null).catch(() => null) ?? Promise.resolve(null),
          loadCachedCourseCatalog?.(null).catch(() => null) ?? Promise.resolve(null)
        ]);
      const publishDegraded = async (
        capability: PluginCapability,
        data: AcademicProfileData | AcademicTimetableData | AcademicExamsData | AcademicGradesData | AcademicPracticeData | AcademicCourseCatalogData | null
      ): Promise<void> => {
        await publish({
          capability,
          accountId: null,
          state: data ? "cache" : "unavailable",
          updatedAt,
          data,
          message: data ? degradedMessage : "尚未配置并验证浙大统一身份认证账号。"
        });
      };
      await publishDegraded("academic.timetable@1", cachedTimetable);
      await publishDegraded("academic.exams@1", cachedExams);
      await publishDegraded("academic.grades@1", cachedGrades);
      await publishDegraded("practice.records@1", cachedPractice);
      await publishDegraded("academic.course-catalog@1", cachedCatalog);
      return {
        sourceId: manifest.id,
        status: "unavailable",
        updatedAt,
        message: "需要先连接浙大统一身份认证账号。"
      };
    }

    await publish({
      capability: "academic.profile@1",
      accountId: proof.studentId,
      state: "cache",
      updatedAt,
      data: {
        studentId: proof.studentId,
        educationLevel: "undergraduate",
        verifiedAt: proof.verifiedAt,
        verifiedService: proof.verifiedService
      }
    });
    const examsResult = await refreshExams(proof, updatedAt);
    const gradesResult = await refreshGrades(proof, updatedAt);

    const queries = createTimetableQueries(refreshedAt, proof.studentId);
    let results: TimetableTermFetchResult[];
    try {
      results = await fetchTimetableTerms(queries);
    } catch (error) {
      results = queries.map((query) => ({
        query,
        ok: false,
        message: error instanceof Error ? error.message : "教务网课表请求失败。"
      }));
    }
    const resultByQuery = new Map(
      results.map((result) => [
        `${result.query.academicYearStart}:${result.query.season}`,
        result
      ])
    );
    const terms: AcademicTimetableTermData[] = queries.map((query) => {
      const result = resultByQuery.get(
        `${query.academicYearStart}:${query.season}`
      );
      if (!result || !result.ok) {
        return {
          ...query,
          state: "unavailable" as const,
          sessions: [],
          message: result?.message ?? "课表请求没有返回结果。"
        };
      }

      try {
        return {
          ...query,
          state: "live" as const,
          sessions: parseTimetableResponse(query, result.body)
        };
      } catch (error) {
        return {
          ...query,
          state: "unavailable" as const,
          sessions: [],
          message: error instanceof Error ? error.message : "课表解析失败。"
        };
      }
    });
    const hasLiveTerm = terms.some((term) => term.state === "live");
    let effectiveTerms = terms;
    let timetableStatus: "live" | "cache" | "fallback" | "unavailable";
    let timetableMessage: string | undefined;
    if (hasLiveTerm) {
      const hasUnavailableTerm = terms.some((term) => term.state === "unavailable");
      const cached = hasUnavailableTerm ? await loadCachedTimetable(proof.studentId) : null;
      effectiveTerms = terms.map((term) => {
        if (term.state === "live") return term;
        const cachedTerm = cached?.terms.find((candidate) =>
          candidate.academicYearStart === term.academicYearStart &&
          candidate.season === term.season
        );
        return cachedTerm
          ? { ...cachedTerm, state: "cache" as const }
          : term;
      });
      const hasAvailableTerm = effectiveTerms.some((term) =>
        term.state === "live" || term.state === "cache"
      );
      timetableStatus = effectiveTerms.every((term) => term.state === "live")
        ? "live"
        : hasAvailableTerm
          ? (hasLiveTerm ? "fallback" : "cache")
          : "unavailable";
      await publish({
        capability: "academic.timetable@1",
        accountId: proof.studentId,
        state: timetableStatus,
        updatedAt,
        data: { terms: effectiveTerms }
      });
    } else {
      const cached = await loadCachedTimetable(proof.studentId);
      const failures = terms.flatMap((term) =>
        term.state === "unavailable" && term.message
          ? [`${term.academicYearStart} ${term.season}: ${term.message}`]
          : []
      ).join("；");
      if (cached) {
        effectiveTerms = cached.terms;
        await publish({
          capability: "academic.timetable@1",
          accountId: proof.studentId,
          state: "cache",
          updatedAt,
          data: cached,
          message: "实时课表不可用，继续使用上次成功数据。"
        });
        timetableStatus = "cache";
        timetableMessage = "实时课表不可用，已使用缓存。";
      } else {
        const message = failures
          ? `教务网课表当前不可用，且没有可用缓存。${failures}`
          : "教务网课表当前不可用，且没有可用缓存。";
        await publish({
          capability: "academic.timetable@1",
          accountId: proof.studentId,
          state: "unavailable",
          updatedAt,
          data: null,
          message
        });
        timetableStatus = "unavailable";
        timetableMessage = message;
      }
    }

    const catalog = buildCourseCatalog({
      terms: effectiveTerms,
      exams: examsResult.data?.exams ?? [],
      grades: gradesResult.data?.grades ?? []
    });
    let catalogStatus: "live" | "cache" | "fallback" | "unavailable" = "unavailable";
    if (catalog.courses.length > 0) {
      const sourceStates = [timetableStatus, examsResult.status, gradesResult.status];
      const hasLiveSource = sourceStates.some((state) => state === "live" || state === "fallback");
      catalogStatus = sourceStates.every((state) => state === "live")
        ? "live"
        : hasLiveSource
          ? "fallback"
          : "cache";
      await publish({
        capability: "academic.course-catalog@1",
        accountId: proof.studentId,
        state: catalogStatus,
        updatedAt,
        data: catalog
      });
    } else {
      const cached = (await loadCachedCourseCatalog?.(proof.studentId)) ?? null;
      await publish({
        capability: "academic.course-catalog@1",
        accountId: proof.studentId,
        state: cached ? "cache" : "unavailable",
        updatedAt,
        data: cached,
        ...(cached ? { message: "实时课程目录不可用，继续使用上次成功数据。" } : {})
      });
      catalogStatus = cached ? "cache" : "unavailable";
    }

    const practiceResult = await refreshPractice(proof, updatedAt);
    const moduleStates = [
      timetableStatus,
      examsResult.status,
      gradesResult.status,
      catalogStatus,
      ...(fetchPractice ? [practiceResult.status] : [])
    ];
    const status = moduleStates.every((state) => state === "live")
      ? "live"
      : moduleStates.every((state) => state === "unavailable")
        ? "unavailable"
        : moduleStates.some((state) => state === "live" || state === "fallback")
          ? "fallback"
          : "cache";
    const message = status === "fallback"
      ? "本科教务部分模块已实时刷新，其余模块使用缓存或当前不可用。"
      : timetableMessage;
    return {
      sourceId: manifest.id,
      status,
      updatedAt,
      message
    };
  };

  return {
    manifest,
    activate: async (context: ConnectorActivationContext) => {
      if (context.pluginId !== manifest.id) {
        throw new Error("本科教务连接器收到错误的插件身份。");
      }
      const missingPermission = manifest.permissions.find(
        (permission) => !context.grantedPermissions.includes(permission)
      );
      if (missingPermission) {
        throw new Error(`本科教务连接器缺少权限：${missingPermission}`);
      }

      const unregister = registerRefreshJob(manifest.id, refresh);
      try {
        await refresh();
      } catch (error) {
        unregister();
        throw error;
      }

      return {
        deactivate: async () => {
          unregister();
        }
      };
    }
  };
};
