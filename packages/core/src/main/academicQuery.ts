import type {
  AcademicExamsData,
  AcademicGradesData,
  AcademicTimetableData,
  AiAssistantAcademicQueryResult,
  AiAssistantEvidenceSource,
  CalendarEventsData,
  CapabilityDataState,
  CapabilityRecord,
  PluginCapability
} from "@campusos/shared";
import {
  AI_ASSISTANT_ACADEMIC_PROMPT_VERSION,
  AI_ASSISTANT_ACADEMIC_SCHEMA,
  AI_ASSISTANT_ACADEMIC_SYSTEM_PROMPT
} from "@campusos/plugin-ai-assistant/prompt";

/** 学业数据问答处理器依赖：只读能力读取 + 已验证学号读取（不暴露任何写接口）。 */
export interface AcademicQueryDataReader {
  loadVerifiedStudentId: () => Promise<string | null>;
  readCapability: <T>(capability: PluginCapability) => Promise<CapabilityRecord<T>[]>;
}

const ACADEMIC_CAPABILITIES: readonly PluginCapability[] = [
  "academic.timetable@1",
  "academic.grades@1",
  "academic.exams@1",
  "calendar.events@1"
] as const;

const CAPABILITY_LABELS: Record<string, string> = {
  "academic.timetable@1": "课表",
  "academic.grades@1": "成绩",
  "academic.exams@1": "考试",
  "calendar.events@1": "日程"
};

const MAX_SESSIONS = 300;
const MAX_GRADES = 300;
const MAX_EXAMS = 100;
const MAX_EVENTS = 300;
const MAX_FIELD_LENGTH = 200;
const MAX_ANSWER_LENGTH = 4000;

const trimText = (value: string | null | undefined, fallback = ""): string =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, MAX_FIELD_LENGTH) : fallback;

/**
 * 意图路由的规则前置分类（快速路径）。
 * 命中强学业信号且无日程动词 → "academic-query"；命中日程动词且无学业名词 → "general"；
 * 其余返回 null，交由结构化抽取（provider）判定。
 */
export const classifyAcademicIntentByRules = (text: string): "academic-query" | "general" | null => {
  const normalized = text.trim().toLocaleLowerCase();
  if (!normalized) return null;

  const academicNouns = [
    "课表", "早八", "成绩", "绩点", "gpa", "学分", "考试", "自习", "点名",
    "第几节", "周几", "星期几", "星期", "上什么课", "有没有课", "几点下课",
    "几点上课", "教室", "座位", "考场", "挂科", "及格", "平均分", "均分",
    "排名", "成绩单", "选课", "课程表", "教学周", "第几周", "什么时候上课"
  ];
  const schedulingVerbs = [
    "安排", "提醒", "记一下", "加入日程", "写进日程", "创建", "设为", "改到",
    "取消", "推迟", "提交", "交作业", "添加到", "日程安排", "备忘"
  ];
  const questionMarkers = ["吗", "哪天", "几号", "几点", "什么", "多少", "周几", "星期几", "第几", "有没有", "哪些", "哪个", "哪门"];

  const hasAcademic = academicNouns.some((token) => normalized.includes(token));
  const hasVerb = schedulingVerbs.some((token) => normalized.includes(token));
  const hasQuestion = questionMarkers.some((token) => normalized.includes(token));

  if (hasAcademic && !hasVerb && hasQuestion) return "academic-query";
  if (hasVerb && !hasAcademic) return "general";
  return null;
};

const isDataRecord = <T>(record: CapabilityRecord<T> | undefined): record is CapabilityRecord<T> & { data: T } =>
  record !== undefined && record.data !== null;

/** 按已验证学号选择记录：优先 accountId === studentId，其次 accountId === null，再取最新 data。 */
const selectAccountRecord = <T>(
  records: readonly CapabilityRecord<T>[],
  studentId: string | null
): (CapabilityRecord<T> & { data: T }) | null => {
  const withData = records.filter(isDataRecord);
  if (withData.length === 0) return null;
  const exact = withData.filter((record) => studentId !== null && record.accountId === studentId);
  const pool = exact.length > 0 ? exact : withData.filter((record) => record.accountId === null);
  const candidates = pool.length > 0 ? pool : withData;
  return [...candidates].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
};

