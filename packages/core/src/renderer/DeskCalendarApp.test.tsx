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
  loadSnapshot: vi.fn(async () => message),
  setView: vi.fn(async () => undefined),
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
    expect(screen.getByText(/编辑、完成或删除请回到 CampusOS/)).toBeTruthy();
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
