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
  loadSettings: vi.fn(async () => ({ enabled: true, view: "month" as const, showClock: true, widgets: [{ id: "clock" as const, enabled: true }, { id: "weather" as const, enabled: true }, { id: "countdown" as const, enabled: true }, { id: "progress" as const, enabled: true }], countdowns: [], progress: [], weather: null, appearance: { opacity: 0.88, background: "#111722", theme: "midnight" as const }, statutoryHolidays: [], makeupDays: [], displayProfiles: [], savedAt: now.toISOString(), storagePath: "C:/settings/desk-calendar.json" })),
  loadSnapshot: vi.fn(async () => message),
  completeTask: vi.fn(async () => undefined),
  saveTask: vi.fn(async () => undefined),
  saveSettings: vi.fn(async () => ({ enabled: true, view: "month" as const, showClock: true, widgets: [], countdowns: [], progress: [], weather: null, appearance: { opacity: 0.88, background: "#111722", theme: "midnight" as const }, statutoryHolidays: [], makeupDays: [], displayProfiles: [], savedAt: now.toISOString(), storagePath: "C:/settings/desk-calendar.json" })),
  refreshWeather: vi.fn(async () => ({ location: "Hangzhou", temperatureC: 20, weatherCode: 0, observedAt: now.toISOString(), cachedAt: now.toISOString(), error: null })),
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
    await screen.findAllByText("小学期课程");
    fireEvent.click(screen.getByRole("button", { name: "查看 2026-08-16" }));
    expect(await screen.findByText("这一天没有安排")).toBeTruthy();
  });
});