const projectSessions = (timetable: AcademicTimetableData | undefined): unknown[] => {
  if (!timetable) return [];
  const sessions: unknown[] = [];
  for (const term of timetable.terms) {
    for (const session of term.sessions) {
      if (sessions.length >= MAX_SESSIONS) break;
      sessions.push({
        term: `${term.academicYearStart} ${term.season}`,
        courseName: trimText(session.courseName, "未命名课程"),
        teacher: trimText(session.teacher),
        location: trimText(session.location),
        dayOfWeek: session.dayOfWeek,
        periods: session.periods.slice(0, 12),
        weekPattern: session.weekPattern,
        weeks: (session.weeks ?? []).slice(0, 40),
        firstHalf: session.firstHalf,
        secondHalf: session.secondHalf
      });
    }
    if (sessions.length >= MAX_SESSIONS) break;
  }
  return sessions;
};

const projectGrades = (grades: AcademicGradesData | undefined): unknown[] =>
  (grades?.grades ?? []).slice(0, MAX_GRADES).map((grade) => ({
    courseName: trimText(grade.courseName, "未命名课程"),
    originalScore: trimText(grade.originalScore),
    gradePoint: grade.gradePoint,
    credit: grade.credit,
    term: grade.termNumber === null ? null : `${grade.academicYearStart ?? ""} 第${grade.termNumber}学期`
  }));

const projectExams = (exams: AcademicExamsData | undefined): unknown[] =>
  (exams?.exams ?? []).slice(0, MAX_EXAMS).map((exam) => ({
    courseName: trimText(exam.courseName, "未命名课程"),
    kind: exam.kind,
    scheduleText: trimText(exam.scheduleText),
    startAt: trimText(exam.startAt),
    endAt: trimText(exam.endAt),
    location: trimText(exam.location)
  }));

const projectEvents = (events: CalendarEventsData | undefined): unknown[] =>
  (events?.events ?? []).slice(0, MAX_EVENTS).map((event) => ({
    kind: event.kind,
    title: trimText(event.title, "未命名日程"),
    startAt: trimText(event.startAt),
    endAt: trimText(event.endAt),
    courseName: trimText(event.courseName),
    location: trimText(event.location)
  }));

export interface AcademicQueryContextResult {
  /** 已确认有可用数据的证据来源（capability + 抓取时间 + 状态）。 */
  evidenceSources: AiAssistantEvidenceSource[];
  /** 提供给 provider 的最小上下文载荷。 */
  payload: Record<string, unknown>;
}

export const buildAcademicQueryContext = async (
  reader: AcademicQueryDataReader,
  now: () => Date
): Promise<AcademicQueryContextResult> => {
  const studentId = await reader.loadVerifiedStudentId();
  const [timetableRecords, gradesRecords, examsRecords, eventsRecords] = await Promise.all([
    reader.readCapability<AcademicTimetableData>("academic.timetable@1"),
    reader.readCapability<AcademicGradesData>("academic.grades@1"),
    reader.readCapability<AcademicExamsData>("academic.exams@1"),
    reader.readCapability<CalendarEventsData>("calendar.events@1")
  ]);

  const timetable = selectAccountRecord(timetableRecords, studentId);
  const grades = selectAccountRecord(gradesRecords, studentId);
  const exams = selectAccountRecord(examsRecords, studentId);
  const events = selectAccountRecord(eventsRecords, studentId);

  const evidenceSources: AiAssistantEvidenceSource[] = [
    { capability: "academic.timetable@1", label: CAPABILITY_LABELS["academic.timetable@1"], capturedAt: timetable?.updatedAt ?? "", state: timetable?.state ?? "unavailable", message: timetable?.message },
    { capability: "academic.grades@1", label: CAPABILITY_LABELS["academic.grades@1"], capturedAt: grades?.updatedAt ?? "", state: grades?.state ?? "unavailable", message: grades?.message },
    { capability: "academic.exams@1", label: CAPABILITY_LABELS["academic.exams@1"], capturedAt: exams?.updatedAt ?? "", state: exams?.state ?? "unavailable", message: exams?.message },
    { capability: "calendar.events@1", label: CAPABILITY_LABELS["calendar.events@1"], capturedAt: events?.updatedAt ?? "", state: events?.state ?? "unavailable", message: events?.message }
  ];

  const payload: Record<string, unknown> = {
    generatedAt: now().toISOString(),
    timetable: projectSessions(timetable?.data),
    grades: projectGrades(grades?.data),
    exams: projectExams(exams?.data),
    calendarEvents: projectEvents(events?.data)
  };

  return { evidenceSources, payload };
};

