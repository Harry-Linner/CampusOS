import type {
  AcademicGpaStrategy,
  AcademicGradeRecord,
  AcademicMajorGradeSummary,
  GpaScale
} from "@campusos/shared";

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
  fivePointGpa: number | null;
  fourPointGpa: number | null;
  fourPointLegacyGpa: number | null;
  hundredPointGpa: number | null;
  majorFivePointGpa: number | null;
  majorFourPointGpa: number | null;
  majorFourPointLegacyGpa: number | null;
  majorHundredPointGpa: number | null;
  weighted: boolean;
  terms: AcademicGradeTermSummary[];
}

export interface AcademicGpaResult {
  fivePoint: number | null;
  fourPoint: number | null;
  fourPointLegacy: number | null;
  hundredPoint: number | null;
  credits: number;
  earnedCredits: number;
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

const CREDIT_EXCLUDED_SCORES = new Set([
  "\u5f03\u4fee",
  "\u5f85\u5f55",
  "\u7f13\u8003",
  "\u65e0\u6548"
]);
const GPA_EXCLUDED_SCORES = new Set(["\u5408\u683c", "\u4e0d\u5408\u683c"]);

const FIVE_TO_FOUR = new Map<number, number>([
  [5, 4.3],
  [4.8, 4.2],
  [4.5, 4.1],
  [4.2, 4]
]);

const LABEL_TO_HUNDRED = new Map<string, number>([
  ["A+", 95], ["A", 90], ["A-", 87], ["B+", 83], ["B", 80],
  ["B-", 77], ["C+", 73], ["C", 70], ["C-", 67], ["D", 60],
  ["F", 0], ["优秀", 90], ["良好", 80], ["中等", 70], ["及格", 60],
  ["不及格", 0], ["合格", 75], ["不合格", 0], ["弃修", 0],
  ["缺考", 0], ["缓考", 0], ["待录", 0], ["无效", 0]
]);

const validCredit = (grade: AcademicGradeRecord): number =>
  Number.isFinite(grade.credit) && grade.credit > 0 ? grade.credit : 0;

const creditIncluded = (grade: AcademicGradeRecord): boolean =>
  grade.creditIncluded ?? !CREDIT_EXCLUDED_SCORES.has(grade.originalScore);

const gpaIncluded = (grade: AcademicGradeRecord): boolean =>
  grade.gpaIncluded ?? (
    creditIncluded(grade) &&
    !GPA_EXCLUDED_SCORES.has(grade.originalScore) &&
    !grade.sourceId.includes("xtwkc")
  );

const fivePoint = (grade: AcademicGradeRecord): number =>
  grade.gradePoint !== null && Number.isFinite(grade.gradePoint)
    ? grade.gradePoint
    : 0;

const fourPoint = (grade: AcademicGradeRecord): number => {
  const source = fivePoint(grade);
  return source > 4 ? FIVE_TO_FOUR.get(source) ?? 4 : source;
};

const fourPointLegacy = (grade: AcademicGradeRecord): number => {
  const source = fivePoint(grade);
  return source > 4 ? 4 : source;
};

const hundredPoint = (grade: AcademicGradeRecord): number => {
  const original = grade.originalScore.trim();
  const mapped = LABEL_TO_HUNDRED.get(original);
  if (mapped !== undefined) return mapped;
  const numeric = original.match(/\d+/)?.[0];
  return numeric ? Number.parseInt(numeric, 10) : 0;
};

const repeatedCourseKey = (grade: AcademicGradeRecord): string => {
  const separator = grade.sourceId.indexOf(":");
  const provider = separator > 0 ? grade.sourceId.slice(0, separator) : "";
  const sourceId = separator > 0 ? grade.sourceId.slice(separator + 1) : grade.sourceId;

  // Celechron lib/model/scholar.dart:557-574 groups normal repeats by course
  // code and keeps PPAE/401 physical-education registrations term-specific.
  const match = sourceId.match(/(\(.*\)-(.*?))-.*/);
  let key = match?.[2] || grade.realId?.trim() || grade.courseCode?.trim() || sourceId;
  if (key.startsWith("PPAE") || key.startsWith("401")) {
    key = match?.[1] || grade.realId?.trim() || sourceId;
  }
  return provider ? `${provider}:${key}` : key;
};

export const selectAcademicGpaGrades = (
  grades: readonly AcademicGradeRecord[],
  strategy: AcademicGpaStrategy = "best"
): AcademicGradeRecord[] => {
  const groups = new Map<string, AcademicGradeRecord[]>();
  for (const grade of grades) {
    const key = repeatedCourseKey(grade);
    groups.set(key, [...(groups.get(key) ?? []), grade]);
  }

  // Celechron lib/model/scholar.dart:576-589 uses the first response item for
  // "first" and the highest hundred-point projection for "best".
  return [...groups.values()].map((attempts) => {
    if (strategy === "first") return attempts[0];
    return attempts.reduce((best, attempt) =>
      hundredPoint(attempt) > hundredPoint(best) ? attempt : best
    );
  });
};

const earnedCredit = (grade: AcademicGradeRecord): number => {
  const credit = validCredit(grade);
  if (!creditIncluded(grade)) return 0;
  return (fivePoint(grade) !== 0 || grade.sourceId.includes("xtwkc"))
    ? credit
    : 0;
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
    if (fivePoint(grade) > 4.0) return "5.0";
  }
  return "4.0";
};

