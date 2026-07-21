import type {
  AcademicExamRecord,
  AcademicExamsData,
  AcademicGradeRecord,
  AcademicGradesData,
  AcademicProfileData,
  AcademicTimetableData,
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
  | { ok: true; body: string }
  | { ok: false; message: string };

export interface ZjuUndergraduateConnectorDependencies {
  loadAcademicProfileProof: () => Promise<AcademicProfileProof | null>;
  fetchTimetableTerms: (
    queries: readonly TimetableQuery[]
  ) => Promise<TimetableTermFetchResult[]>;
  loadCachedTimetable: (
    accountId: string
  ) => Promise<AcademicTimetableData | null>;
  fetchExams: () => Promise<ExamsFetchResult>;
  loadCachedExams: (accountId: string) => Promise<AcademicExamsData | null>;
  fetchGrades: () => Promise<GradesFetchResult>;
  loadCachedGrades: (accountId: string) => Promise<AcademicGradesData | null>;
  publish: (
    publication: CapabilityPublication<
      | AcademicProfileData
      | AcademicTimetableData
      | AcademicExamsData
      | AcademicGradesData
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

export const createTimetableQueries = (now: Date): TimetableQuery[] => {
  const calendarYear = now.getFullYear();
  const currentAcademicYearStart =
    now.getMonth() >= 8 ? calendarYear : calendarYear - 1;

  return [currentAcademicYearStart, currentAcademicYearStart + 1].flatMap(
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
      ? scheduleText
          .slice(0, timeMatch?.index ?? scheduleText.length)
          .replace(/[（(\s]+$/, "")
          .trim() || null
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

const parseGradeRecord = (value: unknown): AcademicGradeRecord | null => {
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
    courseCode: asString(item.kch)?.trim() || termMatch?.[4] || null,
    courseName: (asString(item.kcmc)?.trim() || "未知课程")
      .replaceAll("(", "（")
      .replaceAll(")", "）"),
    credit: credit !== null && credit >= 0 ? credit : 0,
    originalScore: asString(item.cj)?.trim() ?? "",
    gradePoint: gradePoint !== null && gradePoint >= 0 ? gradePoint : null,
    academicYearStart,
    termNumber,
    isMajorCourse: true,
    courseCategory: asString(item.kcxz)?.trim() || null
  };
};

export const parseGradesResponse = (body: string): AcademicGradesData => {
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
    .map(parseGradeRecord)
    .filter((grade): grade is AcademicGradeRecord => grade !== null);
  return {
    grades: [...new Map(grades.map((grade) => [grade.sourceId, grade])).values()]
  };
};

export const createZjuUndergraduateConnector = ({
  loadAcademicProfileProof,
  fetchTimetableTerms,
  loadCachedTimetable,
  fetchExams,
  loadCachedExams,
  fetchGrades,
  loadCachedGrades,
  publish,
  registerRefreshJob,
  now = () => new Date()
}: ZjuUndergraduateConnectorDependencies) => {
  const refreshExams = async (
    proof: AcademicProfileProof,
    updatedAt: string
  ): Promise<"live" | "cache" | "unavailable"> => {
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
        return "live";
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
      return "cache";
    }

    await publish({
      capability: "academic.exams@1",
      accountId: proof.studentId,
      state: "unavailable",
      updatedAt,
      data: null,
      message: result.ok ? "考试响应无法解析。" : result.message
    });
    return "unavailable";
  };

  const refreshGrades = async (
    proof: AcademicProfileProof,
    updatedAt: string
  ): Promise<"live" | "cache" | "unavailable"> => {
    const result = await fetchGrades().catch(
      (error: unknown): GradesFetchResult => ({
        ok: false,
        message: error instanceof Error ? error.message : "教务网成绩请求失败。"
      })
    );
    if (result.ok) {
      try {
        await publish({
          capability: "academic.grades@1",
          accountId: proof.studentId,
          state: "live",
          updatedAt,
          data: parseGradesResponse(result.body)
        });
        return "live";
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
      return "cache";
    }

    await publish({
      capability: "academic.grades@1",
      accountId: proof.studentId,
      state: "unavailable",
      updatedAt,
      data: null,
      message: result.ok ? "成绩响应无法解析。" : result.message
    });
    return "unavailable";
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
      await publish({
        capability: "academic.timetable@1",
        accountId: null,
        state: "unavailable",
        updatedAt,
        data: null,
        message: "尚未配置并验证浙大统一身份认证账号。"
      });
      await publish({
        capability: "academic.exams@1",
        accountId: null,
        state: "unavailable",
        updatedAt,
        data: null,
        message: "尚未配置并验证浙大统一身份认证账号。"
      });
      await publish({
        capability: "academic.grades@1",
        accountId: null,
        state: "unavailable",
        updatedAt,
        data: null,
        message: "尚未配置并验证浙大统一身份认证账号。"
      });
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
    const examsStatus = await refreshExams(proof, updatedAt);
    const gradesStatus = await refreshGrades(proof, updatedAt);

    const queries = createTimetableQueries(refreshedAt);
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
    const terms = queries.map((query) => {
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
    let timetableStatus: "live" | "cache" | "unavailable";
    let timetableMessage: string | undefined;
    if (hasLiveTerm) {
      await publish({
        capability: "academic.timetable@1",
        accountId: proof.studentId,
        state: "live",
        updatedAt,
        data: { terms }
      });
      timetableStatus = "live";
    } else {
      const cached = await loadCachedTimetable(proof.studentId);
      if (cached) {
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
        await publish({
          capability: "academic.timetable@1",
          accountId: proof.studentId,
          state: "unavailable",
          updatedAt,
          data: null,
          message: "教务网课表当前不可用，且没有可用缓存。"
        });
        timetableStatus = "unavailable";
        timetableMessage = "教务网课表当前不可用。";
      }
    }

    const moduleStates = [timetableStatus, examsStatus, gradesStatus];
    const status = moduleStates.every((state) => state === "live")
      ? "live"
      : moduleStates.every((state) => state === "unavailable")
        ? "unavailable"
        : moduleStates.includes("live")
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