const isCapabilityProvided = (capability: unknown, sources: readonly AiAssistantEvidenceSource[]): boolean =>
  typeof capability === "string" &&
  sources.some((source) => source.capability === capability);

const isValidEvidenceValue = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= MAX_FIELD_LENGTH;

/** 校验 provider 返回的 { answer, evidence }；evidence 必须引用真实提供的能力来源。 */
export const validateAcademicQuery = (
  raw: unknown,
  evidenceSources: readonly AiAssistantEvidenceSource[]
): { answer: string; evidence: AiAssistantEvidenceSource[] } => {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("学业数据问答：AI 返回的结果不是对象。");
  }
  const candidate = raw as Record<string, unknown>;
  const answer = candidate.answer;
  if (typeof answer !== "string" || answer.trim().length === 0 || answer.length > MAX_ANSWER_LENGTH) {
    throw new Error("学业数据问答：答案为空或超出长度限制。");
  }
  if (!Array.isArray(candidate.evidence)) {
    throw new Error("学业数据问答：证据字段结构无效。");
  }
  const cited = candidate.evidence.slice(0, 10);
  const evidence: AiAssistantEvidenceSource[] = [];
  for (const item of cited) {
    if (typeof item !== "object" || item === null) throw new Error("学业数据问答：证据条目结构无效。");
    const entry = item as Record<string, unknown>;
    if (!isCapabilityProvided(entry.source, evidenceSources)) {
      throw new Error("学业数据问答：证据引用了不存在的来源。");
    }
    if (!Array.isArray(entry.values) || entry.values.length === 0 || entry.values.length > 20 || !entry.values.every(isValidEvidenceValue)) {
      throw new Error("学业数据问答：证据数值无效。");
    }
    const source = evidenceSources.find((candidateSource) => candidateSource.capability === entry.source);
    if (!source) throw new Error("学业数据问答：证据来源缺失。");
    evidence.push({ ...source, values: (entry.values as string[]).map((value) => value.trim()) });
  }
  return { answer: answer.trim(), evidence };
};

/** 学业能力常量：主进程处理器只读这四个能力；写接口不存在于依赖契约中。 */
export const academicQueryCapabilities = (): readonly PluginCapability[] => ACADEMIC_CAPABILITIES;

export const academicQueryPrompt = {
  systemPrompt: AI_ASSISTANT_ACADEMIC_SYSTEM_PROMPT,
  schemaName: "campus_academic_query_v1",
  schema: AI_ASSISTANT_ACADEMIC_SCHEMA as unknown as Record<string, unknown>,
  promptVersion: AI_ASSISTANT_ACADEMIC_PROMPT_VERSION
};

/** 学业问答降级结果（未验证 / 无数据 / 处理器不可用），不伪造成功。 */
export const createDegradedAcademicQuery = (
  sourceText: string,
  source: AiAssistantAcademicQueryResult["source"],
  reason: "unverified" | "no-data" | "unavailable",
  now: () => Date
): AiAssistantAcademicQueryResult => {
  const message =
    reason === "unverified"
      ? "尚未验证学业账号，暂时无法查询本地学业数据。"
      : reason === "no-data"
        ? "本地暂无学业数据，请先在学业页完成一次同步后再提问。"
        : "学业数据问答暂不可用。";
  return {
    intent: "academic-query",
    sourceText,
    source,
    answer: message,
    evidence: [],
    degraded: true,
    generatedAt: now().toISOString(),
    promptVersion: AI_ASSISTANT_ACADEMIC_PROMPT_VERSION
  };
};

/** 供测试断言处理器只读：数据状态集合即能力声明集合。 */
export const academicQueryCapabilityStates = (): readonly CapabilityDataState[] => ["live", "cache", "fallback", "unavailable"];