export const calculateAcademicGpa = (
  grades: readonly AcademicGradeRecord[],
  weightMap: ReadonlyMap<string, number> = new Map(),
  strategy: AcademicGpaStrategy = "best"
): AcademicGpaResult => {
  const selected = selectAcademicGpaGrades(grades, strategy);
  const included = selected.filter(gpaIncluded);
  const credits = included.reduce((total, grade) => total + validCredit(grade), 0);
  const earnedCredits = selected.reduce((total, grade) => total + earnedCredit(grade), 0);
  if (credits <= 0) {
    return { fivePoint: null, fourPoint: null, fourPointLegacy: null, hundredPoint: null, credits: 0, earnedCredits };
  }
  const totals = included.reduce(
    (sum, grade) => {
      const weight = Number.isFinite(weightMap.get(grade.sourceId))
        ? Math.max(0, weightMap.get(grade.sourceId) ?? 1)
        : 1;
      const credit = validCredit(grade);
      sum.fivePoint += fivePoint(grade) * weight * credit;
      sum.fourPoint += fourPoint(grade) * weight * credit;
      sum.fourPointLegacy += fourPointLegacy(grade) * weight * credit;
      sum.hundredPoint += hundredPoint(grade) * weight * credit;
      return sum;
    },
    { fivePoint: 0, fourPoint: 0, fourPointLegacy: 0, hundredPoint: 0 }
  );
  return {
    fivePoint: totals.fivePoint / credits,
    fourPoint: totals.fourPoint / credits,
    fourPointLegacy: totals.fourPointLegacy / credits,
    hundredPoint: totals.hundredPoint / credits,
    credits,
    earnedCredits
  };
};

export const summarizeAcademicGrades = (
  grades: readonly AcademicGradeRecord[],
  weightMap: ReadonlyMap<string, number> = new Map(),
  strategy: AcademicGpaStrategy = "best",
  sourceMajorSummary?: AcademicMajorGradeSummary
): AcademicGradeSummary => {
  const terms = new Map<string, AcademicGradeTermSummary>();
  const selectedGrades = selectAcademicGpaGrades(grades, strategy);
  const selectedGradeSet = new Set(selectedGrades);

  for (const grade of grades) {
    const key = createTermKey(grade);
    const term = terms.get(key) ?? {
      key,
      label: createTermLabel(grade),
      grades: [],
      credits: 0,
      majorCredits: 0
    };
    term.grades.push(grade);
    if (selectedGradeSet.has(grade)) {
      term.credits += earnedCredit(grade);
      if (grade.isMajorCourse) term.majorCredits += earnedCredit(grade);
    }
    terms.set(key, term);
  }

  const overall = calculateAcademicGpa(selectedGrades, weightMap, strategy);
  const major = calculateAcademicGpa(
    selectedGrades.filter((grade) => grade.isMajorCourse),
    weightMap,
    strategy
  );
  const majorProjection = weightMap.size === 0 && sourceMajorSummary
    ? sourceMajorSummary
    : {
        fivePointGpa: major.fivePoint,
        fourPointGpa: major.fourPoint,
        fourPointLegacyGpa: major.fourPointLegacy,
        hundredPointGpa: major.hundredPoint,
        gpaCredits: major.credits,
        earnedCredits: major.earnedCredits
      };
  const sourceScale = inferGpaScale(selectedGrades);

  return {
    courseCount: grades.length,
    totalCredits: overall.earnedCredits,
    gradedCredits: overall.credits,
    majorGradedCredits: majorProjection.gpaCredits,
    weightedGradePoint: overall[sourceScale === "5.0" ? "fivePoint" : sourceScale === "4.3" ? "fourPoint" : "fourPointLegacy"],
    majorWeightedGradePoint: sourceScale === "5.0" ? majorProjection.fivePointGpa : sourceScale === "4.3" ? majorProjection.fourPointGpa : majorProjection.fourPointLegacyGpa,
    fivePointGpa: overall.fivePoint,
    fourPointGpa: overall.fourPoint,
    fourPointLegacyGpa: overall.fourPointLegacy,
    hundredPointGpa: overall.hundredPoint,
    majorFivePointGpa: majorProjection.fivePointGpa,
    majorFourPointGpa: majorProjection.fourPointGpa,
    majorFourPointLegacyGpa: majorProjection.fourPointLegacyGpa,
    majorHundredPointGpa: majorProjection.hundredPointGpa,
    weighted: weightMap.size > 0,
    terms: [...terms.values()].sort(compareTerms)
  };
};
