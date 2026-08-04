import type { PluginCapability } from "./index";
import type { CampusSourceId } from "./campus";

export type CapabilityDataState =
  | "live"
  | "cache"
  | "fallback"
  | "unavailable";

export interface CapabilityPublication<T = unknown> {
  capability: PluginCapability;
  accountId: string | null;
  state: CapabilityDataState;
  updatedAt: string;
  data: T | null;
  message?: string;
}

export interface CapabilityRecord<T = unknown>
  extends CapabilityPublication<T> {
  providerId: string;
}

export interface PluginCapabilityClient {
  read: <T>(capability: PluginCapability) => Promise<CapabilityRecord<T>[]>;
}

export interface AcademicProfileData {
  studentId: string;
  educationLevel: "undergraduate" | "graduate";
  verifiedAt: string;
  verifiedService: string;
}

export type AcademicTimetableSeason = "1|秋" | "1|冬" | "2|春" | "2|夏";

export interface AcademicTimetableSession {
  sourceId: string;
  courseName: string;
  teacher: string;
  location: string | null;
  dayOfWeek: number;
  periods: number[];
  firstHalf: boolean;
  secondHalf: boolean;
  weekPattern: "all" | "odd" | "even";
  weeks?: number[];
  confirmed: boolean;
}

export interface AcademicTimetableTermData {
  academicYearStart: number;
  season: AcademicTimetableSeason;
  state: CapabilityDataState;
  sessions: AcademicTimetableSession[];
  message?: string;
}

export interface AcademicTimetableData {
  terms: AcademicTimetableTermData[];
}

export interface AcademicCalendarQuarter {
  academicYearStart: number;
  season: AcademicTimetableSeason;
  startDate: string;
  classesBeginDate: string;
  endDate: string;
}

export interface AcademicCalendarConfigData {
  timezone: "Asia/Shanghai";
  sourceUrl: string;
  quarters: AcademicCalendarQuarter[];
  periodTimes: PeriodTimeRecord[];
}

export interface PeriodTimeRecord {
  period: number;
  start: string;
  end: string;
}

export interface AcademicExamRecord {
  sourceId: string;
  courseId: string;
  courseName: string;
  kind: "midterm" | "final";
  scheduleText: string;
  startAt: string | null;
  endAt: string | null;
  dateLabel: string | null;
  location: string | null;
  seat: string | null;
}

export interface AcademicExamsData {
  exams: AcademicExamRecord[];
}

export interface AcademicGradeRecord {
  sourceId: string;
  courseCode: string | null;
  courseName: string;
  credit: number;
  originalScore: string;
  gradePoint: number | null;
  academicYearStart: number | null;
  termNumber: 1 | 2 | null;
  isMajorCourse: boolean;
  courseCategory: string | null;
}

export type GpaScale = "4.0" | "4.3" | "5.0";

export interface AcademicGradesData {
  grades: AcademicGradeRecord[];
}

export interface LearningAssignmentRecord {
  sourceId: string;
  title: string;
  courseName: string;
  dueAt: string | null;
}

export interface LearningAssignmentsData {
  assignments: LearningAssignmentRecord[];
}

export interface LearningCourseRecord {
  sourceId: string;
  name: string;
  academicYearId: string | null;
  semesterId: string | null;
  semesterName: string | null;
}

export interface LearningMaterialRecord {
  sourceId: string;
  uploadId: string;
  referenceId: string;
  fileName: string;
  courseId: string;
  courseName: string;
  semesterName: string;
  size: number | null;
  updatedAt: string | null;
  downloadUrl: string;
  downloadFallbackUrl: string;
}

export interface LearningMaterialsData {
  courses: LearningCourseRecord[];
  materials: LearningMaterialRecord[];
}

export type CalendarEventKind = "course" | "exam" | "assignment" | "task";

export interface CalendarEventRecord {
  id: string;
  originId: string;
  originCapability: PluginCapability;
  sourceId: CampusSourceId;
  kind: CalendarEventKind;
  title: string;
  startAt: string;
  endAt: string | null;
  timezone: "Asia/Shanghai";
  location: string | null;
  courseName: string | null;
  note: string | null;
}

export interface CalendarEventsData {
  feedId: string;
  sourceId: CampusSourceId;
  sourceLabel: string;
  sourceUpdatedAt: string;
  upstreamCapability: PluginCapability;
  upstreamProviderId: string | null;
  upstreamProviderIds: string[];
  accountScoped: boolean;
  supportedKinds: CalendarEventKind[];
  totalItems: number;
  omittedItems: number;
  events: CalendarEventRecord[];
}

export type LocalTaskType = "deadline" | "fixed" | "fixedlegacy";
export type LocalTaskStatus =
  | "running"
  | "suspended"
  | "completed"
  | "failed"
  | "deleted"
  | "outdated";
export type LocalTaskRepeatType = "norepeat" | "days" | "month" | "year";

export interface LocalTaskRecord {
  id: string;
  status: LocalTaskStatus;
  description: string;
  timeSpentMinutes: number;
  timeNeededMinutes: number;
  startAt: string;
  endAt: string;
  location: string;
  title: string;
  breakable: boolean;
  type: LocalTaskType;
  repeatType: LocalTaskRepeatType;
  repeatPeriod: number;
  repeatEndsOn: string;
  blocksPlanning: boolean;
  fromId: string | null;
}

export interface LocalTaskInput {
  id?: string;
  description: string;
  timeSpentMinutes: number;
  timeNeededMinutes: number;
  startAt: string;
  endAt: string;
  location: string;
  title: string;
  breakable: boolean;
  type: Exclude<LocalTaskType, "fixedlegacy">;
  repeatType: LocalTaskRepeatType;
  repeatPeriod: number;
  repeatEndsOn: string;
  blocksPlanning: boolean;
}

export interface LocalTaskMutation {
  id: string;
  status?: Extract<LocalTaskStatus, "running" | "suspended" | "completed" | "deleted">;
  timeSpentMinutes?: number;
}

export interface LocalTasksData {
  tasks: LocalTaskRecord[];
  updatedAt: string;
}

export interface LocalTaskPeriod {
  id: string;
  taskId: string;
  title: string;
  description: string;
  location: string;
  startAt: string;
  endAt: string;
  type: LocalTaskType;
  status: LocalTaskStatus;
  blocksPlanning: boolean;
}

export interface PlannerSettings {
  workMinutes: number;
  restMinutes: number;
  availableStartHour: number;
  availableEndHour: number;
  horizonDays: number;
}

export interface PlannerSegment {
  id: string;
  taskId: string;
  title: string;
  description: string;
  location: string;
  startAt: string;
  endAt: string;
}

export interface PlannerScheduleData {
  valid: boolean;
  reason: string | null;
  restMinutes: number;
  generatedAt: string;
  settings: PlannerSettings;
  segments: PlannerSegment[];
}

export interface CalendarExportInput {
  academicYearStart: number;
  termLabel: string;
  includeExams?: boolean;
  includeTasks?: boolean;
}

export interface CalendarExportResult {
  filePath: string;
  eventCount: number;
  generatedAt: string;
}
