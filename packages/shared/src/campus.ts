export type CampusSourceId =
  | "academic-affairs"
  | "learning-platform"
  | "cs-college"
  | "yunfeng-college"
  | "eta-platform";

export type CampusArtifactKind =
  | "schedule"
  | "deadline"
  | "material"
  | "announcement";

export type CampusSyncStatus = "ready" | "partial" | "planned";

export type CampusSourceConnectionState =
  | "connected"
  | "needs-credentials"
  | "not-required";

export type CampusDeadlineKind = "assignment" | "exam";

export type CampusPriority = "routine" | "important" | "urgent";

export type CampusDownloadStatus =
  | "queued"
  | "syncing"
  | "paused"
  | "failed"
  | "ready";

export interface CampusSourceDefinition {
  id: CampusSourceId;
  label: string;
  shortLabel: string;
  description: string;
  capabilities: CampusArtifactKind[];
}

export interface CampusTermStatus {
  label: string;
  phase: "active" | "upcoming" | "unavailable" | "mock";
  currentWeek: number | null;
  progressPercent: number;
}

export interface CampusCourseSession {
  id: string;
  title: string;
  instructor?: string;
  location: string;
  startAt: string;
  endAt: string;
  sourceId: CampusSourceId;
  courseCode?: string;
  note?: string;
}

export interface CampusDeadline {
  id: string;
  title: string;
  dueAt: string;
  sourceId: CampusSourceId;
  kind: CampusDeadlineKind;
  priority: CampusPriority;
  courseName?: string;
  note?: string;
}

export interface CampusMaterialRecord {
  id: string;
  title: string;
  courseName: string;
  semester: string;
  sourceId: CampusSourceId;
  updatedAt: string;
  sizeBytes?: number;
  downloadUrl?: string;
  downloadFallbackUrl?: string;
}

export interface CampusMaterialCourse {
  id: string;
  name: string;
  semester: string;
}

export interface CampusDownloadTask {
  id: string;
  title: string;
  courseName: string;
  sourceId: CampusSourceId;
  semester?: string;
  sourceUrl?: string;
  progress: number;
  status: CampusDownloadStatus;
  targetPath: string;
  failureMessage?: string;
  createdAt?: string;
  expectedBytes?: number;
}

export interface CampusDownloadVerification {
  status: "verified" | "missing" | "size-mismatch";
  actualBytes: number | null;
  expectedBytes: number | null;
}

export interface CampusDownloadPreferences {
  completionSound: boolean;
  downloadDirectory: string;
}

export interface CampusDownloadPreferenceInput {
  completionSound: boolean;
}

export interface CampusDownloadRequest {
  url: string;
  fallbackUrl?: string;
  expectedBytes?: number;
  title: string;
  courseName: string;
  sourceId: CampusSourceId;
  semester: string;
}

export interface CampusReminder {
  id: string;
  title: string;
  kind: "course" | "deadline";
  sourceId: CampusSourceId;
  fireAt: string;
  eventStartAt: string;
  leadMinutes: number;
  location?: string;
}

export interface CampusSourceSyncState {
  sourceId: CampusSourceId;
  label: string;
  status: CampusSyncStatus;
  connectionState: CampusSourceConnectionState;
  lastSyncedAt: string;
  itemCount: number;
  /** Upstream item totals keyed by capability, used to replace feed counts on refresh. */
  itemCountsByCapability?: Record<string, number>;
  summary: string;
  actionLabel?: string;
  configuredUsername?: string | null;
  /**
   * 该来源在日历投影时因**缺少可信绝对时间**被丢弃的条目数。
   * 只有投影日历事件的来源会带这个字段；undefined 表示该源没有这个口径。
   */
  omittedItemCount?: number;
  /** 因**已过截止日**而未列入待办的条目数（按规则丢弃，不是数据问题）。 */
  expiredItemCount?: number;
  /**
   * 本轮数据源降级（cache/fallback/unavailable）且未返回事件时，界面沿用上次成功数据；
   * 这里记录那份数据的抓取时间，用于向用户说明"显示的是什么时候的数据"。
   */
  retainedDegradedAt?: string | null;
}

export interface CampusWorkspaceSummary {
  readySources: number;
  totalSources: number;
  downloadsInFlight: number;
  materialsReady: number;
  remindersQueued: number;
  deadlinesDueSoon: number;
}

export interface CampusWorkspaceSnapshot {
  generatedAt: string;
  term: CampusTermStatus;
  sourceStates: CampusSourceSyncState[];
  courses: CampusCourseSession[];
  todayCourses: CampusCourseSession[];
  deadlines: CampusDeadline[];
  /** Canonical calendar projection consumed by the Schedule module. */
  calendarEvents?: import("./pluginCapabilities").CalendarEventRecord[];
  /** Persisted academic presentation data, available before plugin/network refresh. */
  academicTimetable?: {
    records: import("./pluginCapabilities").CapabilityRecord<import("./pluginCapabilities").AcademicTimetableData>[];
    calendar: import("./pluginCapabilities").AcademicCalendarConfigData | null;
  };
  /** Filtered learning-platform catalog used by the Materials workspace. */
  materialCourses?: CampusMaterialCourse[];
  materials: CampusMaterialRecord[];
  downloads: CampusDownloadTask[];
  reminders: CampusReminder[];
  summary: CampusWorkspaceSummary;
}

export const firstWaveSourceCatalog = [
  {
    id: "academic-affairs",
    label: "教务处网站",
    shortLabel: "教务处",
    description: "课程、考试、成绩与素拓实践的教务数据源。",
    capabilities: ["schedule", "deadline"]
  },
  {
    id: "learning-platform",
    label: "学在浙大",
    shortLabel: "学在浙大",
    description: "课程作业、截止时间与课程资料。",
    capabilities: ["deadline", "material"]
  }
] satisfies readonly CampusSourceDefinition[];

export const firstWaveSourceIds = firstWaveSourceCatalog.map((source) => source.id);

export const firstWaveSources = firstWaveSourceCatalog.map((source) => source.label);
