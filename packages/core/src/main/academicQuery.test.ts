import { describe, expect, it, vi } from "vitest";
import type {
  AcademicExamsData,
  AcademicGradesData,
  AcademicTimetableData,
  CalendarEventsData,
  CapabilityRecord
} from "@campusos/shared";
import {
  buildAcademicQueryContext,
  classifyAcademicIntentByRules,
  createDegradedAcademicQuery,
  validateAcademicQuery,
  type AcademicQueryDataReader
} from "./academicQuery";

const record = <T>(capability: string, data: T | null, overrides: Partial<CapabilityRecord<T>> = {}): CapabilityRecord<T> => ({
  capability: capability as CapabilityRecord<T>["capability"],
  providerId: "provider-test",
  accountId: "student-1",
  state: "live",
  updatedAt: "2026-08-05T00:00:00.000Z",
  data,
  ...overrides
});

const timetable: AcademicTimetableData = {
  terms: [{
    academicYearStart: 2026,
    season: "1|秋",
    state: "live",
    sessions: [{
      sourceId: "raw-session-1",
      courseName: "高等数学",
      teacher: "张老师",
      location: "东一 101",
      dayOfWeek: 1,
      periods: [1, 2],
      firstHalf: true,
      secondHalf: false,
      weekPattern: "all",
      confirmed: true
    }]
  }]
};

const grades: AcademicGradesData = {
  grades: [{
    sourceId: "raw-grade-1",
    courseCode: "MATH-101",
    courseName: "高等数学",
    credit: 4,
    originalScore: "92",
    gradePoint: 4.5,
    academicYearStart: 2025,
    termNumber: 1,
    isMajorCourse: true,
    courseCategory: "公共基础"
  }]
};

const exams: AcademicExamsData = {
  exams: [{
    sourceId: "raw-exam-1",
    courseId: "course-1",
    courseName: "高等数学",
    kind: "final",
    scheduleText: "第 18 周周三上午",
    startAt: "2027-01-06T01:00:00.000Z",
    endAt: "2027-01-06T03:00:00.000Z",
    dateLabel: "1 月 6 日",
    location: "东一 201",
    seat: "A-12"
  }]
};

const calendar: CalendarEventsData = {
  feedId: "feed-1",
  sourceId: "academic-affairs",
  sourceLabel: "课表日程",
  sourceUpdatedAt: "2026-08-05T00:00:00.000Z",
  upstreamCapability: "academic.timetable@1",
  upstreamProviderId: "provider-test",
  upstreamProviderIds: ["provider-test"],
  accountScoped: true,
  supportedKinds: ["course", "exam", "assignment", "task"],
  totalItems: 1,
  omittedItems: 0,
  events: [{
    id: "event-1",
    originId: "raw-event-1",
    originCapability: "academic.timetable@1",
    sourceId: "academic-affairs",
    kind: "course",
    title: "高等数学",
    startAt: "2026-09-14T00:00:00.000Z",
    endAt: "2026-09-14T01:40:00.000Z",
    timezone: "Asia/Shanghai",
    location: "东一 101",
    courseName: "高等数学",
    note: null
  }]
};

type ReaderOverrides = {
  loadVerifiedStudentId?: () => Promise<string | null>;
  readCapability?: (capability: string) => Promise<CapabilityRecord<unknown>[]>;
};

const createReader = (overrides: ReaderOverrides = {}): AcademicQueryDataReader => ({
  loadVerifiedStudentId: vi.fn(async () => "student-1"),
  readCapability: vi.fn(async (capability: string): Promise<CapabilityRecord<unknown>[]> => {
    if (capability === "academic.timetable@1") return [record("academic.timetable@1", timetable) as CapabilityRecord<unknown>];
    if (capability === "academic.grades@1") return [record("academic.grades@1", grades) as CapabilityRecord<unknown>];
    if (capability === "academic.exams@1") return [record("academic.exams@1", exams) as CapabilityRecord<unknown>];
    return [record("calendar.events@1", calendar) as CapabilityRecord<unknown>];
  }),
  ...overrides
}) as AcademicQueryDataReader;

describe("classifyAcademicIntentByRules", () => {
  it("routes academic data questions to academic-query", () => {
    expect(classifyAcademicIntentByRules("我下周哪天有早八")).toBe("academic-query");
    expect(classifyAcademicIntentByRules("这学期成绩最好的是哪门")).toBe("academic-query");
    expect(classifyAcademicIntentByRules("我周三第几节有课？")).toBe("academic-query");
    expect(classifyAcademicIntentByRules("绩点现在多少")).toBe("academic-query");
  });

  it("keeps schedule instructions on the general path", () => {
    expect(classifyAcademicIntentByRules("帮我记一下周三交作业")).toBe("general");
    expect(classifyAcademicIntentByRules("把会议安排到周五")).toBe("general");
    expect(classifyAcademicIntentByRules("提醒我明天交报告")).toBe("general");
  });

  it("returns null for ambiguous messages that defer to the structured classifier", () => {
    expect(classifyAcademicIntentByRules("你好")).toBeNull();
    expect(classifyAcademicIntentByRules("晚上吃什么")).toBeNull();
    expect(classifyAcademicIntentByRules("")).toBeNull();
  });
});

