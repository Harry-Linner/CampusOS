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
