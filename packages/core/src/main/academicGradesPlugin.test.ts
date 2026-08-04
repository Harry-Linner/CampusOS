import { describe, expect, it } from "vitest";
import type { AcademicGradeRecord } from "@campusos/shared";
import {
  calculateAcademicGpa,
  summarizeAcademicGrades
} from "@campusos/plugin-academic/gradesModel";

describe("academic grades feature", () => {
  it("matches Celechron's four GPA projections and keeps unknown terms separate", () => {
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
    expect(summary.totalCredits).toBe(8);
    expect(summary.gradedCredits).toBe(9);
    expect(summary.majorGradedCredits).toBe(8);
    expect(summary.weightedGradePoint).toBeCloseTo(3.4556, 3);
    expect(summary.majorWeightedGradePoint).toBeCloseTo(3.8875, 3);
    expect(summary.fourPointGpa).toBeCloseTo(3.3889, 3);
    expect(summary.fourPointLegacyGpa).toBeCloseTo(3.3889, 3);
    expect(summary.hundredPointGpa).toBeCloseTo(87.8889, 3);
    expect(summary.majorFourPointGpa).toBeCloseTo(3.8125, 3);
    expect(summary.majorFourPointLegacyGpa).toBeCloseTo(3.8125, 3);
    expect(summary.majorHundredPointGpa).toBeCloseTo(87.625, 3);
    expect(summary.terms.map((term) => term.label)).toEqual([
      "2025-2026 学年 第 1 学期",
      "学期信息待确认"
    ]);
  });
});

describe("Celechron GPA conversion and custom weights", () => {
  it("returns zero GPA projections when no course contributes GPA", () => {
    const result = calculateAcademicGpa([
      {
        sourceId: "deferred",
        courseCode: null,
        courseName: "deferred",
        credit: 2,
        originalScore: "缓考",
        gradePoint: 0,
        academicYearStart: 2025,
        termNumber: 1,
        isMajorCourse: false,
        courseCategory: null
      }
    ]);

    expect(result).toEqual({
      fivePoint: 0,
      fourPoint: 0,
      fourPointLegacy: 0,
      hundredPoint: 0,
      credits: 0,
      earnedCredits: 0
    });
  });

  it("uses exact 5-to-4.3 mappings and keeps credits unchanged when weighted", () => {
    const grades: AcademicGradeRecord[] = [
      { sourceId: "a", courseCode: null, courseName: "a", credit: 3, originalScore: "95", gradePoint: 5, academicYearStart: 2025, termNumber: 1, isMajorCourse: true, courseCategory: null },
      { sourceId: "b", courseCode: null, courseName: "b", credit: 1, originalScore: "90", gradePoint: 4.5, academicYearStart: 2025, termNumber: 1, isMajorCourse: false, courseCategory: null }
    ];
    const weighted = calculateAcademicGpa(grades, new Map([["a", 2]]));
    expect(weighted.fivePoint).toBeCloseTo(34.5 / 4);
    expect(weighted.fourPoint).toBeCloseTo((4.3 * 2 * 3 + 4.1) / 4);
    expect(weighted.earnedCredits).toBe(4);
  });
});

