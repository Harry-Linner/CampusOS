import { describe, expect, it } from "vitest";
import {
  buildZhiyunReplayUrl,
  extractTeacherFromScheduleNote,
  isOpenableExternalUrl,
  resolveZhiyunCourse,
  shanghaiDateKey,
  zhiyunDayQueryPlan,
  type ZhiyunCourseEntry
} from "@campusos/shared";

const entry = (overrides: Partial<ZhiyunCourseEntry> = {}): ZhiyunCourseEntry => ({
  courseId: "86240",
  subId: "1966542",
  courseName: "计算机网络",
  subTitle: "计算机网络(2026秋冬)",
  teacher: "张三",
  observedDay: null,
  ...overrides
});

describe("resolveZhiyunCourse", () => {
  it("matches a single same-name course", () => {
    const result = resolveZhiyunCourse([entry()], { courseName: "计算机网络" });
    expect(result.entry?.subId).toBe("1966542");
    expect(result.courseId).toBe("86240");
  });

  it("ignores whitespace and full-width differences when comparing names", () => {
    expect(resolveZhiyunCourse([entry({ courseName: "计算机 网络" })], { courseName: "计算机网络" }).entry).not.toBeNull();
    expect(resolveZhiyunCourse([entry({ courseName: "Ｃ语言程序设计" })], { courseName: "C语言程序设计" }).entry).not.toBeNull();
  });

  it("does not match a different course that only shares a prefix", () => {
    // 智云里同时存在「操作系统」与「操作系统实验」，前缀包含匹配会把学生送进错误的班。
    expect(resolveZhiyunCourse([entry({ courseName: "操作系统实验" })], { courseName: "操作系统" }).entry).toBeNull();
    expect(resolveZhiyunCourse([entry({ courseName: "计算机网络" })], { courseName: "计算机网络实验" }).entry).toBeNull();
  });

  it("uses the teacher to disambiguate same-name classes", () => {
    const entries = [
      entry({ subId: "1", teacher: "李四" }),
      entry({ subId: "2", teacher: "王五" })
    ];
    expect(resolveZhiyunCourse(entries, { courseName: "计算机网络", teacher: "王五" }).entry?.subId).toBe("2");
  });

  it("picks the session observed on the clicked day when one class meets several times a week", () => {
    // 同一门课一周上三次：只有按天列表带得出的 observedDay 才能挑中用户点的那一节。
    const entries = [
      entry({ subId: "mon", teacher: "张三", observedDay: "2026-09-14" }),
      entry({ subId: "tue", teacher: "张三", observedDay: "2026-09-15" }),
      entry({ subId: "thu", teacher: "张三", observedDay: "2026-09-17" })
    ];
    const result = resolveZhiyunCourse(entries, { courseName: "计算机网络", teacher: "张三", startAt: "2026-09-15T10:00:00+08:00" });
    expect(result.entry?.subId).toBe("tue");
  });

  it("still prefers the clicked day when the upstream teacher string differs", () => {
    const entries = [
      entry({ subId: "mon", teacher: "李四", observedDay: "2026-09-14" }),
      entry({ subId: "tue", teacher: "李四", observedDay: "2026-09-15" })
    ];
    const result = resolveZhiyunCourse(entries, { courseName: "计算机网络", teacher: "张三", startAt: "2026-09-15T10:00:00+08:00" });
    expect(result.entry?.subId).toBe("tue");
  });

  it("does not guess a session when the clicked day is unknown", () => {
    // 月列表（无 observedDay）遇到同名多班时必须拒绝挑节次，否则会静默打开别的周的录像。
    const entries = [
      entry({ subId: "1", teacher: null }),
      entry({ subId: "2", teacher: null })
    ];
    const result = resolveZhiyunCourse(entries, { courseName: "计算机网络" });
    expect(result.entry).toBeNull();
    // 但同一门课的 course_id 仍然可信，调用方可以据此打开课程页。
    expect(result.courseId).toBe("86240");
  });

  it("withholds the course id when the same-name candidates are different courses", () => {
    const entries = [
      entry({ courseId: "1", subId: "1", teacher: null }),
      entry({ courseId: "2", subId: "2", teacher: null })
    ];
    expect(resolveZhiyunCourse(entries, { courseName: "计算机网络" })).toEqual({ entry: null, courseId: null });
  });

  it("returns nothing for an empty name or empty list", () => {
    expect(resolveZhiyunCourse([entry()], { courseName: "  " })).toEqual({ entry: null, courseId: null });
    expect(resolveZhiyunCourse([], { courseName: "计算机网络" })).toEqual({ entry: null, courseId: null });
  });
});

