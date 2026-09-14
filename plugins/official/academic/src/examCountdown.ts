import type { CalendarEventRecord, CalendarEventsData, CapabilityRecord } from "@campusos/shared";

export interface ExamCountdownEntry {
  eventId: string;
  examTitle: string;
  courseName: string | null;
  startAt: string;
  location: string | null;
  daysUntil: number;
  hoursUntil: number;
  isUrgent: boolean;
}

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const URGENT_THRESHOLD_DAYS = 3;

export const computeExamCountdowns = (
  records: readonly CapabilityRecord<CalendarEventsData>[],
  now: Date
): ExamCountdownEntry[] => {
  const allEvents = records.flatMap((record) => record.data?.events ?? []);

  const futureExams = allEvents
    .filter((event): event is CalendarEventRecord & { endAt: string } =>
      event.kind === "exam" &&
      event.endAt !== null &&
      Date.parse(event.startAt) > now.getTime()
    );

  const entries = futureExams.map((exam): ExamCountdownEntry => {
    const startMs = Date.parse(exam.startAt);
    const remainingMs = startMs - now.getTime();
    const daysUntil = Math.floor(remainingMs / MS_PER_DAY);
    const hoursUntil = Math.floor((remainingMs % MS_PER_DAY) / MS_PER_HOUR);

    return {
      eventId: exam.id,
      examTitle: exam.title,
      courseName: exam.courseName,
      startAt: exam.startAt,
      location: exam.location,
      daysUntil,
      hoursUntil,
      isUrgent: remainingMs <= URGENT_THRESHOLD_DAYS * MS_PER_DAY
    };
  });

  return entries.sort(
    (left, right) => Date.parse(left.startAt) - Date.parse(right.startAt)
  );
};
