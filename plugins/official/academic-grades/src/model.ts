import type { AcademicGradeRecord, GpaScale } from "@campusos/shared";

export interface AcademicGradeTermSummary {
  key: string;
  label: string;
  grades: AcademicGradeRecord[];
  credits: number;
  majorCredits: number;
}

export interface AcademicGradeSummary {
  courseCount: number;
  totalCredits: number;
  gradedCredits: number;
  majorGradedCredits: number;
  weightedGradePoint: number | null;
  majorWeightedGradePoint: number | null;
  terms: AcademicGradeTermSummary[];
}

export interface GpaScaleInfo {
  scale: GpaScale;
  label: string;
  maxGradePoint: number;
  typicalMaxGradePoint: number;
  typicalPassingGradePoint: number;
}

export const GPA_SCALES: Record<GpaScale, GpaScaleInfo> = {
  "4.0": {
    scale: "4.0",
    label: "4.0 制",
    maxGradePoint: 4.0,
    typicalMaxGradePoint: 4.0,
    typicalPassingGradePoint: 1.0
  },
  "4.3": {
    scale: "4.3",
    label: "4.3 制",
    maxGradePoint: 4.3,
    typicalMaxGradePoint: 4.3,
    typicalPassingGradePoint: 1.0
  },
  "5.0": {
    scale: "5.0",
    label: "5.0 制",
    maxGradePoint: 5.0,
    typicalMaxGradePoint: 5.0,
    typicalPassingGradePoint: 1.0
  }
};

const createTermKey = (grade: AcademicGradeRecord): string =>
  `${grade.academicYearStart ?? "unknown"}:${grade.termNumber ?? "unknown"}`;

const createTermLabel = (grade: AcademicGradeRecord): string => {
  if (grade.academicYearStart === null || grade.termNumber === null) {
    return "学期信息待确认";
  }

  return `${grade.academicYearStart}-${grade.academicYearStart + 1} 学年 第 ${grade.termNumber} 学期`;
};

const compareTerms = (
  left: AcademicGradeTermSummary,
  right: AcademicGradeTermSummary
): number => {
  const leftGrade = left.grades[0];
  const rightGrade = right.grades[0];
  const leftYear = leftGrade?.academicYearStart ?? -1;
  const rightYear = rightGrade?.academicYearStart ?? -1;
  const leftTerm = leftGrade?.termNumber ?? -1;
  const rightTerm = rightGrade?.termNumber ?? -1;

  return rightYear - leftYear || rightTerm - leftTerm;
};

const weightGrades = (
  grades: readonly AcademicGradeRecord[],
  isMajorOnly: boolean
): { credits: number; weightedTotal: number } => {
  let credits = 0;
  let weightedTotal = 0;

  for (const grade of grades) {
    if (isMajorOnly && !grade.isMajorCourse) continue;
    if (grade.gradePoint === null || !Number.isFinite(grade.gradePoint)) continue;

    const credit = Number.isFinite(grade.credit) && grade.credit > 0 ? grade.credit : 0;
    if (credit > 0) {
      credits += credit;
      weightedTotal += grade.gradePoint * credit;
    }
  }

  return { credits, weightedTotal };
};

export const scaleGpaFromSource = (
  sourceWeighted: number,
  sourceScale: GpaScale,
  targetScale: GpaScale
): number | null => {
  if (sourceScale === targetScale) return sourceWeighted;

  const sourceInfo = GPA_SCALES[sourceScale];
  if (sourceInfo.maxGradePoint <= 0) return null;

  const targetInfo = GPA_SCALES[targetScale];
  return sourceWeighted * (targetInfo.maxGradePoint / sourceInfo.maxGradePoint);
};

export const inferGpaScale = (
  grades: readonly AcademicGradeRecord[]
): GpaScale => {
  for (const grade of grades) {
    if (grade.gradePoint !== null && grade.gradePoint > 4.0) return "5.0";
  }
  return "4.0";
};

export const summarizeAcademicGrades = (
  grades: readonly AcademicGradeRecord[]
): AcademicGradeSummary => {
  const terms = new Map<string, AcademicGradeTermSummary>();
  let totalCredits = 0;
  let gradedCredits = 0;
  let weightedGradePointTotal = 0;
  let majorGradedCredits = 0;
  let majorWeightedGradePointTotal = 0;

  for (const grade of grades) {
    const credit = Number.isFinite(grade.credit) && grade.credit > 0
      ? grade.credit
      : 0;
    totalCredits += credit;

    if (grade.gradePoint !== null && Number.isFinite(grade.gradePoint) && credit > 0) {
      gradedCredits += credit;
      weightedGradePointTotal += grade.gradePoint * credit;

      if (grade.isMajorCourse) {
        majorGradedCredits += credit;
        majorWeightedGradePointTotal += grade.gradePoint * credit;
      }
    }

    const key = createTermKey(grade);
    const term = terms.get(key) ?? {
      key,
      label: createTermLabel(grade),
      grades: [],
      credits: 0,
      majorCredits: 0
    };
    term.grades.push(grade);
    term.credits += credit;
    if (grade.isMajorCourse) term.majorCredits += credit;
    terms.set(key, term);
  }

  return {
    courseCount: grades.length,
    totalCredits,
    gradedCredits,
    majorGradedCredits,
    weightedGradePoint:
      gradedCredits > 0 ? weightedGradePointTotal / gradedCredits : null,
    majorWeightedGradePoint:
      majorGradedCredits > 0
        ? majorWeightedGradePointTotal / majorGradedCredits
        : null,
    terms: [...terms.values()].sort(compareTerms)
  };
};