describe("inferGpaScale", () => {
  it("returns 5.0 when any grade point exceeds 4.0", async () => {
    const { inferGpaScale } = await import("@campusos/plugin-academic/gradesModel");
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

describe("Celechron grade inclusion rules", () => {
  it("excludes deferred and binary grades while retaining failed GPA weight", () => {
    const grades: AcademicGradeRecord[] = [
      {
        sourceId: "normal", courseCode: null, courseName: "normal", credit: 3,
        originalScore: "90", gradePoint: 4, academicYearStart: 2025,
        termNumber: 1, isMajorCourse: true, courseCategory: null
      },
      {
        sourceId: "deferred", courseCode: null, courseName: "deferred", credit: 2,
        originalScore: "\u7f13\u8003", gradePoint: 0, academicYearStart: 2025,
        termNumber: 1, isMajorCourse: true, courseCategory: null
      },
      {
        sourceId: "failed", courseCode: null, courseName: "failed", credit: 1,
        originalScore: "\u4e0d\u53ca\u683c", gradePoint: 0, academicYearStart: 2025,
        termNumber: 1, isMajorCourse: false, courseCategory: null
      },
      {
        sourceId: "binary-pass", courseCode: null, courseName: "binary-pass", credit: 1,
        originalScore: "\u5408\u683c", gradePoint: 0, academicYearStart: 2025,
        termNumber: 1, isMajorCourse: false, courseCategory: null
      }
    ];

    const summary = summarizeAcademicGrades(grades);

    expect(summary.totalCredits).toBe(3);
    expect(summary.gradedCredits).toBe(4);
    expect(summary.majorGradedCredits).toBe(3);
    expect(summary.weightedGradePoint).toBe(3);
    expect(summary.majorWeightedGradePoint).toBe(4);
  });

  it("keeps overall GPA and major GPA on their respective course sets", () => {
    const summary = summarizeAcademicGrades([
      {
        sourceId: "major", courseCode: null, courseName: "major", credit: 3,
        originalScore: "90", gradePoint: 4, academicYearStart: 2025,
        termNumber: 1, isMajorCourse: true, courseCategory: null
      },
      {
        sourceId: "elective", courseCode: null, courseName: "elective", credit: 2,
        originalScore: "70", gradePoint: 2, academicYearStart: 2025,
        termNumber: 1, isMajorCourse: false, courseCategory: null
      }
    ]);

    expect(summary.weightedGradePoint).toBeCloseTo(3.2);
    expect(summary.majorWeightedGradePoint).toBe(4);
    expect(summary.weightedGradePoint).not.toBe(summary.majorWeightedGradePoint);
  });
});

describe("Celechron repeated-course GPA strategies", () => {
  const repeatedGrades: AcademicGradeRecord[] = [
    {
      sourceId: "attempt-1",
      realId: "course-repeat",
      courseCode: "CS201",
      courseName: "repeat",
      credit: 3,
      originalScore: "60",
      gradePoint: 1,
      academicYearStart: 2024,
      termNumber: 1,
      isMajorCourse: true,
      courseCategory: null
    },
    {
      sourceId: "attempt-2",
      realId: "course-repeat",
      courseCode: "CS201",
      courseName: "repeat",
      credit: 3,
      originalScore: "90",
      gradePoint: 4,
      academicYearStart: 2025,
      termNumber: 1,
      isMajorCourse: true,
      courseCategory: null
    },
    {
      sourceId: "other",
      courseCode: "HIST100",
      courseName: "other",
      credit: 2,
      originalScore: "80",
      gradePoint: 3,
      academicYearStart: 2025,
      termNumber: 1,
      isMajorCourse: false,
      courseCategory: null
    }
  ];

  it("selects the first or highest attempt without double-counting credits", () => {
    const first = summarizeAcademicGrades(repeatedGrades, new Map(), "first");
    const best = summarizeAcademicGrades(repeatedGrades, new Map(), "best");

    expect(first.totalCredits).toBe(5);
    expect(first.weightedGradePoint).toBeCloseTo((1 * 3 + 3 * 2) / 5);
    expect(best.totalCredits).toBe(5);
    expect(best.weightedGradePoint).toBeCloseTo((4 * 3 + 3 * 2) / 5);
    expect(best.majorWeightedGradePoint).toBe(4);
    expect(best.terms.find((term) => term.key === "2024:1")?.credits).toBe(0);
  });

  it("uses Celechron's first-attempt GPA strategy by default", () => {
    const summary = summarizeAcademicGrades(repeatedGrades);

    expect(summary.weightedGradePoint).toBeCloseTo((1 * 3 + 3 * 2) / 5);
    expect(summary.terms.find((term) => term.key === "2024:1")?.credits).toBe(3);
  });

  it("uses the source namespace when two providers expose the same realId", () => {
    const selected = summarizeAcademicGrades([
      { ...repeatedGrades[0], sourceId: "provider-a:attempt-1" },
      { ...repeatedGrades[1], sourceId: "provider-b:attempt-2" }
    ], new Map(), "best");

    expect(selected.totalCredits).toBe(6);
  });

  it("falls back from an empty realId and accepts Celechron's independent major summary", () => {
    const grades: AcademicGradeRecord[] = [
      { ...repeatedGrades[0], sourceId: "empty-real-id", realId: "", courseCode: "CS201" },
      { ...repeatedGrades[1], sourceId: "empty-real-id-2", realId: "", courseCode: "CS201" }
    ];
    const summary = summarizeAcademicGrades(grades, new Map(), "best", {
      fivePointGpa: 4.5,
      fourPointGpa: 4.1,
      fourPointLegacyGpa: 4,
      hundredPointGpa: 90,
      gpaCredits: 3,
      earnedCredits: 3
    });

    expect(summary.courseCount).toBe(2);
    expect(summary.totalCredits).toBe(3);
    expect(summary.majorFivePointGpa).toBe(4.5);
    expect(summary.majorWeightedGradePoint).toBe(4);
    expect(summary.majorGradedCredits).toBe(3);
  });
});
