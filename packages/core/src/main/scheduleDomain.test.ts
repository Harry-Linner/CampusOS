import type { CampusWorkspaceSnapshot, LocalTaskRecord, PlannerSettings } from "@campusos/shared";
import { describe, expect, it } from "vitest";
import type { CalendarEventRecord } from "@campusos/shared";
import {
  createIcalContent,
  createTaskRecord,
  generatePlannerSchedule,
  getTaskCalendarPeriods,
  refreshLocalTasks
} from "./scheduleDomain";

const now = new Date("2026-08-04T10:00:00+08:00");

const task = (overrides: Partial<LocalTaskRecord>): LocalTaskRecord => ({
  id: "task-1",
  status: "running",
  description: "",
  timeSpentMinutes: 0,
  timeNeededMinutes: 60,
  startAt: "2026-08-04T08:00:00+08:00",
  endAt: "2026-08-04T18:00:00+08:00",
  location: "",
  title: "Task",
  breakable: true,
  type: "deadline",
  repeatType: "norepeat",
  repeatPeriod: 1,
  repeatEndsOn: "2026-08-04",
  blocksPlanning: true,
  fromId: null,
  ...overrides
});

const snapshot = (courses: CampusWorkspaceSnapshot["courses"] = []): CampusWorkspaceSnapshot => ({
  generatedAt: now.toISOString(),
  term: {
    label: "2026-2027 Autumn",
    phase: "upcoming",
    currentWeek: null,
    progressPercent: 0
  },
  sourceStates: [],
  courses,
  todayCourses: courses,
  deadlines: [],
  materials: [],
  downloads: [],
  reminders: [],
  summary: {
    readySources: 0,
    totalSources: 0,
    downloadsInFlight: 0,
    materialsReady: 0,
    remindersQueued: 0,
    deadlinesDueSoon: 0
  }
});

const calendarEvent = (
  overrides: Partial<CalendarEventRecord> = {}
): CalendarEventRecord => ({
  id: "event-1",
  originId: "origin-1",
  originCapability: "academic.exams@1",
  sourceId: "academic-affairs",
  kind: "exam",
  title: "Final exam",
  startAt: "2026-08-04T11:00:00+08:00",
  endAt: "2026-08-04T13:00:00+08:00",
  timezone: "Asia/Shanghai",
  location: "Exam room",
  courseName: "Final exam",
  note: "Seat 1",
  ...overrides
});

