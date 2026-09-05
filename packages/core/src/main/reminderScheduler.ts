import { Notification } from "electron";
import type { CampusReminder, CampusWorkspaceSnapshot, LocalTaskRecord } from "@campusos/shared";
import type {
  ReminderSchedulerState,
  ReminderSettingsRecord
} from "../shared/reminderBridge";
import { createDefaultReminderSchedulerState } from "../shared/reminderBridge";
import { addNotification } from "./notificationCenter";

const MAX_TIMEOUT_MS = 2_147_483_647;
const STARTUP_CATCH_UP_MS = 24 * 60 * 60 * 1000;

const scheduledTimers = new Map<string, NodeJS.Timeout>();
type ScheduledReminder = Pick<CampusReminder, "id" | "title" | "fireAt" | "eventStartAt" | "leadMinutes" | "location"> & {
  kind: CampusReminder["kind"] | "task";
};

const scheduledReminderById = new Map<string, ScheduledReminder>();

function notificationsSupported(): boolean {
  try {
    return Notification.isSupported();
  } catch {
    return false;
  }
}

let schedulerState: ReminderSchedulerState = {
  ...createDefaultReminderSchedulerState("electron"),
  supported: notificationsSupported()
};

const clearScheduledTimers = (): void => {
  for (const timer of scheduledTimers.values()) {
    clearTimeout(timer);
  }

  scheduledTimers.clear();
  scheduledReminderById.clear();
};

const getNextFireAt = (): string | null => {
  const reminders = [...scheduledReminderById.values()].sort(
    (left, right) =>
      new Date(left.fireAt).getTime() - new Date(right.fireAt).getTime()
  );

  return reminders[0]?.fireAt ?? null;
};

const buildReminderBody = (reminder: ScheduledReminder): string => {
  if (reminder.kind === "course") {
    return reminder.location
      ? `课程将在 ${reminder.leadMinutes} 分钟后开始，地点：${reminder.location}`
      : `课程将在 ${reminder.leadMinutes} 分钟后开始`;
  }

  if (reminder.kind === "deadline") return `将在 ${reminder.leadMinutes} 分钟后截止`;
  if (reminder.leadMinutes === 0) return "时间到了";
  return `将在 ${reminder.leadMinutes} 分钟后开始`;
};

const emitReminderNotification = async (reminder: ScheduledReminder): Promise<void> => {
  await addNotification({
    id: `reminder:${reminder.id}`,
    kind: reminder.kind === "course" ? "course" : reminder.kind === "deadline" ? "assignment" : "task",
    title: reminder.title,
    body: buildReminderBody(reminder),
    actionTarget: { viewId: "schedule" },
    source: "schedule",
    sourceId: reminder.kind,
    entityId: reminder.id,
    publishedAt: reminder.fireAt,
    showDesktop: true
  });
};

const updateSchedulerState = (
  partial: Partial<ReminderSchedulerState>
): ReminderSchedulerState => {
  schedulerState = {
    ...schedulerState,
    ...partial
  };

  return schedulerState;
};

const scheduleReminder = (reminder: ScheduledReminder, nowMs: number): boolean => {
  const fireAtMs = new Date(reminder.fireAt).getTime();
  const delayMs = fireAtMs - nowMs;

  if (!Number.isFinite(fireAtMs) || delayMs <= 0 || delayMs > MAX_TIMEOUT_MS) {
    return false;
  }

  const timer = setTimeout(() => {
    scheduledTimers.delete(reminder.id);
    scheduledReminderById.delete(reminder.id);
    void emitReminderNotification(reminder);
    updateSchedulerState({
      scheduledCount: scheduledTimers.size,
      nextFireAt: getNextFireAt()
    });
  }, delayMs);

  scheduledTimers.set(reminder.id, timer);
  scheduledReminderById.set(reminder.id, reminder);

  return true;
};

export const getReminderSchedulerState = (): ReminderSchedulerState =>
  schedulerState;

export const buildLocalTaskReminders = (
  tasks: LocalTaskRecord[],
  globalLeadMinutes: number[]
): ScheduledReminder[] => tasks.flatMap((task) => {
  if (task.status === "completed" || task.status === "deleted" || task.status === "outdated" || task.status === "overdue") return [];
  const eventStartAt = task.type === "deadline" ? task.endAt : task.startAt;
  const eventStartMs = Date.parse(eventStartAt);
  if (!Number.isFinite(eventStartMs)) return [];
  const mode = task.reminderMode ?? "global";
  if (mode === "none") return [];
  const entries = mode === "custom"
    ? [{ fireAt: task.reminderAt ?? "", leadMinutes: Math.max(0, Math.round((eventStartMs - Date.parse(task.reminderAt ?? "")) / 60_000)) }]
    : mode === "at-time"
      ? [{ fireAt: eventStartAt, leadMinutes: 0 }]
      : mode === "lead"
        ? [{ fireAt: new Date(eventStartMs - Math.max(0, task.reminderLeadMinutes ?? 0) * 60_000).toISOString(), leadMinutes: Math.max(0, task.reminderLeadMinutes ?? 0) }]
        : globalLeadMinutes.map((leadMinutes) => ({
          fireAt: new Date(eventStartMs - leadMinutes * 60_000).toISOString(),
          leadMinutes
        }));
  return entries
    .filter((entry) => Number.isFinite(Date.parse(entry.fireAt)))
    .map((entry) => ({
      id: `local-task:${task.id}:${entry.fireAt}`,
      title: task.title,
      kind: "task" as const,
      fireAt: entry.fireAt,
      eventStartAt,
      leadMinutes: entry.leadMinutes,
      location: task.location || undefined
    }));
});

export const scheduleWorkspaceReminders = (
  snapshot: CampusWorkspaceSnapshot | null,
  settings: ReminderSettingsRecord,
  now = new Date(),
  localTasks: LocalTaskRecord[] = []
): ReminderSchedulerState => {
  clearScheduledTimers();

  const supported = notificationsSupported();

  if (!settings.enabled || !supported) {
    return updateSchedulerState({
      enabled: settings.enabled,
      supported,
      scheduledCount: 0,
      nextFireAt: null,
      lastScheduledAt: now.toISOString(),
      transport: "electron"
    });
  }

  const sortedReminders: ScheduledReminder[] = [
    ...(snapshot?.reminders ?? []),
    ...buildLocalTaskReminders(localTasks, settings.leadMinutes)
  ].sort(
    (left, right) =>
      new Date(left.fireAt).getTime() - new Date(right.fireAt).getTime()
  );
  const nowMs = now.getTime();

  for (const reminder of sortedReminders) {
    const fireAtMs = Date.parse(reminder.fireAt);
    if (Number.isFinite(fireAtMs) && fireAtMs <= nowMs && nowMs - fireAtMs <= STARTUP_CATCH_UP_MS) {
      void emitReminderNotification(reminder);
      continue;
    }
    scheduleReminder(reminder, nowMs);
  }

  return updateSchedulerState({
    enabled: settings.enabled,
    supported,
    scheduledCount: scheduledTimers.size,
    nextFireAt: getNextFireAt(),
    lastScheduledAt: now.toISOString(),
    transport: "electron"
  });
};
