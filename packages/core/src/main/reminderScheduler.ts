import { Notification } from "electron";
import type { CampusReminder, CampusWorkspaceSnapshot } from "@campusos/shared";
import type {
  ReminderSchedulerState,
  ReminderSettingsRecord
} from "../shared/reminderBridge";
import { createDefaultReminderSchedulerState } from "../shared/reminderBridge";

const MAX_TIMEOUT_MS = 2_147_483_647;

const scheduledTimers = new Map<string, NodeJS.Timeout>();
const scheduledReminderById = new Map<string, CampusReminder>();

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

const buildReminderBody = (reminder: CampusReminder): string => {
  if (reminder.kind === "course") {
    return reminder.location
      ? `Course starts in ${reminder.leadMinutes} minutes at ${reminder.location}`
      : `Course starts in ${reminder.leadMinutes} minutes`;
  }

  return `Deadline closes in ${reminder.leadMinutes} minutes`;
};

const showReminderNotification = (reminder: CampusReminder): void => {
  if (!notificationsSupported()) {
    return;
  }

  const notification = new Notification({
    title: reminder.title,
    body: buildReminderBody(reminder),
    silent: false
  });

  notification.show();
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

const scheduleReminder = (reminder: CampusReminder, nowMs: number): boolean => {
  const fireAtMs = new Date(reminder.fireAt).getTime();
  const delayMs = fireAtMs - nowMs;

  if (delayMs <= 0 || delayMs > MAX_TIMEOUT_MS) {
    return false;
  }

  const timer = setTimeout(() => {
    scheduledTimers.delete(reminder.id);
    scheduledReminderById.delete(reminder.id);
    showReminderNotification(reminder);
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

export const scheduleWorkspaceReminders = (
  snapshot: CampusWorkspaceSnapshot,
  settings: ReminderSettingsRecord,
  now = new Date()
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

  const sortedReminders = [...snapshot.reminders].sort(
    (left, right) =>
      new Date(left.fireAt).getTime() - new Date(right.fireAt).getTime()
  );
  const nowMs = now.getTime();

  for (const reminder of sortedReminders) {
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
