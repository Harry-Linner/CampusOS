import type { LocalTaskRecord } from "./pluginCapabilities";

/** Series custom reminders are offsets; an explicit occurrence override is absolute. */
export const resolveLocalTaskReminderAt = (
  task: LocalTaskRecord,
  occurrence: { occurrenceKey?: string; startAt: string; endAt: string }
): string | null => {
  const override = task.occurrenceOverrides?.[occurrence.occurrenceKey ?? "0"];
  if (override && Object.prototype.hasOwnProperty.call(override, "reminderAt")) return override.reminderAt ?? null;
  if (!task.reminderAt) return null;
  const anchor = task.type === "deadline" ? task.endAt : task.startAt;
  const current = task.type === "deadline" ? occurrence.endAt : occurrence.startAt;
  return new Date(Date.parse(current) + Date.parse(task.reminderAt) - Date.parse(anchor)).toISOString();
};
