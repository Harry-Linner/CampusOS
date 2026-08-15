/* @vitest-environment jsdom */

import { createElement } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type {
  AcademicCalendarConfigData,
  AcademicCourseCatalogData,
  AcademicPracticeData,
  AcademicTimetableData,
  AcademicTimetableSession,
  CapabilityRecord,
  PluginCapability,
  PluginCapabilityClient
} from "@campusos/shared";
import { AcademicView } from "@campusos/plugin-academic";

afterEach(cleanup);

const record = <T,>(
  capability: PluginCapability,
  data: T
): CapabilityRecord<T> => ({
  capability,
  providerId:
    capability === "academic.calendar-config@1"
      ? "org.campusos.zju-calendar-config"
      : "org.campusos.zju-undergraduate",
  accountId: capability === "academic.calendar-config@1" ? null : "fixture-account",
  state: "live",
  updatedAt: "2026-08-04T00:00:00.000Z",
  data
});

const baseSession: AcademicTimetableSession = {
  sourceId: "target-session-autumn",
  courseName: "目标学期课程",
  teacher: "任课教师",
  location: "教学楼 101",
  dayOfWeek: 1,
  periods: [1, 2],
  firstHalf: true,
  secondHalf: false,
  weekPattern: "all",
  confirmed: true
};

const timetable: AcademicTimetableData = {
  terms: [
    {
      academicYearStart: 2025,
      season: "2|夏",
      state: "live",
      sessions: [
        {
          ...baseSession,
          sourceId: "historical-session",
          courseName: "历史学期课程"
        }
      ]
    },
    {
      academicYearStart: 2026,
      season: "1|秋",
      state: "live",
      sessions: [baseSession]
    },
    {
      academicYearStart: 2026,
      season: "1|冬",
      state: "live",
      sessions: [
        {
          ...baseSession,
          sourceId: "target-session-winter",
          firstHalf: false,
          secondHalf: true
        }
      ]
    },
    {
      academicYearStart: 2026,
      season: "2|春",
      state: "live",
      sessions: []
    },
    {
      academicYearStart: 2026,
      season: "2|夏",
      state: "live",
      sessions: []
    }
  ]
};

const calendar: AcademicCalendarConfigData = {
  timezone: "Asia/Shanghai",
  sourceUrl: "https://www.zju.edu.cn/english/19600/list.htm",
  quarters: [
    {
      academicYearStart: 2025,
      season: "2|夏",
      startDate: "2026-04-27",
      classesBeginDate: "2026-04-27",
      endDate: "2026-07-05"
    },
    {
      academicYearStart: 2026,
      season: "1|秋",
      startDate: "2026-09-11",
      classesBeginDate: "2026-09-14",
      endDate: "2026-11-15"
    },
    {
      academicYearStart: 2026,
      season: "1|冬",
      startDate: "2026-11-09",
      classesBeginDate: "2026-11-09",
      endDate: "2027-01-15"
    },
    {
      academicYearStart: 2026,
      season: "2|春",
      startDate: "2027-02-20",
      classesBeginDate: "2027-02-22",
      endDate: "2027-04-25"
    },
    {
      academicYearStart: 2026,
      season: "2|夏",
      startDate: "2027-04-19",
      classesBeginDate: "2027-04-19",
      endDate: "2027-07-04"
    }
  ],
  periodTimes: [
    { period: 1, start: "08:00", end: "08:45" },
    { period: 2, start: "08:50", end: "09:35" }
  ]
};

const courses: AcademicCourseCatalogData = {
  courses: [
    {
      sourceId: "course-1",
      realId: "REAL-1",
      courseCode: "COURSE101",
      courseName: "目标学期课程",
      teachers: ["任课教师"],
      credit: 2,
      academicYearStart: 2026,
      season: "1|秋",
      semesterLabel: "2026-2027 秋冬学期",
      courseCategory: null,
      gradeSourceId: null,
      examSourceIds: ["exam-1"],
      sessions: []
    },
    {
      sourceId: "course-2",
      realId: "REAL-2",
      courseCode: "COURSE202",
      courseName: "第二门课程",
      teachers: ["另一位教师"],
      credit: 3,
      academicYearStart: 2026,
      season: "1|冬",
      semesterLabel: "2026-2027 秋冬学期",
      courseCategory: null,
      gradeSourceId: null,
      examSourceIds: [],
      sessions: []
    }
  ]
};

const practice: AcademicPracticeData = {
  records: [
    {
      sourceId: "practice-1",
      categoryId: 2,
      categoryName: "第二课堂",
      projectName: "实践项目",
      projectType: "实践",
      qualityType: "second",
      score: 2,
      statusValue: 1,
      statusLabel: "通过",
      approved: true,
      deleted: false,
      role: null,
      remark: null,
      activityStart: null,
      activityEnd: null,
      updatedAt: null
    }
  ],
  summary: {
    secondClassPoints: 2,
    thirdClassPoints: 0,
    fourthClassPoints: 0,
    totalPoints: 2,
    myPassed: true,
    lastYearPassed: null,
    source: "networkMyInfo",
    updatedAt: "2026-08-04T00:00:00.000Z",
    stale: false
  },
  detailsAvailable: true
};

