/* @vitest-environment jsdom */

import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CampusWorkspaceSnapshot,
  DeskCalendarSnapshotMessage
} from "@campusos/shared";
import {
  buildDeskCalendarEvents,
  DeskCalendarApp,
  type DeskCalendarWindowApi
} from "./DeskCalendarApp";

const now = new Date("2026-08-15T04:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const snapshot: CampusWorkspaceSnapshot = {
  generatedAt: now.toISOString(),
  term: {
    label: "2025-2026 春夏学期",
    phase: "active",
    currentWeek: null,
    progressPercent: 0
  },
  sourceStates: [],
  courses: [],
  todayCourses: [],
  deadlines: [],
  materials: [],
  downloads: [],
  reminders: [],
  calendarEvents: [
    {
      id: "event-1",
      originId: "session-1",
      originCapability: "academic.timetable@1",
      sourceId: "academic-affairs",
      kind: "course",
      title: "小学期课程",
      startAt: "2026-08-15T01:00:00.000Z",
      endAt: "2026-08-15T02:35:00.000Z",
      timezone: "Asia/Shanghai",
      location: "紫金港东1A-301",
      courseName: "小学期课程",
      note: null
    },
    {
      id: "event-2",
      originId: "exam-1",
      originCapability: "academic.exams@1",
      sourceId: "academic-affairs",
      kind: "exam",
      title: "期末考试",
      startAt: "2026-08-16T06:00:00.000Z",
      endAt: "2026-08-16T08:00:00.000Z",
      timezone: "Asia/Shanghai",
      location: "紫金港西2-205",
      courseName: "小学期课程",
      note: null
    }
  ],
  summary: {
    readySources: 0,
    totalSources: 0,
    downloadsInFlight: 0,
    materialsReady: 0,
    remindersQueued: 0,
    deadlinesDueSoon: 0
  }
};

const message: DeskCalendarSnapshotMessage = {
  view: "month",
  snapshot,
  generatedAt: snapshot.generatedAt
};

const createApi = (overrides: Partial<DeskCalendarWindowApi> = {}): DeskCalendarWindowApi => ({
  loadSettings: vi.fn(async () => ({ showClock: true })),
  loadSnapshot: vi.fn(async () => message),
  completeTask: vi.fn(async () => undefined),
  saveTask: vi.fn(async () => undefined),
  setView: vi.fn(async () => undefined),
  setShowClock: vi.fn(async () => undefined),
  close: vi.fn(async () => undefined),
  openMain: vi.fn(async () => undefined),
  subscribe: vi.fn(() => () => undefined),
  ...overrides
});

describe("buildDeskCalendarEvents", () => {
  it("flattens canonical events, courses, and deadlines into day events", () => {
    const events = buildDeskCalendarEvents(snapshot);
    expect(events.map((event) => event.title)).toEqual(["小学期课程", "期末考试"]);
    expect(events[0].kind).toBe("course");
    expect(events[1].kind).toBe("exam");
  });

  it("falls back to courses and deadlines that are not already canonical", () => {
    const local = {
      ...snapshot,
      calendarEvents: undefined,
      courses: [
        {
          id: "course-1",
          title: "独立课程",
          instructor: "张教授",
          location: "东1A-301",
          startAt: "2026-08-15T01:00:00.000Z",
          endAt: "2026-08-15T02:00:00.000Z",
          sourceId: "academic-affairs" as const
        }
      ],
      deadlines: [
        {
          id: "deadline-1",
          title: "截止事项",
          dueAt: "2026-08-16T10:00:00.000Z",
          sourceId: "learning-platform" as const,
          kind: "assignment" as const,
          priority: "routine" as const
        }
      ]
    };
    const events = buildDeskCalendarEvents(local);
    expect(events.map((event) => event.title)).toEqual(["独立课程", "截止事项"]);
  });

  it("treats an event end time as exclusive at midnight", async () => {
    const midnightSnapshot = {
      ...snapshot,
      calendarEvents: [{
        ...snapshot.calendarEvents![0],
        startAt: "2026-08-15T15:00:00.000Z",
        endAt: "2026-08-15T16:00:00.000Z"
      }]
    };
    const api = createApi({
      loadSnapshot: vi.fn(async () => ({ ...message, snapshot: midnightSnapshot }))
    });

    render(createElement(DeskCalendarApp, { api }));
    await screen.findByText("小学期课程");
    fireEvent.click(screen.getByRole("button", { name: "查看 2026-08-16" }));
    expect(await screen.findByText("这一天没有安排")).toBeTruthy();
  });
});

