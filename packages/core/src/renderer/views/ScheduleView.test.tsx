/* @vitest-environment jsdom */

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    loadPeriods: vi.fn(async (): Promise<LocalTaskPeriod[]> =>
      tasks
        .filter((task) => task.type !== "floating" && task.type !== "fixedlegacy")
        .map((task) => ({
          id: `period-${task.id}`,
          taskId: task.id,
          title: task.title,
          description: task.description,
          location: task.location,
          startAt: task.startAt,
          endAt: task.endAt,
          type: task.type === "fixed" ? "fixed" : "deadline",
          status: task.status,
          blocksPlanning: task.blocksPlanning
        }))
    ),
    saveTask: vi.fn(async (input) => {
      tasks = [{ ...record, ...input, id: input.id ?? "task-new" }];
      return { tasks, updatedAt: new Date().toISOString() };
    }),
    mutateTask: vi.fn(async ({ id, status }) => {
      tasks = tasks.map((task) => task.id === id ? { ...task, status: status ?? task.status } : task);
      return { tasks, updatedAt: new Date().toISOString() };
    }),
    exportIcal: vi.fn(async () => ({ filePath: "calendar.ics", eventCount: 1, generatedAt: new Date().toISOString() })),
    subscribe: vi.fn(() => () => undefined)
  };
  return bridge;
};

