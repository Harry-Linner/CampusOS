import { describe, expect, it } from "vitest";
import type { CampusCourseSession, CampusDeadline } from "@campusos/shared";
import { detectCalendarConflicts } from "./calendarConflictDetector";

describe("calendarConflictDetector", () => {
  const buildCourse = (id: string, title: string, startAt: string, endAt: string): CampusCourseSession => ({
    id, title, sourceId: "academic-affairs", location: "教室", startAt, endAt
  });

  const buildDeadline = (id: string, title: string, dueAt: string): CampusDeadline => ({
    id, title, sourceId: "learning-platform", dueAt, kind: "assignment", priority: "important"
  });

  it("detects overlapping courses", () => {
    const conflicts = detectCalendarConflicts({
      courses: [
        buildCourse("a", "高数", "2026-09-14T08:00:00+08:00", "2026-09-14T09:35:00+08:00"),
        buildCourse("b", "线代", "2026-09-14T09:00:00+08:00", "2026-09-14T10:35:00+08:00")
      ],
      deadlines: []
    });

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].severity).toBe("double-booked");
    expect(conflicts[0].titleA).toBe("高数");
    expect(conflicts[0].titleB).toBe("线代");
  });

  it("detects double-booked when overlap exceeds 30 min", () => {
    const conflicts = detectCalendarConflicts({
      courses: [
        buildCourse("a", "高数", "2026-09-14T08:00:00+08:00", "2026-09-14T09:35:00+08:00"),
        buildCourse("b", "物理", "2026-09-14T08:00:00+08:00", "2026-09-14T09:35:00+08:00")
      ],
      deadlines: []
    });

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].severity).toBe("double-booked");
  });

  it("returns empty when no overlap exists", () => {
    const conflicts = detectCalendarConflicts({
      courses: [
        buildCourse("a", "高数", "2026-09-14T08:00:00+08:00", "2026-09-14T09:35:00+08:00"),
        buildCourse("b", "线代", "2026-09-14T10:00:00+08:00", "2026-09-14T11:35:00+08:00")
      ],
      deadlines: []
    });

    expect(conflicts).toHaveLength(0);
  });

  it("detects deadline during a course", () => {
    const conflicts = detectCalendarConflicts({
      courses: [
        buildCourse("a", "高数", "2026-09-14T08:00:00+08:00", "2026-09-14T09:35:00+08:00")
      ],
      deadlines: [
        buildDeadline("dl", "作业截止", "2026-09-14T09:00:00+08:00")
      ]
    });

    expect(conflicts).toHaveLength(1);
  });

  it("handles empty inputs gracefully", () => {
    expect(detectCalendarConflicts({ courses: [], deadlines: [] })).toEqual([]);
  });
});
