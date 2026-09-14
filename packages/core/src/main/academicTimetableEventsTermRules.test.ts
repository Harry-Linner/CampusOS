import { describe, expect, it } from "vitest";
import type {
  AcademicCalendarConfigData,
  AcademicTimetableData,
  AcademicTimetableSession,
  CalendarEventsData,
  CapabilityRecord
} from "@campusos/shared";
import {
  ZJU_ACADEMIC_TERM_RULES,
  ZJU_STANDARD_PERIOD_TIMES
} from "@campusos/plugin-zju-calendar-config/main";
import { deriveTimetableCalendarEvents } from "@campusos/plugin-academic-timetable-events/main";

/**
 * 校历排课规则的投影回归：放假/考试不排课，调课按被调日排课。
 * 使用内置的官方校历规则与官方节次表，避免测试与产品数据各写一份。
 */
const generatedAt = "2026-09-01T00:00:00.000Z";

const baseConfig: AcademicCalendarConfigData = {
  timezone: "Asia/Shanghai",
  sourceUrl: "https://www.zju.edu.cn/english/19600/list.htm",
  quarters: [
    {
      academicYearStart: 2026,
      season: "1|秋",
      startDate: "2026-09-11",
      classesBeginDate: "2026-09-14",
      endDate: "2026-11-08"
    },
    {
      academicYearStart: 2026,
      season: "1|冬",
      startDate: "2026-11-09",
      classesBeginDate: "2026-11-09",
      endDate: "2027-01-15"
    }
  ],
  periodTimes: ZJU_STANDARD_PERIOD_TIMES,
  termRules: ZJU_ACADEMIC_TERM_RULES
};

const buildSession = (
  overrides: Partial<AcademicTimetableSession> & Pick<AcademicTimetableSession, "dayOfWeek">
): AcademicTimetableSession => ({
  sourceId: `session-${overrides.dayOfWeek}-${overrides.weekPattern ?? "all"}-${overrides.secondHalf ? "lower" : "upper"}`,
  courseName: "测试课程",
  teacher: "测试教师",
  location: "紫金港东1A-301",
  periods: [1, 2],
  firstHalf: true,
  secondHalf: false,
  weekPattern: "all",
  confirmed: true,
  ...overrides
});

const deriveDates = (
  sessions: AcademicTimetableSession[],
  config: AcademicCalendarConfigData = baseConfig
): string[] => {
  const record: CapabilityRecord<AcademicTimetableData> = {
    capability: "academic.timetable@1",
    providerId: "org.campusos.zju-undergraduate",
    accountId: "3240100001",
    state: "live",
    updatedAt: "2026-08-30T00:00:00.000Z",
    data: {
      terms: [
        { academicYearStart: 2026, season: "1|秋", state: "live", sessions }
      ]
    }
  };
  const result: CalendarEventsData = deriveTimetableCalendarEvents(
    [record],
    config,
    generatedAt
  );
  return result.events.map((event) => event.startAt.slice(0, 10)).sort();
};

describe("timetable projection with official calendar rules", () => {
  it("drops the National Day holiday and moves the swapped day onto its makeup date", () => {
    // 周二：10-06 在国庆假期内，但官方校历把它调到 09-20（周日）上。
    const dates = deriveDates([buildSession({ dayOfWeek: 2 })]);

    expect(dates).not.toContain("2026-10-06");
    expect(dates).toContain("2026-09-20");
    expect(dates).toContain("2026-09-15");
    expect(dates).toContain("2026-10-13");
  });

  it("keeps the week pattern of the day being made up", () => {
    // 10-06 是第 4 周（偶数周）：双周课被调到 09-20，单周课不被调。
    const evenWeeks = deriveDates([buildSession({ dayOfWeek: 2, weekPattern: "even" })]);
    const oddWeeks = deriveDates([buildSession({ dayOfWeek: 2, weekPattern: "odd" })]);

    expect(evenWeeks).toContain("2026-09-20");
    expect(oddWeeks).not.toContain("2026-09-20");
  });

  it("drops the Mid-Autumn holiday, the sports days and the exam weekends", () => {
    const monday = deriveDates([buildSession({ dayOfWeek: 1 })]);
    const saturday = deriveDates([buildSession({ dayOfWeek: 6 })]);

    // 10-05 在国庆假期内。
    expect(monday).not.toContain("2026-10-05");
    expect(monday).toContain("2026-09-14");
    expect(monday).toContain("2026-10-12");
    // 周六：09-26 中秋、10-03 国庆、10-24 校运动会、11-07 秋学期考试都不排课。
    expect(saturday).not.toContain("2026-09-26");
    expect(saturday).not.toContain("2026-10-03");
    expect(saturday).not.toContain("2026-10-24");
    expect(saturday).not.toContain("2026-11-07");
    expect(saturday).toContain("2026-09-19");
  });

  it("drops the student festival, the closed-exam period and the swapped target day", () => {
    // 周四：12-31 学生节，其课被调到 2027-01-04。
    const thursday = deriveDates([
      buildSession({ dayOfWeek: 4, firstHalf: false, secondHalf: true })
    ]);
    // 周一：01-04 是调课目标日，当日不按周一排课；01-11 在停课考试期内。
    const monday = deriveDates([
      buildSession({ dayOfWeek: 1, firstHalf: false, secondHalf: true })
    ]);

    expect(thursday).not.toContain("2026-12-31");
    expect(thursday).toContain("2027-01-04");
    expect(monday).not.toContain("2027-01-04");
    expect(monday).not.toContain("2027-01-11");
    expect(monday).toContain("2026-11-09");
  });

  it("leaves academic years without built-in rules untouched", () => {
    const monday = deriveDates(
      [buildSession({ dayOfWeek: 1 })],
      { ...baseConfig, termRules: [] }
    );

    expect(monday).toContain("2026-10-05");
  });
});
