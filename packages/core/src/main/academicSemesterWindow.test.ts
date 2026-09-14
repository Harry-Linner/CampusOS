/**
 * 学期窗口起点的回归测试。
 *
 * 被测代码在 `@campusos/shared`（该包没有独立的测试运行器），因此这里放一份
 * 由 core 的 vitest 执行的用例。
 */
import { describe, expect, it } from "vitest";
import type { AcademicCalendarQuarter } from "@campusos/shared";
import { buildAcademicSemesterWindows } from "@campusos/shared";

// 2026-2027 秋冬的真实学季边界：区间起始日 2026-09-11 是报到注册日，开始上课为 09-14。
const quarters: AcademicCalendarQuarter[] = [
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
];

describe("academic semester windows", () => {
  it("starts the semester on the first teaching day, not the quarter range start", () => {
    const windows = buildAcademicSemesterWindows(quarters);

    expect(windows).toHaveLength(1);
    expect(windows[0].startDate).toBe("2026-09-14");
    expect(windows[0].endDate).toBe("2027-01-15");
  });
});
