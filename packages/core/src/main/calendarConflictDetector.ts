import type {
  CalendarEventRecord,
  CampusCourseSession,
  CampusDeadline
} from "@campusos/shared";

export type ConflictSeverity = "overlap" | "double-booked";

export interface CalendarConflict {
  id: string;
  severity: ConflictSeverity;
  itemA: string;
  itemB: string;
  titleA: string;
  titleB: string;
  overlapStart: string;
  overlapEnd: string;
}

const parseMs = (iso: string): number => Date.parse(iso);

export const detectCalendarConflicts = ({
  courses,
  deadlines
}: {
  courses: readonly CampusCourseSession[];
  deadlines: readonly CampusDeadline[];
}): CalendarConflict[] => {
  const items: Array<{
    id: string;
    title: string;
    startMs: number;
    endMs: number;
  }> = [];

  for (const course of courses) {
    const start = parseMs(course.startAt);
    const end = parseMs(course.endAt);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    items.push({ id: course.id, title: course.title, startMs: start, endMs: end });
  }

  for (const deadline of deadlines) {
    const due = parseMs(deadline.dueAt);
    if (!Number.isFinite(due)) continue;
    items.push({ id: deadline.id, title: deadline.title, startMs: due, endMs: due + 60_000 });
  }

  const conflicts: CalendarConflict[] = [];
  const seen = new Set<string>();

  for (let a = 0; a < items.length; a += 1) {
    for (let b = a + 1; b < items.length; b += 1) {
      const itemA = items[a];
      const itemB = items[b];

      if (itemA.endMs <= itemB.startMs || itemB.endMs <= itemA.startMs) continue;

      const overlapStart = Math.max(itemA.startMs, itemB.startMs);
      const overlapEnd = Math.min(itemA.endMs, itemB.endMs);
      const overlapMs = overlapEnd - overlapStart;

      if (overlapMs <= 0) continue;

      const severity: ConflictSeverity =
        overlapMs >= 30 * 60_000 ? "double-booked" : "overlap";

      const pairKey = [itemA.id, itemB.id].sort().join("|||");
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);

      conflicts.push({
        id: `conflict-${itemA.id}-${itemB.id}`,
        severity,
        itemA: itemA.id,
        itemB: itemB.id,
        titleA: itemA.title,
        titleB: itemB.title,
        overlapStart: new Date(overlapStart).toISOString(),
        overlapEnd: new Date(overlapEnd).toISOString()
      });
    }
  }

  return conflicts.sort((left, right) => parseMs(left.overlapStart) - parseMs(right.overlapStart));
};

export const detectEventConflicts = (
  events: readonly CalendarEventRecord[]
): CalendarConflict[] => {
  const courses: CampusCourseSession[] = [];
  const deadlines: CampusDeadline[] = [];

  for (const event of events) {
    if (event.kind === "course" && event.endAt) {
      courses.push({
        id: event.id, title: event.title, location: event.location ?? "",
        startAt: event.startAt, endAt: event.endAt, sourceId: event.sourceId
      });
    } else {
      deadlines.push({
        id: event.id, title: event.title, dueAt: event.startAt, sourceId: event.sourceId,
        kind: event.kind === "exam" ? "exam" : event.kind === "assignment" ? "assignment" : "workflow",
        priority: "important", courseName: event.courseName ?? undefined, note: event.note ?? undefined
      });
    }
  }

  return detectCalendarConflicts({ courses, deadlines });
};