describe("schedule domain", () => {
  it("matches Celechron status refresh and rolls fixed instances into history", () => {
    let id = 0;
    const refreshed = refreshLocalTasks(
      [
        task({ id: "done", timeSpentMinutes: 60 }),
        task({
          id: "overdue",
          startAt: "2026-08-03T08:00:00+08:00",
          endAt: "2026-08-03T18:00:00+08:00"
        }),
        task({
          id: "weekly",
          title: "Weekly",
          type: "fixed",
          startAt: "2026-08-01T09:00:00+08:00",
          endAt: "2026-08-01T10:00:00+08:00",
          repeatType: "days",
          repeatPeriod: 1,
          repeatEndsOn: "2026-08-07",
          breakable: false
        })
      ],
      now,
      { idFactory: () => `legacy-${++id}` }
    );

    expect(refreshed.tasks.find((item) => item.id === "done")?.status).toBe("completed");
    expect(refreshed.tasks.find((item) => item.id === "overdue")?.status).toBe("overdue");
    expect(refreshed.tasks.filter((item) => item.type === "fixedlegacy")).toHaveLength(3);
    expect(refreshed.tasks.find((item) => item.id === "weekly")?.startAt).toBe(
      "2026-08-04T01:00:00.000Z"
    );
  });

  it("skips invalid monthly dates exactly as Celechron does", () => {
    const record = createTaskRecord(
      {
        title: "Monthly",
        description: "",
        timeSpentMinutes: 0,
        timeNeededMinutes: 30,
        startAt: "2026-01-31T09:00:00+08:00",
        endAt: "2026-01-31T10:00:00+08:00",
        location: "",
        breakable: false,
        type: "fixed",
        repeatType: "month",
        repeatPeriod: 1,
        repeatEndsOn: "2026-04-30",
        blocksPlanning: true
      },
      { idFactory: () => "monthly" }
    );
    const periods = getTaskCalendarPeriods(
      [record],
      new Date("2026-01-01T00:00:00+08:00"),
      new Date("2026-05-01T00:00:00+08:00")
    );
    expect(periods.map((item) => item.startAt.slice(0, 10))).toEqual([
      "2026-01-31",
      "2026-03-31"
    ]);
  });

  it("chops multi-day tasks into day periods", () => {
    const periods = getTaskCalendarPeriods(
      [
        task({
          startAt: "2026-08-04T23:00:00+08:00",
          endAt: "2026-08-05T02:00:00+08:00",
          breakable: false
        })
      ],
      new Date("2026-08-04T00:00:00+08:00"),
      new Date("2026-08-06T00:00:00+08:00")
    );
    expect(periods).toHaveLength(2);
    expect(new Date(periods[0].endAt).getTime() - new Date(periods[0].startAt).getTime()).toBe(60 * 60_000);
    expect(new Date(periods[1].endAt).getTime() - new Date(periods[1].startAt).getTime()).toBe(2 * 60 * 60_000);
  });

  it("uses earliest deadline first, respects course blockers, and is deterministic", () => {
    const settings: PlannerSettings = {
      workMinutes: 60,
      restMinutes: 15,
      availableStartHour: 8,
      availableEndHour: 12,
      horizonDays: 1
    };
    const courses = [
      {
        id: "course-1",
        title: "Class",
        location: "Room",
        startAt: "2026-08-04T09:00:00+08:00",
        endAt: "2026-08-04T10:00:00+08:00",
        sourceId: "academic-affairs" as const
      }
    ];
    const tasks = [
      task({
        id: "early",
        title: "Early",
        timeNeededMinutes: 90,
        endAt: "2026-08-04T12:00:00+08:00"
      })
    ];
    const first = generatePlannerSchedule(snapshot(courses), tasks, settings, now);
    const second = generatePlannerSchedule(snapshot(courses), tasks, settings, now);
    expect(first).toEqual(second);
    expect(first.valid).toBe(true);
    expect(first.segments.map((segment) => segment.startAt.slice(11, 16))).toEqual(["02:00", "03:15"]);
  });

  it("returns a user-facing reason when no valid plan exists", () => {
    const result = generatePlannerSchedule(
      snapshot(),
      [task({ title: "Impossible", timeNeededMinutes: 600, endAt: "2026-08-04T11:00:00+08:00" })],
      {
        workMinutes: 60,
        restMinutes: 15,
        availableStartHour: 8,
        availableEndHour: 10,
        horizonDays: 1
      },
      now
    );
    expect(result.valid).toBe(false);
    expect(result.segments).toEqual([]);
    expect(result.reason).toContain("Impossible");
  });

  it("blocks planner time with canonical exam events", () => {
    const result = generatePlannerSchedule(
      {
        ...snapshot(),
        calendarEvents: [calendarEvent()]
      },
      [task({
        id: "exam-blocked",
        title: "Study",
        timeNeededMinutes: 120,
        endAt: "2026-08-04T14:00:00+08:00"
      })],
      {
        workMinutes: 120,
        restMinutes: 0,
        availableStartHour: 10,
        availableEndHour: 14,
        horizonDays: 1
      },
      now
    );
    expect(result.valid).toBe(true);
    expect(result.segments.map((segment) => [segment.startAt.slice(11, 16), segment.endAt.slice(11, 16)])).toEqual([
      ["02:00", "03:00"],
      ["05:00", "06:00"]
    ]);
  });

  it("keeps an unrepresented baseline course as a planner blocker", () => {
    const result = generatePlannerSchedule(
      {
        ...snapshot([{
          id: "baseline-course",
          title: "Baseline course",
          location: "Room 3",
          startAt: "2026-08-04T13:00:00+08:00",
          endAt: "2026-08-04T14:00:00+08:00",
          sourceId: "cs-college"
        }]),
        calendarEvents: [calendarEvent()]
      },
      [task({
        id: "blocked-by-baseline",
        title: "Study",
        timeNeededMinutes: 120,
        endAt: "2026-08-04T14:00:00+08:00"
      })],
      {
        workMinutes: 120,
        restMinutes: 0,
        availableStartHour: 10,
        availableEndHour: 14,
        horizonDays: 1
      },
      now
    );
    expect(result.valid).toBe(false);
  });

  it("exports canonical exam times and does not turn them into one-hour deadlines", () => {
    const result = createIcalContent(
      { ...snapshot(), calendarEvents: [calendarEvent()] },
      [],
      { academicYearStart: 2026, termLabel: "2026-2027 ç§‹å†¬" },
      now
    );
    expect(result.eventCount).toBe(1);
    expect(result.content).toContain("SUMMARY:Final exam");
    expect(result.content).toContain("DTSTART;TZID=Asia/Shanghai:20260804T110000");
    expect(result.content).toContain("DTEND;TZID=Asia/Shanghai:20260804T130000");
  });

  it("excludes canonical tasks when task export is disabled", () => {
    const result = createIcalContent(
      {
        ...snapshot(),
        calendarEvents: [{
          ...calendarEvent(),
          id: "canonical-task",
          kind: "task",
          title: "Canonical task"
        }]
      },
      [],
      { academicYearStart: 2026, termLabel: "2026-2027", includeTasks: false },
      now
    );

    expect(result.eventCount).toBe(0);
    expect(result.content).not.toContain("SUMMARY:Canonical task");
  });

  it("generates stable RFC 5545 content with escaped fields", () => {
    const input = { academicYearStart: 2026, termLabel: "Autumn, 2026" };
    const first = createIcalContent(
      snapshot(),
      [task({ title: "Task; A", description: "line 1\nline 2", location: "Room, 1" })],
      input,
      now
    );
    const second = createIcalContent(snapshot(), [task({ title: "Task; A", description: "line 1\nline 2", location: "Room, 1" })], input, now);
    expect(first).toEqual(second);
    expect(first.eventCount).toBe(1);
    expect(first.content).toContain("SUMMARY:Task\\; A");
    expect(first.content).toContain("DESCRIPTION:line 1\\nline 2");
    expect(first.content).toContain("LOCATION:Room\\, 1");
  });

  it("keeps a floating task out of the calendar while preserving its task record", () => {
    const floating = createTaskRecord({
      ...task({}),
      title: "Inbox item",
      type: "floating",
      reminderMode: "none"
    });
    const refreshed = refreshLocalTasks([floating], now);
    expect(refreshed.tasks).toHaveLength(1);
    expect(refreshed.tasks[0]).toMatchObject({ title: "Inbox item", type: "floating", status: "running" });
    expect(getTaskCalendarPeriods(refreshed.tasks, now, new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000))).toEqual([]);
  });
});
