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
        .filter((task) => task.type !== "fixedlegacy")
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

  it("lists a course in the day view even when its start time is not a multiple of the step", async () => {
    // 回归：日视图时间槽曾要求事件开始分钟与槽位完全相等，真实教务时间
    // （如 09:05 开始、跨多节）会整段消失。事件应显示在与其时间范围重叠的槽位。
    // 用与组件相同的上海时区工具构造时间，避免测试机时区干扰。
    const shanghaiDate = (offsetMinutes: number): string => {
      const nowShanghai = new Date().getTime() + 8 * 60 * 60 * 1000;
      const today = new Date(nowShanghai);
      today.setUTCHours(0, 0, 0, 0);
      return new Date(today.getTime() - 8 * 60 * 60 * 1000 + offsetMinutes * 60 * 1000).toISOString();
    };
    const courseSnapshot: CampusWorkspaceSnapshot = {
      ...snapshot,
      courses: [{
        id: "course-905",
        title: "非整点课程",
        startAt: shanghaiDate(9 * 60 + 5),
        endAt: shanghaiDate(9 * 60 + 5 + 90),
        location: "教室 201",
        sourceId: "academic-affairs"
      }]
    };
    render(createElement(ScheduleView, {
      loading: false,
      snapshot: courseSnapshot,
      capabilities: { read: vi.fn(async () => []) },
      onRefresh: vi.fn(async () => undefined),
      schedule: createSchedule([])
    }));

    fireEvent.click(screen.getByRole("button", { name: "日视图" }));
    expect((await screen.findAllByText("非整点课程")).length).toBeGreaterThan(0);
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

  it("switches month display between bars and dots and between density tiers", async () => {
    const schedule = createSchedule();
    render(createElement(ScheduleView, {
      loading: false,
      snapshot,
      capabilities: { read: vi.fn(async () => []) },
      onRefresh: vi.fn(async () => undefined),
      schedule
    }));

    await waitFor(() => expect(screen.getByRole("button", { name: "月历" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "圆点" }));
    expect(document.querySelector(".schedule-month-grid.is-dot")).toBeTruthy();
    expect(screen.getByRole("button", { name: "圆点" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "紧凑" }));
    expect(document.querySelector(".schedule-month-grid.is-compact")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "色条" }));
    expect(document.querySelector(".schedule-month-grid.is-dot")).toBeNull();
    expect(globalThis.localStorage?.getItem("campusos.schedule.event-style")).toBe("bar");
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
    fireEvent.click(await screen.findByRole("button", { name: "完成" }));
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
    expect(await screen.findByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(screen.getByRole("heading", { name: "编辑任务" })).toBeTruthy();
  });

  it("treats a real double-click sequence as direct edit instead of opening details", async () => {
    render(createElement(ScheduleView, {
      loading: false,
      snapshot,
      capabilities: { read: vi.fn(async () => []) },
      onRefresh: vi.fn(async () => undefined),
      schedule: createSchedule()
    }));

    const task = (await screen.findAllByRole("button", { name: "Read notes" }))[0];
    fireEvent.click(task, { detail: 1 });
    fireEvent.click(task, { detail: 2 });
    fireEvent.doubleClick(task, { detail: 2 });

    expect(screen.getByRole("heading", { name: "编辑任务" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "编辑" })).toBeNull();
  });

  it("limits upstream event editing to personal notes and reminders", async () => {
    const schedule = createSchedule([]);
    schedule.loadPersonalizations = vi.fn(async () => ({}));
    schedule.savePersonalization = vi.fn(async (eventId, input) => ({
      eventId,
      note: input.note,
      reminderLeadMinutes: input.reminderLeadMinutes,
      updatedAt: now.toISOString()
    }));
    const upstreamSnapshot: CampusWorkspaceSnapshot = {
      ...snapshot,
      courses: [{
        id: "course-readonly",
        title: "Read-only course",
        sourceId: "academic-affairs",
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        location: "Room 2"
      }]
    };
    render(createElement(ScheduleView, {
      loading: false,
      snapshot: upstreamSnapshot,
      capabilities: { read: vi.fn(async () => []) },
      onRefresh: vi.fn(async () => undefined),
      schedule
    }));

    const course = (await screen.findAllByRole("button", { name: "Read-only course" }))[0];
    fireEvent.click(course, { detail: 1 });
    fireEvent.click(course, { detail: 2 });
    fireEvent.doubleClick(course, { detail: 2 });

    expect(screen.getByRole("heading", { name: "个性化“Read-only course”" })).toBeTruthy();
    expect(screen.queryByLabelText("标题")).toBeNull();
    fireEvent.change(screen.getByLabelText("个人备注"), { target: { value: "Bring notes" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(schedule.savePersonalization).toHaveBeenCalledWith(
      "course:course-readonly",
      { note: "Bring notes", reminderLeadMinutes: null }
    ));
  });

  it("edits the full occurrence when a multi-day event is opened from its later day", async () => {
    const todayKey = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"
    }).format(new Date());
    const midnight = new Date(`${todayKey}T00:00:00+08:00`);
    const fullStart = new Date(midnight.getTime() - 60 * 60 * 1000);
    const fullEnd = new Date(midnight.getTime() + 2 * 60 * 60 * 1000);
    const overnight: LocalTaskRecord = {
      ...record,
      id: "overnight",
      title: "Overnight task",
      type: "fixed",
      repeatType: "days",
      repeatEndMode: "never",
      occurrenceOverrides: {
        "0": {
          title: "Overnight override",
          description: "Instance note",
          location: "Instance room",
          timeSpentMinutes: 25,
          reminderMode: "none",
          reminderAt: null
        }
      },
      startAt: fullStart.toISOString(),
      endAt: fullEnd.toISOString()
    };
    const schedule = createSchedule([overnight]);
    schedule.loadPeriods = vi.fn(async () => ([
      {
        id: "overnight:0-day-1", taskId: "overnight", title: "Overnight override",
        description: "Instance note", location: "Instance room", startAt: fullStart.toISOString(), endAt: midnight.toISOString(),
        type: "fixed", status: "running", blocksPlanning: true,
        occurrenceId: "overnight:0", occurrenceKey: "0", occurrenceIndex: 0,
        occurrenceStartAt: fullStart.toISOString(), occurrenceEndAt: fullEnd.toISOString(), seriesGroupId: "overnight"
      },
      {
        id: "overnight:0-day-2", taskId: "overnight", title: "Overnight override",
        description: "Instance note", location: "Instance room", startAt: midnight.toISOString(), endAt: fullEnd.toISOString(),
        type: "fixed", status: "running", blocksPlanning: true,
        occurrenceId: "overnight:0", occurrenceKey: "0", occurrenceIndex: 0,
        occurrenceStartAt: fullStart.toISOString(), occurrenceEndAt: fullEnd.toISOString(), seriesGroupId: "overnight"
      }
    ] as LocalTaskPeriod[]));
    render(createElement(ScheduleView, {
      loading: false,
      snapshot,
      capabilities: { read: vi.fn(async () => []) },
      onRefresh: vi.fn(async () => undefined),
      schedule
    }));

    const laterDay = (await screen.findAllByRole("button", { name: "Overnight override" }))[1];
    fireEvent.click(laterDay, { detail: 1 });
    fireEvent.click(laterDay, { detail: 2 });
    fireEvent.doubleClick(laterDay, { detail: 2 });
    const editedStart = (screen.getByLabelText("开始") as HTMLInputElement).value;
    expect(new Date(`${editedStart}:00+08:00`).toISOString()).toBe(fullStart.toISOString());
    expect((screen.getByLabelText("标题") as HTMLInputElement).value).toBe("Overnight override");
    expect((screen.getByLabelText("说明") as HTMLTextAreaElement).value).toBe("Instance note");
    expect((screen.getByLabelText("地点") as HTMLInputElement).value).toBe("Instance room");
    expect((screen.getByLabelText("已用分钟") as HTMLInputElement).value).toBe("25");
    expect((screen.getByLabelText("单项提醒") as HTMLSelectElement).value).toBe("none");
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
    fireEvent.click(await screen.findByRole("button", { name: "删除" }));
    fireEvent.click(screen.getByRole("button", { name: "整个系列" }));
    await waitFor(() => expect(schedule.mutateTask).toHaveBeenCalledWith({ id: "fixed-1", status: "deleted", scope: "series", includeCompleted: false }));
  });

  it("exposes an interval for daily and monthly recurrence", async () => {
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
    expect(form?.querySelectorAll('input[type="number"]')).toHaveLength(3);
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
    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
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
      async (input: { content?: string; suggestedName?: string; kind?: string }) =>
        ({ canceled: false, path: input?.suggestedName ?? "C:/export.md" })
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

  it("shows the time granularity selector and mini calendar toggle", async () => {
    render(createElement(ScheduleView, {
      loading: false,
      snapshot,
      capabilities: { read: vi.fn(async () => []) },
      onRefresh: vi.fn(async () => undefined),
      schedule: createSchedule()
    }));

    const stepSelect = screen.getByLabelText("时间粒度") as HTMLSelectElement;
    expect(stepSelect.value).toBe("30");
    fireEvent.change(stepSelect, { target: { value: "15" } });
    expect((screen.getByLabelText("时间粒度") as HTMLSelectElement).value).toBe("15");

    fireEvent.click(screen.getByRole("button", { name: "迷你月历" }));
    const miniDialog = screen.getByRole("dialog", { name: "迷你月历" });
    fireEvent.click(within(miniDialog).getByRole("button", { name: "下个月" }));
    expect(within(miniDialog).getByText(/2026年/)).toBeTruthy();
  });

  it("filters events by kind via the type toggles", async () => {
    render(createElement(ScheduleView, {
      loading: false,
      snapshot,
      capabilities: { read: vi.fn(async () => []) },
      onRefresh: vi.fn(async () => undefined),
      schedule: createSchedule()
    }));
    await screen.findAllByText("Read notes");

    // 默认全部显示。
    expect(screen.getAllByText("Read notes").length).toBeGreaterThan(0);
    // 隐藏"任务"后，Read notes（task 事件）不再显示。
    fireEvent.click(screen.getByRole("button", { name: "任务" }));
    await waitFor(() => {
      expect(screen.queryByText("Read notes")).toBeNull();
    });
  });

  it("renders holiday and makeup marks from the academic calendar settings", async () => {
    const academicCalendar = {
      loadSettings: vi.fn(async () => ({
        statutoryHolidays: [{ date: "2026-10-01", label: "国庆节" }],
        makeupDays: [{ date: "2026-10-04", weekday: 1, source: "manual" as const }],
        savedAt: "2026-08-15T00:00:00.000Z",
        storagePath: "C:/settings/academic-calendar.json"
      })),
      saveSettings: vi.fn()
    };
    const snapshotWithOctober: CampusWorkspaceSnapshot = { ...snapshot, generatedAt: "2026-10-01T00:00:00.000Z" };
    render(createElement(ScheduleView, {
      loading: false,
      snapshot: snapshotWithOctober,
      capabilities: { read: vi.fn(async () => []) },
      onRefresh: vi.fn(async () => undefined),
      schedule: createSchedule(),
      academicCalendar
    }));

    await waitFor(() => expect(academicCalendar.loadSettings).toHaveBeenCalled());
    // 跳转到 2026-10 月视图。
    fireEvent.change(screen.getByLabelText("跳转到日期"), { target: { value: "2026-10-01" } });
    await waitFor(() => expect(screen.getByText("国庆节")).toBeTruthy());
    expect(screen.getByText("补周一")).toBeTruthy();
  });

});