const createCapabilities = (reads: string[]): PluginCapabilityClient => ({
  read: async <T,>(capability: PluginCapability) => {
    reads.push(capability);
    if (capability === "academic.timetable@1") {
      return [record(capability, timetable)] as unknown as CapabilityRecord<T>[];
    }
    if (capability === "academic.calendar-config@1") {
      return [record(capability, calendar)] as unknown as CapabilityRecord<T>[];
    }
    if (capability === "academic.course-catalog@1") {
      return [record(capability, courses)] as unknown as CapabilityRecord<T>[];
    }
    if (capability === "practice.records@1") {
      return [record(capability, practice)] as unknown as CapabilityRecord<T>[];
    }
    return [];
  }
});

describe("AcademicView", () => {
  it("selects the next complete autumn-winter semester after the summer fallback window", async () => {
    render(
      createElement(AcademicView, {
        capabilities: createCapabilities([]),
        loading: false,
        onRefresh: async () => undefined,
        snapshot: { generatedAt: "2026-08-30T00:00:00.000Z" } as never
      })
    );

    const semester = await screen.findByRole("combobox", { name: "学期" });
    expect((semester as HTMLSelectElement).value).toBe("2026:1");
    expect(screen.getByText("目标学期课程")).toBeDefined();
    expect(screen.queryByText("历史学期课程")).toBeNull();
    expect(screen.getAllByText("目标学期课程")).toHaveLength(1);

    fireEvent.change(semester, { target: { value: "2026:2" } });
    expect(screen.getByText("这个学期暂时没有课程安排。")).toBeDefined();
  });

  it("prefers the spring-summer term (含小学期) inside the summer fallback window", async () => {
    render(
      createElement(AcademicView, {
        capabilities: createCapabilities([]),
        loading: false,
        onRefresh: async () => undefined,
        snapshot: { generatedAt: "2026-07-28T00:00:00.000Z" } as never
      })
    );

    // 2026-07-28 is 23 days after the 2|夏 window ended (2026-07-05), so the
    // 45-day fallback keeps the spring-summer term selected and 小学期 courses
    // stay visible instead of jumping to the next autumn-winter term.
    const semester = await screen.findByRole("combobox", { name: "学期" });
    expect((semester as HTMLSelectElement).value).toBe("2025:2");
    expect(screen.getByText("历史学期课程")).toBeDefined();
    expect(screen.queryByText("目标学期课程")).toBeNull();
  });

  it("exposes five internal tabs and reads the selected academic capabilities", async () => {
    const reads: string[] = [];
    const capabilities = createCapabilities(reads);
    const { rerender } = render(
      createElement(AcademicView, {
        capabilities,
        loading: false,
        onRefresh: async () => undefined,
        snapshot: { generatedAt: "2026-08-30T00:00:00.000Z" } as never
      })
    );

    expect(screen.getByRole("button", { name: "课表" })).toBeDefined();
    expect(screen.getByRole("button", { name: "课程" })).toBeDefined();
    expect(screen.getByRole("button", { name: "考试" })).toBeDefined();
    expect(screen.getByRole("button", { name: "成绩" })).toBeDefined();
    expect(screen.getByRole("button", { name: "素拓" })).toBeDefined();
    expect(await screen.findByText("目标学期课程")).toBeDefined();
    expect(reads).toContain("academic.calendar-config@1");

    fireEvent.click(screen.getByRole("button", { name: "课程" }));
    expect(await screen.findByPlaceholderText("搜索课程、代码或学期")).toBeDefined();
    fireEvent.change(screen.getByRole("textbox", { name: "搜索课程" }), {
      target: { value: "COURSE101" }
    });
    expect(screen.getByText("REAL-1")).toBeDefined();

    fireEvent.change(screen.getByRole("textbox", { name: "搜索课程" }), {
      target: { value: "" }
    });
    fireEvent.click(screen.getByRole("button", { name: /第二门课程/ }));
    expect(screen.getByText("REAL-2")).toBeDefined();
    fireEvent.change(screen.getByRole("textbox", { name: "搜索课程" }), {
      target: { value: "COURSE101" }
    });
    expect(screen.getByText("REAL-1")).toBeDefined();
    expect(screen.queryByText("REAL-2")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "素拓" }));
    expect(await screen.findByText("实践项目")).toBeDefined();
    expect(reads).toContain("practice.records@1");

    const beforeRefresh = reads.length;
    rerender(
      createElement(AcademicView, {
        capabilities,
        loading: false,
        onRefresh: async () => undefined,
        snapshot: { generatedAt: "2026-08-30T00:01:00.000Z" } as never
      })
    );
    await waitFor(() => expect(reads.length).toBeGreaterThan(beforeRefresh));
  });
});