describe("zhiyunDayQueryPlan", () => {
  it("asks for the clicked day first, then spreads across that same Shanghai week", () => {
    // 2026-09-15 是周二，所在周为 09-14(一) ~ 09-20(日)。
    const plan = zhiyunDayQueryPlan("2026-09-15T10:00:00+08:00");
    expect(plan[0]).toBe("2026-09-15");
    expect(plan[1]).toBe("2026-09-14");
    expect(plan[2]).toBe("2026-09-16");
    expect([...plan].sort()).toEqual([
      "2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20"
    ]);
  });

  it("stays inside the week for the first and last day of it", () => {
    expect(zhiyunDayQueryPlan("2026-09-14T08:00:00+08:00").slice(0, 2)).toEqual(["2026-09-14", "2026-09-15"]);
    expect(zhiyunDayQueryPlan("2026-09-20T08:00:00+08:00").slice(0, 2)).toEqual(["2026-09-20", "2026-09-19"]);
  });

  it("uses the Shanghai clock rather than the host clock", () => {
    // 上海 09-15 00:30 在 UTC 还是 09-14 16:30，日期键必须按上海算。
    expect(zhiyunDayQueryPlan("2026-09-15T00:30:00+08:00")[0]).toBe("2026-09-15");
    expect(shanghaiDateKey(new Date("2026-09-14T16:30:00Z"))).toBe("2026-09-15");
  });

  it("returns nothing for an unusable timestamp", () => {
    expect(zhiyunDayQueryPlan("not-a-date")).toEqual([]);
  });
});

describe("buildZhiyunReplayUrl", () => {
  it("builds the interactive-meta replay URL with the undergraduate tenant", () => {
    expect(buildZhiyunReplayUrl(entry())).toBe(
      "https://interactivemeta.cmc.zju.edu.cn/#/replay?course_id=86240&sub_id=1966542&tenant_code=112"
    );
  });

  it("honours a tenant from the upstream entry", () => {
    expect(buildZhiyunReplayUrl(entry({ tenantCode: "9" }))).toContain("tenant_code=9");
  });
});

describe("extractTeacherFromScheduleNote", () => {
  it("pulls the teacher out of the upstream timetable note", () => {
    expect(extractTeacherFromScheduleNote("教师：张三")).toBe("张三");
    expect(extractTeacherFromScheduleNote("教师: 李四")).toBe("李四");
  });

  it("stops at the next field when the note carries more than the teacher", () => {
    expect(extractTeacherFromScheduleNote("教师：张三 地点：东1-101")).toBe("张三");
    expect(extractTeacherFromScheduleNote("教师：张三，王五")).toBe("张三");
  });

  it("returns null when there is no teacher to read", () => {
    expect(extractTeacherFromScheduleNote("")).toBeNull();
    expect(extractTeacherFromScheduleNote(null)).toBeNull();
    expect(extractTeacherFromScheduleNote(undefined)).toBeNull();
    expect(extractTeacherFromScheduleNote("自备笔记本")).toBeNull();
    expect(extractTeacherFromScheduleNote("教师：")).toBeNull();
  });
});

describe("isOpenableExternalUrl", () => {
  it("accepts absolute http(s) URLs only", () => {
    expect(isOpenableExternalUrl("https://classroom.zju.edu.cn/")).toBe(true);
    expect(isOpenableExternalUrl("http://example.com/a")).toBe(true);
    expect(isOpenableExternalUrl("httpevil://classroom.zju.edu.cn")).toBe(false);
    expect(isOpenableExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isOpenableExternalUrl("classroom.zju.edu.cn")).toBe(false);
    expect(isOpenableExternalUrl(123)).toBe(false);
  });
});
