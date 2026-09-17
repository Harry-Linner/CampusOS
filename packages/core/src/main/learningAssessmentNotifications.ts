import type { CapabilityRecord, LearningAssignmentsData } from "@campusos/shared";
import type { DatabaseService } from "./databaseService";
import { addNotification, type AddNotificationInput } from "./notificationCenter";

export async function processLearningAssessmentNotifications({ record, accountId, enabled, database, refreshStartedAt, notify = addNotification, now = new Date() }: {
  record: CapabilityRecord<LearningAssignmentsData> | null; accountId: string; enabled: boolean;
  database: Pick<DatabaseService, "loadDesktopCalendarState" | "saveDesktopCalendarState">;
  notify?: (input: AddNotificationInput) => Promise<unknown>; now?: Date;
  refreshStartedAt: Date;
}): Promise<number> {
  if (!enabled || !record || (record.state !== "live" && record.state !== "cache") || record.accountId !== accountId || !record.data) return 0;
  const key = "learning-assessment-notified";
  const saved = database.loadDesktopCalendarState(key)?.value as Record<string, string> | undefined;
  const seen = Object.fromEntries(Object.entries(saved ?? {}).filter(([, stamp]) => Date.parse(stamp) > now.getTime() - 30 * 86400000));
  let count = 0;
  for (const item of record.data.assignments) {
    if (item.activityType !== "quiz" && item.activityType !== "classroom") continue;
    if (!item.assessmentObservedAt || !(Date.parse(item.assessmentObservedAt) >= refreshStartedAt.getTime())) continue;
    if (item.submissionStatus === "submitted" || seen[item.sourceId]) continue;
    if (item.dueAt && Date.parse(item.dueAt) <= now.getTime()) continue;
    if (item.activityType === "quiz" && (!item.startAt || Date.parse(item.startAt) > now.getTime())) continue;
    await notify({ id: `assessment:${item.sourceId}`, kind: "assignment", source: "schedule", sourceId: "learning-platform",
      title: item.activityType === "quiz" ? "有小测正在进行" : "有课堂互动正在进行",
      body: `${item.title} · ${item.courseName}`, entityId: item.sourceId,
      actionTarget: { viewId: "schedule" }, showDesktop: true });
    seen[item.sourceId] = now.toISOString();
    database.saveDesktopCalendarState(key, seen, now.toISOString());
    count++;
  }
  return count;
}
