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

export type CampusDeadlineKind = "assignment" | "exam" | "workflow";

export type CampusPriority = "routine" | "important" | "urgent";

export type CampusDownloadStatus =
  | "queued"
  | "syncing"
  | "paused"
  | "failed"
  | "ready";

export interface CampusSourceCredentialContext {
  configured: boolean;
  username: string | null;
  savedAt: string | null;
}

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
  downloadUrl?: string;
}

export interface CampusDownloadTask {
  id: string;
  title: string;
  courseName: string;
  sourceId: CampusSourceId;
  progress: number;
  status: CampusDownloadStatus;
  targetPath: string;
}

export interface CampusDownloadRequest {
  url: string;
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
  summary: string;
  actionLabel?: string;
  configuredUsername?: string | null;
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
  materials: CampusMaterialRecord[];
  downloads: CampusDownloadTask[];
  reminders: CampusReminder[];
  summary: CampusWorkspaceSummary;
}

export interface CampusAdapterContext {
  now: string;
  semesterLabel: string;
  downloadRoot: string;
  reminderLeadMinutes: number[];
  sourceCredentials: Partial<Record<CampusSourceId, CampusSourceCredentialContext>>;
}

export interface CampusAdapterResult {
  sourceId: CampusSourceId;
  status: CampusSyncStatus;
  connectionState?: CampusSourceConnectionState;
  syncedAt: string;
  summary: string;
  actionLabel?: string;
  configuredUsername?: string | null;
  courses: CampusCourseSession[];
  deadlines: CampusDeadline[];
  materials: CampusMaterialRecord[];
}

export interface CampusSourceAdapter {
  source: CampusSourceDefinition;
  ingest: (context: CampusAdapterContext) => Promise<CampusAdapterResult>;
}

export const firstWaveSourceCatalog = [
  {
    id: "academic-affairs",
    label: "教务处网站",
    shortLabel: "教务处",
    description: "课程、考试、课件下载入口的主数据源。",
    capabilities: ["schedule", "deadline", "material"]
  },
  {
    id: "learning-platform",
    label: "学在浙大",
    shortLabel: "学在浙大",
    description: "课程作业、截止时间与学习平台待办。",
    capabilities: ["deadline"]
  },
  {
    id: "cs-college",
    label: "计算机学院院网",
    shortLabel: "计院院网",
    description: "课程通知、学院公告、补充资料。",
    capabilities: ["deadline", "material", "announcement"]
  },
  {
    id: "yunfeng-college",
    label: "云峰学院院网",
    shortLabel: "云峰院网",
    description: "书院活动、班级安排、补充资料。",
    capabilities: ["deadline", "material", "announcement"]
  },
  {
    id: "eta-platform",
    label: "ETA 三全育人平台",
    shortLabel: "ETA",
    description: "平台任务、培养要求与流程性待办。",
    capabilities: ["deadline", "announcement"]
  }
] satisfies readonly CampusSourceDefinition[];

export const firstWaveSourceIds = firstWaveSourceCatalog.map((source) => source.id);

export const firstWaveSources = firstWaveSourceCatalog.map((source) => source.label);