describe("buildAcademicQueryContext", () => {
  it("projects only question-relevant fields and attaches evidence sources", async () => {
    const reader = createReader();
    const result = await buildAcademicQueryContext(reader, () => new Date("2026-08-05T00:00:00.000Z"));

    expect(reader.readCapability).toHaveBeenCalledWith("academic.timetable@1");
    expect(reader.readCapability).toHaveBeenCalledWith("academic.grades@1");
    expect(reader.readCapability).toHaveBeenCalledWith("academic.exams@1");
    expect(reader.readCapability).toHaveBeenCalledWith("calendar.events@1");

    const payload = result.payload as {
      timetable: Array<Record<string, unknown>>;
      grades: Array<Record<string, unknown>>;
      exams: Array<Record<string, unknown>>;
      calendarEvents: Array<Record<string, unknown>>;
    };
    expect(payload.timetable[0]).toMatchObject({ courseName: "高等数学", dayOfWeek: 1, periods: [1, 2], weekPattern: "all" });
    expect(payload.timetable[0]).not.toHaveProperty("sourceId");
    expect(payload.timetable[0]).not.toHaveProperty("confirmed");
    expect(payload.grades[0]).toMatchObject({ courseName: "高等数学", originalScore: "92", gradePoint: 4.5 });
    expect(payload.grades[0]).not.toHaveProperty("sourceId");
    expect(payload.grades[0]).not.toHaveProperty("isMajorCourse");
    expect(payload.exams[0]).toMatchObject({ courseName: "高等数学", kind: "final", location: "东一 201" });
    expect(payload.exams[0]).not.toHaveProperty("seat");
    expect(payload.calendarEvents[0]).toMatchObject({ kind: "course", title: "高等数学", startAt: "2026-09-14T00:00:00.000Z" });
    expect(payload.calendarEvents[0]).not.toHaveProperty("originId");

    expect(result.evidenceSources).toEqual(expect.arrayContaining([
      expect.objectContaining({ capability: "academic.timetable@1", label: "课表", capturedAt: "2026-08-05T00:00:00.000Z" }),
      expect.objectContaining({ capability: "academic.grades@1", label: "成绩" }),
      expect.objectContaining({ capability: "academic.exams@1", label: "考试" }),
      expect.objectContaining({ capability: "calendar.events@1", label: "日程" })
    ]));
  });

  it("prefers the verified student's account record over null-account fallback", async () => {
    const reader = createReader({
      readCapability: vi.fn(async (capability: string): Promise<CapabilityRecord<unknown>[]> => {
        if (capability === "academic.grades@1") {
          return [
            record("academic.grades@1", null, { accountId: null, updatedAt: "2026-08-04T00:00:00.000Z" }) as CapabilityRecord<unknown>,
            record("academic.grades@1", grades, { accountId: "student-1", updatedAt: "2026-08-05T00:00:00.000Z" }) as CapabilityRecord<unknown>
          ];
        }
        return [record("academic.timetable@1", null) as CapabilityRecord<unknown>];
      })
    });
    const result = await buildAcademicQueryContext(reader, () => new Date("2026-08-05T00:00:00.000Z"));
    const gradesPayload = result.payload.grades as Array<Record<string, unknown>>;
    expect(gradesPayload).toHaveLength(1);
    expect(result.evidenceSources.find((source) => source.capability === "academic.grades@1")).toMatchObject({ capturedAt: "2026-08-05T00:00:00.000Z" });
  });

  it("marks missing capabilities as unavailable without fabricating data", async () => {
    const reader = createReader({
      readCapability: vi.fn(async () => [])
    });
    const result = await buildAcademicQueryContext(reader, () => new Date("2026-08-05T00:00:00.000Z"));
    expect(result.payload.timetable).toEqual([]);
    expect(result.payload.grades).toEqual([]);
    expect(result.payload.exams).toEqual([]);
    expect(result.payload.calendarEvents).toEqual([]);
    expect(result.evidenceSources.every((source) => source.state === "unavailable")).toBe(true);
  });
});

describe("validateAcademicQuery", () => {
  const evidenceSources = [
    { capability: "academic.timetable@1" as const, label: "课表", capturedAt: "2026-08-05T00:00:00.000Z", state: "live" as const }
  ];

  it("accepts an answer with evidence referencing provided sources", () => {
    const result = validateAcademicQuery(
      { answer: "周一第 1、2 节有高等数学。", evidence: [{ source: "academic.timetable@1", values: ["高等数学", "第1节"] }] },
      evidenceSources
    );
    expect(result).toEqual({
      answer: "周一第 1、2 节有高等数学。",
      evidence: [expect.objectContaining({ capability: "academic.timetable@1", label: "课表", values: ["高等数学", "第1节"] })]
    });
  });

  it("rejects answers that cite sources the processor never provided", () => {
    expect(() =>
      validateAcademicQuery(
        { answer: "成绩是 92 分。", evidence: [{ source: "academic.grades@1", values: ["92"] }] },
        evidenceSources
      )
    ).toThrow("证据引用了不存在的来源");
  });

  it("rejects empty answers and malformed evidence", () => {
    expect(() => validateAcademicQuery({ answer: "", evidence: [] }, evidenceSources)).toThrow("答案为空");
    expect(() => validateAcademicQuery({ answer: "x", evidence: [{ source: "academic.timetable@1", values: [] }] }, evidenceSources)).toThrow("证据数值无效");
    expect(() => validateAcademicQuery({ answer: "x", evidence: "bad" }, evidenceSources)).toThrow("证据字段结构无效");
  });
});

describe("createDegradedAcademicQuery", () => {
  it("returns a clear degradation message without fabricating success", () => {
    const result = createDegradedAcademicQuery(
      "我成绩多少",
      { app: "manual", sentAt: null },
      "unverified",
      () => new Date("2026-08-05T00:00:00.000Z")
    );
    expect(result).toMatchObject({
      intent: "academic-query",
      degraded: true,
      answer: expect.stringContaining("尚未验证学业账号"),
      evidence: []
    });
    expect(createDegradedAcademicQuery("x", { app: "manual", sentAt: null }, "no-data", () => new Date()).answer).toContain("暂无学业数据");
  });
});