describe("DeskCalendarApp", () => {
  it("loads the snapshot and renders the month grid with events", async () => {
    const api = createApi();
    render(createElement(DeskCalendarApp, { api }));
    expect(await screen.findByText("小学期课程")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "桌面日历" })).toBeTruthy();
    expect(api.loadSnapshot).toHaveBeenCalledTimes(1);
  });

  it("switches to the week view and calls setView", async () => {
    const api = createApi();
    render(createElement(DeskCalendarApp, { api }));
    await screen.findByText("小学期课程");
    fireEvent.click(screen.getByRole("button", { name: "周" }));
    expect(api.setView).toHaveBeenCalledWith("week");
    expect(screen.getByRole("button", { name: "周" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("opens an event detail without enabling edits inside the desktop window", async () => {
    const api = createApi();
    render(createElement(DeskCalendarApp, { api }));
    const events = await screen.findAllByRole("button", { name: "小学期课程" });
    fireEvent.click(events[0]);
    expect(screen.getByLabelText("安排详情")).toBeTruthy();
    expect(document.querySelector(".desk-cal-detail-complete")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "打开 CampusOS 日程" }));
    expect(api.openMain).toHaveBeenCalledWith(expect.stringMatching(/^calendar:/));
  });

  it("switches to the day view and lists the day's events", async () => {
    const api = createApi();
    render(createElement(DeskCalendarApp, { api }));
    await screen.findByText("小学期课程");
    fireEvent.click(screen.getByRole("button", { name: "日" }));
    expect(api.setView).toHaveBeenCalledWith("day");
    // Today (8/15) shows the course; navigate to 8/16 to see the exam.
    expect(await screen.findByText("小学期课程")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "下一个周期" }));
    expect(await screen.findByText("期末考试")).toBeTruthy();
  });

  it("opens a selected month cell in the day view", async () => {
    const api = createApi();
    render(createElement(DeskCalendarApp, { api }));
    await screen.findByText("小学期课程");

    fireEvent.click(screen.getByRole("button", { name: "查看 2026-08-16" }));

    expect(api.setView).toHaveBeenCalledWith("day");
    expect(await screen.findByText("期末考试")).toBeTruthy();
  });

  it("reports a persisted view failure and restores the previous view", async () => {
    const api = createApi({
      setView: vi.fn(async () => {
        throw new Error("保存失败");
      })
    });
    render(createElement(DeskCalendarApp, { api }));
    await screen.findByText("小学期课程");

    fireEvent.click(screen.getByRole("button", { name: "周" }));

    expect((await screen.findByRole("alert")).textContent).toContain("保存失败");
    expect(screen.getByRole("button", { name: "月" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("shows the runtime clock and persists its visibility toggle", async () => {
    const api = createApi();
    render(createElement(DeskCalendarApp, { api }));
    await screen.findByText("小学期课程");

    expect(document.querySelector(".desk-cal-clock")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "时钟" }));

    expect(api.setShowClock).toHaveBeenCalledWith(false);
    await vi.waitFor(() => expect(document.querySelector(".desk-cal-clock")).toBeNull());
  });
  it("projects local tasks and completes them through the desktop IPC", async () => {
    const api = createApi({
      loadSnapshot: vi.fn(async () => ({
        ...message,
        localTaskPeriods: [{
          id: "task-period-1", taskId: "task-1", title: "Local task", description: "", location: "",
          startAt: "2026-08-15T01:00:00.000Z", endAt: "2026-08-15T02:00:00.000Z",
          type: "deadline" as const, status: "running" as const, blocksPlanning: true
        }]
      }))
    });
    render(createElement(DeskCalendarApp, { api }));
    const task = await screen.findByText("Local task");
    fireEvent.click(task);
    const complete = document.querySelector(".desk-cal-detail-complete");
    expect(complete).toBeTruthy();
    fireEvent.click(complete as HTMLButtonElement);
    await vi.waitFor(() => expect(api.completeTask).toHaveBeenCalledWith("task-1"));
  });

  it("creates a dated task from the current desktop calendar date", async () => {
    const api = createApi();
    render(createElement(DeskCalendarApp, { api }));
    await screen.findByText("小学期课程");

    fireEvent.click(screen.getByRole("button", { name: "新建任务" }));
    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "Desktop created" } });
    fireEvent.click(screen.getByRole("button", { name: "保存任务" }));

    await vi.waitFor(() => expect(api.saveTask).toHaveBeenCalledWith(expect.objectContaining({
      title: "Desktop created",
      type: "fixed",
      repeatType: "norepeat"
    })));
  });

  it("opens the same task form for editing a projected local task", async () => {
    const taskRecord = {
      id: "task-1", status: "running" as const, description: "Initial", timeSpentMinutes: 0,
      timeNeededMinutes: 60, startAt: "2026-08-15T01:00:00.000Z", endAt: "2026-08-15T02:00:00.000Z",
      location: "Library", title: "Local task", breakable: true, type: "fixed" as const,
      repeatType: "norepeat" as const, repeatPeriod: 1, repeatEndsOn: "2026-08-15", blocksPlanning: true,
      fromId: null
    };
    const api = createApi({
      loadSnapshot: vi.fn(async () => ({
        ...message,
        localTaskPeriods: [{
          id: "task-period-1", taskId: "task-1", title: "Local task", description: "Initial", location: "Library",
          startAt: "2026-08-15T01:00:00.000Z", endAt: "2026-08-15T02:00:00.000Z",
          type: "fixed" as const, status: "running" as const, blocksPlanning: true
        }],
        localTasks: [taskRecord]
      }))
    });
    render(createElement(DeskCalendarApp, { api }));
    fireEvent.click(await screen.findByText("Local task"));
    fireEvent.click(screen.getByRole("button", { name: "编辑任务" }));
    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "Edited task" } });
    fireEvent.click(screen.getByRole("button", { name: "保存任务" }));

    await vi.waitFor(() => expect(api.saveTask).toHaveBeenCalledWith(expect.objectContaining({ id: "task-1", title: "Edited task" })));
  });

  it("closes through the api when the close button is pressed", async () => {
    const api = createApi();
    render(createElement(DeskCalendarApp, { api }));
    await screen.findByText("小学期课程");
    fireEvent.click(screen.getByRole("button", { name: "关闭桌面日历" }));
    expect(api.close).toHaveBeenCalledTimes(1);
  });

  it("applies a pushed snapshot message from the subscription", async () => {
    const listeners: Array<(value: DeskCalendarSnapshotMessage) => void> = [];
    const api = createApi({
      subscribe: vi.fn((listener) => {
        listeners.push(listener);
        return () => undefined;
      })
    });
    render(createElement(DeskCalendarApp, { api }));
    await screen.findByText("小学期课程");

    const updated: DeskCalendarSnapshotMessage = {
      ...message,
      snapshot: {
        ...snapshot,
        calendarEvents: [
          {
            ...snapshot.calendarEvents![0],
            title: "更新后的课程"
          }
        ]
      }
    };
    listeners.forEach((listener) => listener(updated));
    expect(await screen.findByText("更新后的课程")).toBeTruthy();
  });

  it("surfaces a load error instead of crashing", async () => {
    const api = createApi({
      loadSnapshot: vi.fn(async () => {
        throw new Error("读取失败");
      })
    });
    render(createElement(DeskCalendarApp, { api }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("读取失败")).toBeTruthy();
  });
});
