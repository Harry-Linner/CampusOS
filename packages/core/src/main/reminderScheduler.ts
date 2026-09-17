import { BrowserWindow, Notification } from "electron";
import { resolveLocalTaskReminderAt } from "@campusos/shared";
import type { CampusReminder, CampusWorkspaceSnapshot, LocalTaskRecord } from "@campusos/shared";
import type {
  ReminderSchedulerState,
  ReminderSettingsRecord
} from "../shared/reminderBridge";
import {
  createDefaultReminderSchedulerState,
  normalizeReminderLeadMinutes
} from "../shared/reminderBridge";
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

export const REMINDER_FIRED_CHANNEL = "campusos:reminder:fired";
let currentDeparturePrompt = "";

const buildReminderBody = (reminder: ScheduledReminder): string => {
  if (reminder.kind === "course") {
    const loc = reminder.location
      ? `课程将在 ${reminder.leadMinutes} 分钟后开始，地点：${reminder.location}`
      : `课程将在 ${reminder.leadMinutes} 分钟后开始`;
    const prompt = currentDeparturePrompt.trim();
    return prompt ? `${loc}\n${prompt}` : loc;
  }

  if (reminder.kind === "deadline") {
    const hours = Math.round(reminder.leadMinutes / 60);
    return hours >= 1 && reminder.leadMinutes % 60 === 0
      ? `将在 ${hours} 小时后截止`
      : `将在 ${reminder.leadMinutes} 分钟后截止`;
  }
  if (reminder.leadMinutes === 0) return "时间到了";
  return `将在 ${reminder.leadMinutes} 分钟后开始`;
};

const emitReminderNotification = async (reminder: ScheduledReminder): Promise<void> => {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(REMINDER_FIRED_CHANNEL, {
          id: reminder.id,
          title: reminder.title,
          kind: reminder.kind,
          leadMinutes: reminder.leadMinutes,
          location: reminder.location,
          eventStartAt: reminder.eventStartAt,
          departurePrompt: currentDeparturePrompt,
          body: buildReminderBody(reminder)
        });
      }
    }
  } catch {
    // Window broadcast safe fallback
  }

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
  currentDeparturePrompt = typeof settings.departurePromptText === "string" ? settings.departurePromptText.trim() : "";

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
  const submittedIds = new Set(snapshot?.calendarEvents?.filter(event => event.submissionStatus === "submitted").map(event => event.id) ?? []);
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
      kind: event.kind === "course" ? "course" as const : "deadline" as const,
      eventStartAt: event.kind === "assignment" ? (event.endAt ?? event.startAt) : event.startAt,
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
    if (personalizations[event.eventId]?.completed || submittedIds.has(event.eventId.replace(/^calendar:/, ""))) return [];
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
  const isDeadlineReminderSuppressed = (
    deadlineId: string,
    fireAtIso: string
  ): boolean => {
    if (submittedIds.has(deadlineId)) return true;
    const p = personalizations[`calendar:${deadlineId}`] ??
      personalizations[`deadline:${deadlineId}`] ??
      personalizations[deadlineId];
    if (!p || !p.completed) return false;
    if (!p.completedAt) return true;
    const completedMs = Date.parse(p.completedAt);
    const fireAtMs = Date.parse(fireAtIso);
    return Number.isFinite(completedMs) && Number.isFinite(fireAtMs) && completedMs <= fireAtMs;
  };

  const courseLeadMinutes = typeof settings.courseReminderLeadMinutes === "number" && Number.isFinite(settings.courseReminderLeadMinutes)
    ? [Math.max(0, Math.min(120, Math.trunc(settings.courseReminderLeadMinutes)))]
    : settings.leadMinutes;
  const deadlineLeadMinutes = normalizeReminderLeadMinutes([...settings.leadMinutes, 180, 1440]);

  const courseReminders = buildReminderQueue(
    (snapshot?.courses ?? []).filter((course) => !overriddenIds.has(course.id)),
    [],
    courseLeadMinutes,
    now.toISOString()
  );

  const deadlineReminders = buildReminderQueue(
    [],
    (snapshot?.deadlines ?? []).filter((deadline) => !overriddenIds.has(deadline.id)),
    deadlineLeadMinutes,
    now.toISOString()
  ).filter((reminder) => !isDeadlineReminderSuppressed(reminder.id.replace(/-lead-\d+$/, ""), reminder.fireAt));

  const catchUpCourses = buildReminderQueue(
    (snapshot?.courses ?? []).filter((course) => !overriddenIds.has(course.id)),
    [],
    courseLeadMinutes,
    new Date(now.getTime() - STARTUP_CATCH_UP_MS).toISOString()
  ).filter((reminder) => Date.parse(reminder.fireAt) <= now.getTime() && Date.parse(reminder.eventStartAt) >= now.getTime());

  const catchUpDeadlines = buildReminderQueue(
    [],
    (snapshot?.deadlines ?? []).filter((deadline) => !overriddenIds.has(deadline.id)),
    deadlineLeadMinutes,
    new Date(now.getTime() - STARTUP_CATCH_UP_MS).toISOString()
  ).filter((reminder) =>
    Date.parse(reminder.fireAt) <= now.getTime() &&
    Date.parse(reminder.eventStartAt) >= now.getTime() &&
    !isDeadlineReminderSuppressed(reminder.id.replace(/-lead-\d+$/, ""), reminder.fireAt)
  );

  const sortedReminders: ScheduledReminder[] = [...new Map([
    ...(snapshot?.reminders ?? []).filter((reminder) =>
      reminder.kind !== "deadline" || !isDeadlineReminderSuppressed(reminder.id.replace(/-lead-\d+$/, ""), reminder.fireAt)
    ),
    ...courseReminders,
    ...deadlineReminders,
    ...catchUpCourses,
    ...catchUpDeadlines,
    ...personalizedReminders.filter((reminder) =>
      reminder.kind !== "deadline" || !isDeadlineReminderSuppressed(reminder.id, reminder.fireAt)
    ),
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
