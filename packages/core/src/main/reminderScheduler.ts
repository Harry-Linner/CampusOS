import { Notification } from "electron";
import { resolveLocalTaskReminderAt } from "@campusos/shared";
import type { CampusReminder, CampusWorkspaceSnapshot, LocalTaskRecord } from "@campusos/shared";
import type {
  ReminderSchedulerState,
  ReminderSettingsRecord
} from "../shared/reminderBridge";
import { createDefaultReminderSchedulerState } from "../shared/reminderBridge";
import { addNotification } from "./notificationCenter";
import { getTaskCalendarPeriods } from "./scheduleDomain";
import { loadCalendarEventPersonalizations } from "./deskCalendarStateStore";
import { buildReminderQueue } from "../shared/campusWorkspace";

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
  globalLeadMinutes: number[],
  now = new Date()
): ScheduledReminder[] => {
  const maxLead = Math.max(0, ...globalLeadMinutes, ...tasks.map((task) => task.reminderLeadMinutes ?? 0));
  const rangeStart = new Date(now.getTime() - STARTUP_CATCH_UP_MS - maxLead * 60_000);
  const rangeEnd = new Date(now.getTime() + MAX_TIMEOUT_MS + maxLead * 60_000);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  return getTaskCalendarPeriods(tasks, rangeStart, rangeEnd).flatMap((period) => {
  const task = byId.get(period.taskId);
  if (!task || period.status === "completed" || period.status === "deleted" || period.status === "outdated" || period.status === "overdue") return [];
  const override = period.occurrenceKey === undefined ? undefined : task.occurrenceOverrides?.[period.occurrenceKey];
  const eventStartAt = task.type === "deadline" ? (period.occurrenceEndAt ?? period.endAt) : (period.occurrenceStartAt ?? period.startAt);
  const eventStartMs = Date.parse(eventStartAt);
  if (!Number.isFinite(eventStartMs) || eventStartMs < now.getTime()) return [];
  const mode = override?.reminderMode ?? task.reminderMode ?? "global";
  if (mode === "none") return [];
  const customReminderAt = resolveLocalTaskReminderAt(task, {
    occurrenceKey: period.occurrenceKey,
    startAt: period.occurrenceStartAt ?? period.startAt,
    endAt: period.occurrenceEndAt ?? period.endAt
  }) ?? "";
  const lead = override?.reminderLeadMinutes ?? task.reminderLeadMinutes;
  const entries = mode === "custom"
    ? [{ fireAt: customReminderAt, leadMinutes: Math.max(0, Math.round((eventStartMs - Date.parse(customReminderAt)) / 60_000)) }]
    : mode === "at-time"
      ? [{ fireAt: eventStartAt, leadMinutes: 0 }]
      : mode === "lead"
        ? [{ fireAt: new Date(eventStartMs - Math.max(0, lead ?? 0) * 60_000).toISOString(), leadMinutes: Math.max(0, lead ?? 0) }]
        : globalLeadMinutes.map((leadMinutes) => ({
          fireAt: new Date(eventStartMs - leadMinutes * 60_000).toISOString(),
          leadMinutes
        }));
  return entries
    .filter((entry) => Number.isFinite(Date.parse(entry.fireAt)))
    .map((entry) => ({
      id: `local-task:${period.occurrenceId ?? `${task.id}:0`}:${entry.fireAt}`,
      title: period.title,
      kind: "task" as const,
      fireAt: entry.fireAt,
      eventStartAt,
      leadMinutes: entry.leadMinutes,
      location: period.location || undefined
    }));
  });
};

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

  let personalizations: ReturnType<typeof loadCalendarEventPersonalizations> = {};
  try { personalizations = loadCalendarEventPersonalizations(); } catch { /* Database unavailable in isolated schedulers. */ }
  const canonicalEventIds = new Set(snapshot?.calendarEvents?.map((event) => event.id) ?? []);
  const personalizedEvents: Array<{
    eventId: string;
    title: string;
    kind: "course" | "deadline" | "task";
    eventStartAt: string;
    location?: string;
  }> = [
    ...(snapshot?.calendarEvents ?? []).map((event) => ({
      eventId: `calendar:${event.id}`,
      title: event.title,
      kind: event.kind === "course" ? "course" as const : event.kind === "task" ? "task" as const : "deadline" as const,
      eventStartAt: event.startAt,
      location: event.location ?? undefined
    })),
    ...(snapshot?.courses ?? []).filter((course) => !canonicalEventIds.has(course.id)).map((course) => ({
      eventId: `course:${course.id}`,
      title: course.title,
      kind: "course" as const,
      eventStartAt: course.startAt,
      location: course.location
    })),
    ...(snapshot?.deadlines ?? []).filter((deadline) => !canonicalEventIds.has(deadline.id)).map((deadline) => ({
      eventId: `deadline:${deadline.id}`,
      title: deadline.title,
      kind: "deadline" as const,
      eventStartAt: deadline.dueAt
    }))
  ];
  const personalizedReminders: ScheduledReminder[] = personalizedEvents.flatMap((event) => {
    const leadMinutes = personalizations[event.eventId]?.reminderLeadMinutes;
    if (leadMinutes === null || leadMinutes === undefined) return [];
    const eventStartAt = event.eventStartAt;
    const startMs = Date.parse(eventStartAt);
    if (!Number.isFinite(startMs)) return [];
    return [{
      id: `personalized:${event.eventId}:${eventStartAt}:${leadMinutes}`,
      title: event.title,
      kind: event.kind,
      fireAt: new Date(startMs - leadMinutes * 60_000).toISOString(),
      eventStartAt,
      leadMinutes,
      location: event.location ?? undefined
    }];
  });
  const overriddenIds = new Set(personalizedEvents.filter((event) => personalizations[event.eventId]?.reminderLeadMinutes != null)
    .map((event) => event.eventId.slice(event.eventId.indexOf(":") + 1)));
  const catchUp = buildReminderQueue(
    (snapshot?.courses ?? []).filter((course) => !overriddenIds.has(course.id)),
    (snapshot?.deadlines ?? []).filter((deadline) => !overriddenIds.has(deadline.id)),
    settings.leadMinutes,
    new Date(now.getTime() - STARTUP_CATCH_UP_MS).toISOString()
  ).filter((reminder) => Date.parse(reminder.fireAt) <= now.getTime() && Date.parse(reminder.eventStartAt) >= now.getTime());
  const sortedReminders: ScheduledReminder[] = [...new Map([
    ...(snapshot?.reminders ?? []),
    ...catchUp,
    ...personalizedReminders,
    ...buildLocalTaskReminders(localTasks, settings.leadMinutes, now)
  ].map((reminder) => [reminder.id, reminder])).values()].sort(
    (left, right) =>
      new Date(left.fireAt).getTime() - new Date(right.fireAt).getTime()
  );
  const nowMs = now.getTime();

  for (const reminder of sortedReminders) {
    if (Date.parse(reminder.eventStartAt) < nowMs) continue;
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
