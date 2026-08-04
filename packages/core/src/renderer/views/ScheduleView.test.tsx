/* @vitest-environment jsdom */

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CampusWorkspaceSnapshot, LocalTaskPeriod, LocalTaskRecord, PluginComponentProps } from "@campusos/shared";
import { getShanghaiDayNumber, groupEventsByDay, ScheduleView } from "@campusos/plugin-schedule";

afterEach(cleanup);

const now = new Date();
const start = new Date(now.getTime() + 60 * 60 * 1000);
const end = new Date(start.getTime() + 60 * 60 * 1000);

const record: LocalTaskRecord = {
  id: "task-1",
  status: "running",
  description: "",
  timeSpentMinutes: 0,
  timeNeededMinutes: 60,
  startAt: start.toISOString(),
  endAt: end.toISOString(),
  location: "Room 1",
  title: "Read notes",
  breakable: true,
  type: "deadline",
  repeatType: "norepeat",
  repeatPeriod: 1,
  repeatEndsOn: start.toISOString().slice(0, 10),
  blocksPlanning: true,
  fromId: null
};

const snapshot: CampusWorkspaceSnapshot = {
  generatedAt: now.toISOString(),
  term: { label: "2026-2027", phase: "upcoming", currentWeek: null, progressPercent: 0 },
  sourceStates: [],
  courses: [],
  todayCourses: [],
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
};

const createSchedule = (initialTasks: LocalTaskRecord[] = [record]) => {
  let tasks = initialTasks;
  const bridge: NonNullable<PluginComponentProps["schedule"]> = {
    loadTasks: vi.fn(async () => ({ tasks, updatedAt: now.toISOString() })),
    loadPeriods: vi.fn(async (): Promise<LocalTaskPeriod[]> => [{
      id: "period-1",
      taskId: "task-1",
      title: "Read notes",
      description: "",
      location: "Room 1",
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      type: "deadline",
      status: "running",
      blocksPlanning: true
    }]),
    saveTask: vi.fn(async (input) => {
      tasks = [{ ...record, ...input, id: input.id ?? "task-new" }];
      return { tasks, updatedAt: new Date().toISOString() };
    }),
    mutateTask: vi.fn(async ({ id, status }) => {
      tasks = tasks.map((task) => task.id === id ? { ...task, status: status ?? task.status } : task);
      return { tasks, updatedAt: new Date().toISOString() };
    }),
    generatePlan: vi.fn(async () => ({
      valid: true,
      reason: null,
      restMinutes: 15,
      generatedAt: new Date().toISOString(),
      settings: { workMinutes: 60, restMinutes: 15, availableStartHour: 8, availableEndHour: 22, horizonDays: 7 },
      segments: []
    })),
    loadPlan: vi.fn(async () => null),
    exportIcal: vi.fn(async () => ({ filePath: "calendar.ics", eventCount: 1, generatedAt: new Date().toISOString() })),
    subscribe: vi.fn(() => () => undefined)
  };
  return bridge;
};

describe("ScheduleView", () => {
  it("loads formal task data, shows four views, and saves a new task through the bridge", async () => {
    const schedule = createSchedule();
    render(createElement(ScheduleView, {
      loading: false,
      snapshot,
      capabilities: { read: vi.fn() },
      onRefresh: vi.fn(async () => undefined),
      schedule
    }));

    expect((await screen.findAllByText("Read notes")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "周视图" }));
    expect(screen.getByRole("button", { name: "周视图" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "月历" }));
    fireEvent.click(screen.getByRole("button", { name: "新建任务" }));
    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "New task" } });
    fireEvent.click(screen.getByRole("button", { name: "保存任务" }));

    await waitFor(() => expect(schedule.saveTask).toHaveBeenCalledWith(expect.objectContaining({ title: "New task" })));
  });

  it("sends task status changes to the main-process bridge", async () => {
    const schedule = createSchedule();
    render(createElement(ScheduleView, {
      loading: false,
      snapshot,
      capabilities: { read: vi.fn() },
      onRefresh: vi.fn(async () => undefined),
      schedule
    }));
    await screen.findAllByText("Read notes");
    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    await waitFor(() => expect(schedule.mutateTask).toHaveBeenCalledWith({ id: "task-1", status: "completed" }));
  });

  it("shows fixed schedules and keeps fixed legacy history read-only", async () => {
    const fixed: LocalTaskRecord = {
      ...record,
      id: "fixed-1",
      title: "Weekly review",
      type: "fixed",
      repeatType: "days",
      repeatPeriod: 7,
      repeatEndsOn: "2026-12-31"
    };
    const history: LocalTaskRecord = {
      ...fixed,
      id: "fixed-history-1",
      title: "Weekly review（过去日程）",
      type: "fixedlegacy",
      repeatType: "norepeat",
      fromId: fixed.id,
      status: "outdated"
    };
    const schedule = createSchedule([fixed, history]);
    render(createElement(ScheduleView, {
      loading: false,
      snapshot,
      capabilities: { read: vi.fn() },
      onRefresh: vi.fn(async () => undefined),
      schedule
    }));

    expect((await screen.findAllByText("Weekly review")).length).toBeGreaterThan(0);
    expect(screen.getByText("历史日程（1 项）")).toBeTruthy();
    expect(screen.getByText("只读")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() => expect(schedule.mutateTask).toHaveBeenCalledWith({ id: "fixed-1", status: "deleted" }));
  });
});