describe("DeskCalendarApp", () => {
  it("loads the snapshot and renders the month grid with events", async () => {
    const api = createApi();
    render(createElement(DeskCalendarApp, { api }));
    expect((await screen.findAllByText("小学期课程")).length).toBeGreaterThan(0);
    expect(screen.getByRole("dialog", { name: "桌面日历" })).toBeTruthy();
    expect(api.loadSnapshot).toHaveBeenCalledTimes(1);
  });

  it("switches to the week view and calls setView", async () => {
    const api = createApi();
    render(createElement(DeskCalendarApp, { api }));
    await screen.findAllByText("小学期课程");
    fireEvent.click(screen.getByRole("button", { name: "周" }));
    expect(api.setView).toHaveBeenCalledWith("week");
    expect(screen.getByRole("button", { name: "周" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("jumps to the main window when an event chip is clicked", async () => {
    const api = createApi();
    render(createElement(DeskCalendarApp, { api }));
    const events = await screen.findAllByRole("button", { name: "小学期课程" });
    fireEvent.click(events[0]);
    expect(api.openMain).toHaveBeenCalledWith("calendar:event-1");
  });

  it("opens an event detail on right-click without enabling edits inside the desktop window", async () => {
    const api = createApi();
    render(createElement(DeskCalendarApp, { api }));
    const events = await screen.findAllByRole("button", { name: "小学期课程" });
    fireEvent.contextMenu(events[0]);
    expect(screen.getByLabelText("安排详情")).toBeTruthy();
    expect(document.querySelector(".desk-cal-detail-complete")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "打开 CampusOS 日程" }));
    expect(api.openMain).toHaveBeenCalledWith(expect.stringMatching(/^calendar:/));
  });

  it("switches to the day view and lists the day's events", async () => {
    const api = createApi();
    render(createElement(DeskCalendarApp, { api }));
    await screen.findAllByText("小学期课程");
    fireEvent.click(screen.getByRole("button", { name: "日" }));
    expect(api.setView).toHaveBeenCalledWith("day");
    // Today (8/15) shows the course; navigate to 8/16 to see the exam.
    expect((await screen.findAllByText("小学期课程")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "下一个周期" }));
    expect(await screen.findByText("期末考试")).toBeTruthy();
  });

  it("selects a month cell and reflects it in the day agenda strip", async () => {
    const api = createApi();
    render(createElement(DeskCalendarApp, { api }));
    await screen.findAllByText("小学期课程");

    fireEvent.click(screen.getByRole("button", { name: "查看 2026-08-16" }));

    expect(api.setView).not.toHaveBeenCalledWith("day");
    expect(screen.getByLabelText("当日议程").textContent).toContain("期末考试");
  });

  it("reports a persisted view failure and restores the previous view", async () => {
    const api = createApi({
      setView: vi.fn(async () => {
        throw new Error("保存失败");
      })
    });
    render(createElement(DeskCalendarApp, { api }));
    await screen.findAllByText("小学期课程");

    fireEvent.click(screen.getByRole("button", { name: "周" }));

    expect((await screen.findByRole("alert")).textContent).toContain("保存失败");
    expect(screen.getByRole("button", { name: "月" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("shows the runtime clock and persists its visibility toggle", async () => {
    const api = createApi();
    render(createElement(DeskCalendarApp, { api }));
    await screen.findAllByText("小学期课程");

    expect(document.querySelector(".desk-cal-clock")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "时钟" }));

    expect(api.setShowClock).toHaveBeenCalledWith(false);
    await vi.waitFor(() => expect(document.querySelector(".desk-cal-clock")).toBeNull());
  });

  it("refreshes weather through the renderer bridge", async () => {
    const api = createApi();
    render(createElement(DeskCalendarApp, { api }));
    await screen.findAllByText("小学期课程");
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await vi.waitFor(() => expect(api.refreshWeather).toHaveBeenCalledOnce());
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
    const task = (await screen.findAllByText("Local task"))[0];
    fireEvent.contextMenu(task);
    const complete = document.querySelector(".desk-cal-detail-complete");
    expect(complete).toBeTruthy();
    fireEvent.click(complete as HTMLButtonElement);
    await vi.waitFor(() => expect(api.completeTask).toHaveBeenCalledWith("task-1"));
  });

  it("creates a dated task from the current desktop calendar date", async () => {
    const api = createApi();
    render(createElement(DeskCalendarApp, { api }));
    await screen.findAllByText("小学期课程");

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
    fireEvent.contextMenu((await screen.findAllByText("Local task"))[0]);
    fireEvent.click(screen.getByRole("button", { name: "编辑任务" }));
    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "Edited task" } });
    fireEvent.click(screen.getByRole("button", { name: "保存任务" }));

    await vi.waitFor(() => expect(api.saveTask).toHaveBeenCalledWith(expect.objectContaining({ id: "task-1", title: "Edited task" })));
  });

  it("opens an unprojected local task from the DeskTodo sidebar", async () => {
    const taskRecord = {
      id: "floating-task-1", status: "running" as const, description: "Inbox task", timeSpentMinutes: 0,
      timeNeededMinutes: 30, startAt: "2026-08-15T03:00:00.000Z", endAt: "2026-08-15T03:30:00.000Z",
      location: "", title: "Inbox task", breakable: true, type: "fixed" as const,
      repeatType: "norepeat" as const, repeatPeriod: 1, repeatEndsOn: "2026-08-15", blocksPlanning: false,
      fromId: null
    };
    const api = createApi({
      loadSnapshot: vi.fn(async () => ({ ...message, localTasks: [taskRecord] }))
    });
    render(createElement(DeskCalendarApp, { api }));
    const inboxTask = await screen.findByText("Inbox task");
    fireEvent.contextMenu(inboxTask);
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    fireEvent.contextMenu(document.querySelector(".desk-cal-cell.is-today") as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    fireEvent.click(screen.getByRole("button", { name: "新建待办" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    fireEvent.doubleClick(inboxTask);
    expect((await screen.findByLabelText("标题") as HTMLInputElement).value).toBe("Inbox task");
  });

  it("persists widget ordering, countdown, progress, and appearance changes", async () => {
    const api = createApi();
    const prompt = vi.spyOn(window, "prompt");
    prompt.mockReturnValueOnce("Exam").mockReturnValueOnce("2026-08-20T09:00");
    render(createElement(DeskCalendarApp, { api }));
    await screen.findAllByText("小学期课程");
    fireEvent.click(screen.getByRole("button", { name: "组件" }));
    fireEvent.click(screen.getByRole("button", { name: "添加倒计时" }));
    await vi.waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ countdowns: [expect.objectContaining({ title: "Exam" })] })));
    const opacity = screen.getByLabelText("透明度");
    fireEvent.change(opacity, { target: { value: "0.6" } });
    expect(api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ appearance: expect.objectContaining({ opacity: 0.6 }) }));
    prompt.mockRestore();
  });

  it("adds a bounded progress widget and toggles its registry state", async () => {
    const api = createApi();
    const prompt = vi.spyOn(window, "prompt");
    prompt.mockReturnValueOnce("Semester").mockReturnValueOnce("2026-08-01T00:00").mockReturnValueOnce("2026-09-01T00:00");
    render(createElement(DeskCalendarApp, { api }));
    await screen.findAllByText("小学期课程");
    fireEvent.click(screen.getByRole("button", { name: "组件" }));
    fireEvent.click(screen.getByRole("button", { name: "添加进度条" }));
    await vi.waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ progress: [expect.objectContaining({ title: "Semester" })] })));
    const weatherToggle = screen.getByRole("checkbox", { name: "天气" });
    fireEvent.click(weatherToggle);
    expect(api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ widgets: expect.arrayContaining([expect.objectContaining({ id: "weather", enabled: false })]) }));
    prompt.mockRestore();
  });

  it("persists a theme choice through the appearance settings", async () => {
    const api = createApi();
    render(createElement(DeskCalendarApp, { api }));
    await screen.findAllByText("小学期课程");
    fireEvent.click(screen.getByRole("button", { name: "组件" }));
    fireEvent.click(screen.getByRole("button", { name: "纸白" }));
    expect(api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      appearance: expect.objectContaining({ theme: "paper" })
    }));
  });

  it("switches the view with the wheel over the calendar area", async () => {
    const api = createApi();
    render(createElement(DeskCalendarApp, { api }));
    await screen.findAllByText("小学期课程");
    fireEvent.wheel(document.querySelector(".desk-cal-calendar") as HTMLElement, { deltaY: 150 });
    expect(api.setView).toHaveBeenCalledWith("week");
  });

  it("marks makeup days with the 补周X badge and holidays with striping", async () => {
    const api = createApi({
      loadSettings: vi.fn(async () => ({
        enabled: true, view: "month" as const, showClock: true,
        widgets: [], countdowns: [], progress: [], weather: null,
        appearance: { opacity: 0.88, background: "#111722", theme: "midnight" as const },
        statutoryHolidays: [{ date: "2026-08-15", label: "调休" }],
        makeupDays: [{ date: "2026-08-15", weekday: 5, source: "manual" as const }],
        displayProfiles: [], savedAt: now.toISOString(), storagePath: "C:/settings/desk-calendar.json"
      }))
    });
    render(createElement(DeskCalendarApp, { api }));
    await screen.findAllByText("小学期课程");
    expect(screen.getByText("补周五")).toBeTruthy();
    expect(document.querySelector(".desk-cal-cell.is-holiday")).toBeTruthy();
  });

  it("closes through the api when the close button is pressed", async () => {
    const api = createApi();
    render(createElement(DeskCalendarApp, { api }));
    await screen.findAllByText("小学期课程");
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
    await screen.findAllByText("小学期课程");

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
    expect((await screen.findAllByText("更新后的课程")).length).toBeGreaterThan(0);
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
