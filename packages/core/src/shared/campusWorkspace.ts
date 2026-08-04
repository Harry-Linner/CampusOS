import type {
  CampusCourseSession,
  CampusDeadline,
  CampusReminder
} from "@campusos/shared";

const MINUTE_IN_MS = 60 * 1000;

const addMinutes = (base: Date, minutes: number): Date =>
  new Date(base.getTime() + minutes * MINUTE_IN_MS);

const toIso = (value: Date): string => value.toISOString();

const sortByDate = <T>(items: T[], selector: (item: T) => string): T[] =>
  [...items].sort(
    (left, right) =>
      new Date(selector(left)).getTime() - new Date(selector(right)).getTime()
  );

/**
 * Builds desktop reminders from the canonical workspace projection.
 * Data ingestion belongs to Core connectors; this module deliberately has no
 * fallback courses, deadlines, credentials, or development timestamps.
 */
export const buildReminderQueue = (
  courses: readonly CampusCourseSession[],
  deadlines: readonly CampusDeadline[],
  reminderLeadMinutes: readonly number[],
  nowIso: string
): CampusReminder[] => {
  const now = new Date(nowIso);
  const queue: CampusReminder[] = [];

  for (const course of courses) {
    const eventStart = new Date(course.startAt);

    for (const leadMinutes of reminderLeadMinutes) {
      const fireAt = addMinutes(eventStart, -leadMinutes);

      if (fireAt.getTime() <= now.getTime()) continue;

      queue.push({
        id: `${course.id}-lead-${leadMinutes}`,
        title: `${course.title} 即将开始`,
        kind: "course",
        sourceId: course.sourceId,
        fireAt: toIso(fireAt),
        eventStartAt: course.startAt,
        leadMinutes,
        location: course.location
      });
    }
  }

  for (const deadline of deadlines) {
    const eventStart = new Date(deadline.dueAt);

    for (const leadMinutes of reminderLeadMinutes) {
      const fireAt = addMinutes(eventStart, -leadMinutes);

      if (fireAt.getTime() <= now.getTime()) continue;

      queue.push({
        id: `${deadline.id}-lead-${leadMinutes}`,
        title: `${deadline.title} 即将截止`,
        kind: "deadline",
        sourceId: deadline.sourceId,
        fireAt: toIso(fireAt),
        eventStartAt: deadline.dueAt,
        leadMinutes
      });
    }
  }

  return sortByDate(queue, (item) => item.fireAt);
};