describe("ScheduleView", () => {
  it("opens the exact event requested by desktop calendar navigation", async () => {
    render(createElement(ScheduleView, {
      loading: false,
      snapshot,
      capabilities: { read: vi.fn(async () => []) },
      onRefresh: vi.fn(async () => undefined),
      schedule: createSchedule(),
      navigationTarget: {
        requestId: "request-1",
        viewId: "schedule",
        entityId: "task:period-task-1"
      }
    }));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeTruthy();
    });
    expect(screen.getAllByText("Read notes").length).toBeGreaterThan(0);
    // Close the detail dialog so the (inert) calendar background becomes reachable.
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("button", { name: "日视图" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("loads formal task data, shows four views, and saves a new task through the bridge", async () => {
    const schedule = createSchedule();
    render(createElement(ScheduleView, {
      loading: false,
      snapshot,
      capabilities: { read: vi.fn(async () => []) },
      onRefresh: vi.fn(async () => undefined),
      schedule
    }));

    expect((await screen.findAllByText("Read notes")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "周视图" }));
    expect(screen.getByRole("button", { name: "周视图" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "月历" }));
    fireEvent.click(screen.getByRole("button", { name: "新建" }));
    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "New task" } });
    fireEvent.click(screen.getByRole("button", { name: "保存任务" }));

    await waitFor(() => expect(schedule.saveTask).toHaveBeenCalledWith(expect.objectContaining({ title: "New task" })));
  });

  it("opens the desk calendar from the schedule actions and persists the view choice", async () => {
    const schedule = createSchedule();
    const deskCalendar = {
      loadSettings: vi.fn(async () => ({
        enabled: false,
        view: "month" as const,
        showClock: true,
        widgets: [],
        countdowns: [],
        progress: [],
        weather: null,
        appearance: { opacity: 0.88, background: "#111722" },
        statutoryHolidays: [],
        displayProfiles: [],
        savedAt: "2026-08-15T00:00:00.000Z",
        storagePath: "C:/settings/desk-calendar.json"
      })),
      setEnabled: vi.fn(async (enabled: boolean) => ({
        enabled,
        view: "month" as const,
        showClock: true,
        widgets: [],
        countdowns: [],
        progress: [],
        weather: null,
        appearance: { opacity: 0.88, background: "#111722" },
        statutoryHolidays: [],
        displayProfiles: [],
        savedAt: "2026-08-15T00:00:00.000Z",
        storagePath: "C:/settings/desk-calendar.json"
      })),
      setView: vi.fn(async (view: "month" | "week" | "day") => ({
        enabled: true,
        view,
        showClock: true,
        widgets: [],
        countdowns: [],
        progress: [],
        weather: null,
        appearance: { opacity: 0.88, background: "#111722" },
        statutoryHolidays: [],
        displayProfiles: [],
        savedAt: "2026-08-15T00:00:00.000Z",
        storagePath: "C:/settings/desk-calendar.json"
      })),
      subscribe: vi.fn(() => () => undefined)
    };
    render(createElement(ScheduleView, {
      loading: false,
      snapshot,
      capabilities: { read: vi.fn(async () => []) },
      onRefresh: vi.fn(async () => undefined),
      schedule,
      deskCalendar
    }));

    await waitFor(() => expect(deskCalendar.loadSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "桌面日历" }));
    const menu = screen.getByRole("menu", { name: "桌面日历设置" });
    expect(menu).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "开启桌面日历" }));
    await waitFor(() => expect(deskCalendar.setEnabled).toHaveBeenCalledWith(true));

    // Wait until the enabled state propagates so view buttons become enabled.
    const menuViewButton = within(menu).getByRole("button", { name: "周视图" });
    await waitFor(() => {
      expect((menuViewButton as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(menuViewButton);
    await waitFor(() => expect(deskCalendar.setView).toHaveBeenCalledWith("week"));
    expect((within(menu).getByRole("button", { name: "周视图" })).getAttribute("aria-pressed")).toBe("true");
  });

  it("sends task status changes to the main-process bridge", async () => {
    const schedule = createSchedule();
    render(createElement(ScheduleView, {
      loading: false,
      snapshot,
      capabilities: { read: vi.fn(async () => []) },
      onRefresh: vi.fn(async () => undefined),
      schedule
    }));
    const taskButtons = await screen.findAllByRole("button", { name: "Read notes" });
    fireEvent.click(taskButtons[0]);
    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    await waitFor(() => expect(schedule.mutateTask).toHaveBeenCalledWith({ id: "task-1", status: "completed" }));
  });

  it("opens a local task detail before offering edit actions", async () => {
    render(createElement(ScheduleView, {
      loading: false,
      snapshot,
      capabilities: { read: vi.fn(async () => []) },
      onRefresh: vi.fn(async () => undefined),
      schedule: createSchedule()
    }));

    const taskButtons = await screen.findAllByRole("button", { name: "Read notes" });
    fireEvent.click(taskButtons[0]);
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(screen.getByRole("heading", { name: "编辑任务" })).toBeTruthy();
  });

  it("deletes a repeating fixed task from the calendar with series scope", async () => {
    const fixed: LocalTaskRecord = {
      ...record,
      id: "fixed-1",
      title: "Weekly review",
      type: "fixed",
      repeatType: "days",
      repeatPeriod: 7,
      repeatEndsOn: "2026-12-31"
    };
    const schedule = createSchedule([fixed]);
    render(createElement(ScheduleView, {
      loading: false,
      snapshot,
      capabilities: { read: vi.fn(async () => []) },
      onRefresh: vi.fn(async () => undefined),
      schedule
    }));

    expect((await screen.findAllByText("Weekly review")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Weekly review" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    fireEvent.click(screen.getByRole("button", { name: "整个系列" }));
    await waitFor(() => expect(schedule.mutateTask).toHaveBeenCalledWith({ id: "fixed-1", status: "deleted", scope: "series", includeCompleted: false }));
  });

  it("only exposes a repeat interval for Celechron's day-based recurrence", async () => {
    render(createElement(ScheduleView, {
      loading: false,
      snapshot,
      capabilities: { read: vi.fn(async () => []) },
      onRefresh: vi.fn(async () => undefined),
      schedule: createSchedule([])
    }));

    fireEvent.click(screen.getByRole("button", { name: "新建" }));
    fireEvent.change(screen.getAllByRole("combobox")[0], {
      target: { value: "fixed" }
    });
    fireEvent.change(screen.getByLabelText("重复"), {
      target: { value: "days" }
    });
    const form = document.body.querySelector(".schedule-task-form");
    expect(form?.querySelectorAll('input[type="number"]')).toHaveLength(3);

    fireEvent.change(screen.getByLabelText("重复"), {
      target: { value: "month" }
    });
    expect(form?.querySelectorAll('input[type="number"]')).toHaveLength(2);
  });

  it("keeps a monthly repeating task visible on the calendar with month recurrence", async () => {
    const monthly: LocalTaskRecord = {
      ...record,
      id: "monthly-1",
      title: "Monthly review",
      type: "fixed",
      repeatType: "month",
      repeatPeriod: 7,
      repeatEndsOn: "2026-12-31"
    };
    render(createElement(ScheduleView, {
      loading: false,
      snapshot,
      capabilities: { read: vi.fn(async () => []) },
      onRefresh: vi.fn(async () => undefined),
      schedule: createSchedule([monthly])
    }));

    await screen.findAllByText("Monthly review");
    fireEvent.click(screen.getAllByRole("button", { name: "Monthly review" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect((screen.getByLabelText("重复") as HTMLSelectElement).value).toBe("month");
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
      capabilities: { read: vi.fn(async () => []) },
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
      capabilities: { read: vi.fn(async () => []) },
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

  it("导出 Markdown 走正式保存桥接", async () => {
    const save = vi.fn(
      async (_input: { content?: string; suggestedName?: string; kind?: string }) =>
        ({ canceled: false, path: "C:/export.md" })
    );
    (window as unknown as { campusos?: unknown }).campusos = {
      exports: { save }
    };
    try {
      render(createElement(ScheduleView, {
        loading: false,
        snapshot,
        capabilities: { read: vi.fn(async () => []) },
        onRefresh: vi.fn(async () => undefined),
        schedule: createSchedule()
      }));
      await screen.findAllByText("Read notes");
      fireEvent.click(screen.getByRole("button", { name: "导出 MD" }));

      await waitFor(() => {
        expect(save).toHaveBeenCalledTimes(1);
      });
      const input = save.mock.calls[0]?.[0] as { content?: string };
      expect(input.content).toContain("# 日程导出");
      expect(input.content).toContain("Read notes");
    } finally {
      delete (window as unknown as { campusos?: unknown }).campusos;
    }
  });
});
