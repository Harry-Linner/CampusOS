import { describe, expect, it } from "vitest";
import type { AcademicGradeRecord } from "@campusos/shared";
import { summarizeAcademicGrades } from "@campusos/plugin-academic-grades/model";

describe("academic grades feature", () => {
  it("weights only explicit grade points and keeps unknown terms separate", () => {
    const grades: AcademicGradeRecord[] = [
      {
        sourceId: "grade-1",
        courseCode: "CS101",
        courseName: "程序设计",
        credit: 3,
        originalScore: "92",
        gradePoint: 4.2,
        academicYearStart: 2025,
        termNumber: 1,
        isMajorCourse: true,
        courseCategory: null
      },
      {
        sourceId: "grade-2",
        courseCode: null,
        courseName: "劳动教育",
        credit: 1,
        originalScore: "优秀",
        gradePoint: null,
        academicYearStart: 2025,
        termNumber: 1,
        isMajorCourse: false,
        courseCategory: null
      },
      {
        sourceId: "grade-3",
        courseCode: "MATH100",
        courseName: "微积分",
        credit: 5,
        originalScore: "85",
        gradePoint: 3.7,
        academicYearStart: null,
        termNumber: null,
        isMajorCourse: true,
        courseCategory: null
      }
    ];

    const summary = summarizeAcademicGrades(grades);

    expect(summary.courseCount).toBe(3);
    expect(summary.totalCredits).toBe(9);
    expect(summary.gradedCredits).toBe(8);
    expect(summary.majorGradedCredits).toBe(8);
    expect(summary.weightedGradePoint).toBeCloseTo(3.8875);
    expect(summary.majorWeightedGradePoint).toBeCloseTo(3.8875);
    expect(summary.terms.map((term) => term.label)).toEqual([
      "2025-2026 学年 第 1 学期",
      "学期信息待确认"
    ]);
  });
});

describe("inferGpaScale", () => {
  it("returns 5.0 when any grade point exceeds 4.0", async () => {
    const { inferGpaScale } = await import("@campusos/plugin-academic-grades/model");
    expect(
      inferGpaScale([
        { sourceId: "a", courseCode: null, courseName: "A", credit: 1, originalScore: "90", gradePoint: 4.5, academicYearStart: 2025, termNumber: 1, isMajorCourse: true, courseCategory: null }
      ])
    ).toBe("5.0");
    expect(
      inferGpaScale([
        { sourceId: "a", courseCode: null, courseName: "A", credit: 1, originalScore: "90", gradePoint: 3.8, academicYearStart: 2025, termNumber: 1, isMajorCourse: true, courseCategory: null }
      ])
    ).toBe("4.0");
  });
});