describe("schedule event ranges", () => {
  it("renders exams from the canonical calendar event projection", async () => {
    const examSnapshot: CampusWorkspaceSnapshot = {
      ...snapshot,
      calendarEvents: [{
        id: "exam-event",
        originId: "exam-event",
        originCapability: "academic.exams@1",
        sourceId: "academic-affairs",
        kind: "exam",
        title: "Canonical exam",
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        timezone: "Asia/Shanghai",
        location: "Room 2",
        courseName: "Course",
        note: "Seat 1"
      }]
    };
    render(createElement(ScheduleView, {
      loading: false,
      snapshot: examSnapshot,
      capabilities: { read: vi.fn() },
      onRefresh: vi.fn(async () => undefined),
      schedule: createSchedule([])
    }));

    expect((await screen.findAllByText("Canonical exam")).length).toBeGreaterThan(0);
  });

  it("keeps baseline courses visible when a canonical feed is empty or partial", async () => {
    const partialSnapshot: CampusWorkspaceSnapshot = {
      ...snapshot,
      courses: [{
        id: "baseline-course",
        title: "Baseline course",
        sourceId: "cs-college",
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        location: "Room 3"
      }],
      calendarEvents: [{
        id: "exam-event",
        originId: "exam-event",
        originCapability: "academic.exams@1",
        sourceId: "academic-affairs",
        kind: "exam",
        title: "Canonical exam",
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        timezone: "Asia/Shanghai",
        location: "Room 2",
        courseName: "Course",
        note: "Seat 1"
      }]
    };
    render(createElement(ScheduleView, {
      loading: false,
      snapshot: partialSnapshot,
      capabilities: { read: vi.fn() },
      onRefresh: vi.fn(async () => undefined),
      schedule: createSchedule([])
    }));

    expect((await screen.findAllByText("Baseline course")).length).toBeGreaterThan(0);
  });

  it("uses the Shanghai date when the process timezone is elsewhere", () => {
    expect(getShanghaiDayNumber(new Date("2026-08-03T16:00:00.000Z"))).toBe(4);
  });

  it("groups only events intersecting the active view and includes spanning days", () => {
    const grouped = groupEventsByDay([
      {
        id: "in-range",
        title: "Spanning",
        kind: "task",
        startAt: "2026-08-04T23:00:00+08:00",
        endAt: "2026-08-05T02:00:00+08:00"
      },
      {
        id: "outside",
        title: "Outside",
        kind: "course",
        startAt: "2026-09-01T09:00:00+08:00",
        endAt: "2026-09-01T10:00:00+08:00"
      }
    ], {
      start: new Date("2026-08-04T00:00:00+08:00"),
      end: new Date("2026-08-06T00:00:00+08:00")
    });

    expect([...grouped.keys()]).toEqual(["2026-08-04", "2026-08-05"]);
    expect(grouped.get("2026-08-04")?.[0]?.title).toBe("Spanning");
    expect(grouped.get("2026-08-05")?.[0]?.title).toBe("Spanning");
  });
});
