import type {
  AcademicGradesData,
  CapabilityRecord
} from "@campusos/shared";
import { summarizeAcademicGrades } from "@campusos/plugin-academic/gradesModel";
import type { DatabaseService } from "./databaseService";
import type { RefreshSourceStatus } from "./refreshCoordinator";
import { addNotification } from "./notificationCenter";

export interface GradeChangeNotificationMessage {
  title: string;
  body: string;
}

export type GradeChangeNotificationResult =
  | "skipped"
  | "baseline-created"
  | "unchanged"
  | "change-notified";

const FIRST_NOTIFICATION: GradeChangeNotificationMessage = {
  title: "首次成绩推送",
  body: "若有新出分的课程，CampusOS 将会通知你。可在设置中关闭此功能。"
};

const CHANGE_NOTIFICATION: GradeChangeNotificationMessage = {
  title: "成绩变动提醒",
  body: "有新出分的课程，可在 CampusOS 的学业页面中刷新查看。"
};

const showGradeNotification = async ({
  title,
  body
}: GradeChangeNotificationMessage): Promise<void> => {
  await addNotification({
    kind: "grade",
    title,
    body,
    actionTarget: { viewId: "academic" },
    source: "academic",
    showDesktop: true
  });
};

export const processGradeChangeNotification = async ({
  accountId,
  connectorStatus,
  gradeRecord,
  enabled,
  database,
  notify = showGradeNotification,
  now = new Date()
}: {
  accountId: string;
  connectorStatus: RefreshSourceStatus;
  gradeRecord: CapabilityRecord<AcademicGradesData> | null;
  enabled: boolean;
  database: DatabaseService;
  notify?: (message: GradeChangeNotificationMessage) => Promise<void> | void;
  now?: Date;
}): Promise<GradeChangeNotificationResult> => {
  if (
    !enabled ||
    connectorStatus !== "live" ||
    gradeRecord?.state !== "live" ||
    gradeRecord.accountId !== accountId ||
    !gradeRecord.data
  ) {
    return "skipped";
  }

  // Celechron lib/worker/background_app_refresh.dart:98-153 compares
  // Scholar.gpa[0] and Scholar.gradedCourseCount after a non-degraded refresh.
  // CampusOS adapts the secure-storage fuse to its account-keyed SQLite store.
  const summary = summarizeAcademicGrades(gradeRecord.data.grades);
  const nextBaseline = {
    fivePointGpa: summary.fivePointGpa ?? 0,
    gradedCourseCount: gradeRecord.data.grades.length,
    savedAt: now.toISOString()
  };
  const previous = database.loadAcademicGradeNotificationBaseline(accountId);

  if (!previous) {
    await notify(FIRST_NOTIFICATION);
    database.saveAcademicGradeNotificationBaseline(accountId, nextBaseline);
    return "baseline-created";
  }

  const changed =
    previous.fivePointGpa !== nextBaseline.fivePointGpa ||
    previous.gradedCourseCount !== nextBaseline.gradedCourseCount;
  if (changed) {
    await notify(CHANGE_NOTIFICATION);
  }
  database.saveAcademicGradeNotificationBaseline(accountId, nextBaseline);

  return changed ? "change-notified" : "unchanged";
};
