import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { CampusWorkspaceSnapshot, LocalTaskRecord } from "@campusos/shared";

const electronState = vi.hoisted(() => ({
  userData: "",
  loginEnabled: false,
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  webContentsSend: vi.fn()
}));
const workspaceState = vi.hoisted(() => ({
  snapshot: null as CampusWorkspaceSnapshot | null
}));
const tasksState = vi.hoisted(() => ({
  tasks: [] as LocalTaskRecord[]
}));
const calState = vi.hoisted(() => ({
  statutoryHolidays: [] as { date: string; label: string }[],
  makeupDays: [] as { date: string; label: string }[]
}));
const saveTask = vi.hoisted(() => vi.fn(async (input: unknown) => { void input; return { tasks: [] as LocalTaskRecord[], updatedAt: "2026-01-01T00:00:00.000Z" }; }));
const mutateTask = vi.hoisted(() => vi.fn(async (input: unknown) => { void input; return { tasks: [] as LocalTaskRecord[], updatedAt: "2026-01-01T00:00:00.000Z" }; }));
const pinWindow = vi.hoisted(() => vi.fn());

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn((name: string) => (name === "userData" ? electronState.userData : electronState.userData)),
    getLoginItemSettings: vi.fn(() => ({ openAtLogin: electronState.loginEnabled }))
  },
  BrowserWindow: vi.fn(),
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      electronState.handlers.set(channel, handler);
    })
  },
  nativeTheme: {
    shouldUseHighContrastColors: false,
    shouldUseDarkColors: false
  },
  screen: {
    getPrimaryDisplay: vi.fn(() => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }))
  }
}));

vi.mock("./campusWorkspaceStore", () => ({
  hydrateCampusWorkspace: async () => {
    if (!workspaceState.snapshot) throw new Error("test workspace not initialized");
    return { snapshot: workspaceState.snapshot };
  }
}));
vi.mock("./scheduleIpc", () => ({
  loadScheduleTasks: () => ({ tasks: tasksState.tasks, updatedAt: "2026-01-01T00:00:00.000Z" }),
  loadSchedulePeriods: (range: { startAt: string; endAt: string }) => tasksState.tasks.filter((task) =>
    Date.parse(task.endAt) > Date.parse(range.startAt) && Date.parse(task.startAt) < Date.parse(range.endAt)
  ).map((task) => ({
    id: `${task.id}:0-2026-09-03`, taskId: task.id, title: task.title,
    description: task.description, location: task.location, startAt: task.startAt,
    endAt: task.endAt, type: task.type, status: task.status,
    blocksPlanning: task.blocksPlanning, occurrenceId: `${task.id}:0`, occurrenceKey: "0",
    occurrenceIndex: 0, occurrenceStartAt: task.startAt, occurrenceEndAt: task.endAt,
    seriesGroupId: task.id
  })),
  saveScheduleTask: saveTask,
  mutateScheduleTask: mutateTask
}));
vi.mock("./academicCalendarStore", () => ({
  loadAcademicCalendarSettings: async () => ({
    statutoryHolidays: calState.statutoryHolidays,
    makeupDays: calState.makeupDays
  })
}));
vi.mock("./desktopPinning", () => ({
  pinWindowToDesktopBottom: pinWindow
}));

import { registerDeskCalendarHostHandlers, resolveDeskCalendarPlacement } from "./deskCalendarHost";
import { closeOfficialDatabaseService } from "./officialDatabaseService";
import { resetOfficialCapabilityRepository } from "./officialCapabilityRepository";
import { DESK_CALENDAR_STATE_KEYS, loadDesktopState, saveDesktopState } from "./deskCalendarStateStore";

const invoke = async <T>(channel: string, ...args: unknown[]): Promise<T> => {
  const handler = electronState.handlers.get(channel);
  if (!handler) throw new Error(`missing handler: ${channel}`);
  return await handler({}, ...args) as T;
};

const course = (id: string, startAt: string): CampusWorkspaceSnapshot["courses"][number] => ({
  id,
  title: `Course ${id}`,
  startAt,
  endAt: startAt,
  location: "A101",
  note: "note",
  sourceId: "learning-platform"
});

const deadline = (id: string, dueAt: string, kind: "exam" | "assignment"): CampusWorkspaceSnapshot["deadlines"][number] => ({
  id,
  title: `Deadline ${id}`,
  dueAt,
  kind,
  note: "d-note",
  sourceId: "learning-platform",
  priority: "routine"
});

const tmpDirs: string[] = [];
beforeEach(async () => {
  const dir = await mkdtemp(join(process.env.TEMP ?? process.cwd(), "campusos-desk-cal-"));
  tmpDirs.push(dir);
  electronState.userData = dir;
  electronState.loginEnabled = false;
  electronState.handlers.clear();
  electronState.webContentsSend.mockReset();
  saveTask.mockReset();
  mutateTask.mockReset();
  pinWindow.mockReset();
  tasksState.tasks = [];
  calState.statutoryHolidays = [];
  calState.makeupDays = [];
  workspaceState.snapshot = {
    generatedAt: "2026-09-01T00:00:00.000Z",
    term: { label: "2026-2027 秋冬", phase: "active", currentWeek: 1, progressPercent: 0 },
    sourceStates: [],
    courses: [course("c1", "2026-09-01T08:00:00+08:00")],
    todayCourses: [],
    deadlines: [
      deadline("d1", "2026-09-05T23:59:59+08:00", "assignment"),
      deadline("d2", "2026-09-08T09:00:00+08:00", "exam")
    ],
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
  registerDeskCalendarHostHandlers();
});

afterEach(async () => {
  vi.restoreAllMocks();
  resetOfficialCapabilityRepository();
  closeOfficialDatabaseService();
  await Promise.all(tmpDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("desk calendar host", () => {
  it("retires legacy topmost settings while preserving the other SQLite preferences", async () => {
    saveDesktopState(DESK_CALENDAR_STATE_KEYS.settings, { alwaysOnTop: true, opacity: 0.75, locked: true });
    const loaded = await invoke<Record<string, unknown>>("campusos:desk-calendar:settings:load");
    expect(loaded).not.toHaveProperty("alwaysOnTop");
    expect(loaded).toMatchObject({ opacity: 0.75, locked: true });
    expect(loadDesktopState(DESK_CALENDAR_STATE_KEYS.settings, {})).not.toHaveProperty("alwaysOnTop");
    const saved = await invoke<Record<string, unknown>>("campusos:desk-calendar:settings:save", { alwaysOnTop: true, showLunar: true });
    expect(saved).not.toHaveProperty("alwaysOnTop");
    expect(saved).toMatchObject({ opacity: 0.75, showLunar: true, locked: true });
  });

  it("builds data from workspace + schedule tasks + academic calendar", async () => {
    tasksState.tasks = [{
      id: "t1",
      title: "Todo item",
      status: "running",
      description: "",
      timeSpentMinutes: 0,
      timeNeededMinutes: 30,
      startAt: "2026-09-03T06:30:00.000Z", // 14:30 Shanghai
      endAt: "2026-09-03T07:30:00.000Z",
      location: "",
      type: "deadline",
      repeatType: "norepeat",
      repeatPeriod: 1,
      repeatEndsOn: "2026-09-03",
      blocksPlanning: false,
      breakable: true,
      fromId: null
    }];
    calState.statutoryHolidays = [{ date: "2026-10-01", label: "国庆节" }];
    calState.makeupDays = [{ date: "2026-10-10", label: "补班" }];

    const data = await invoke<{
      today: string;
      items: { id: string; kind: string; time?: string; status?: string }[];
      holidays: { date: string; holiday: boolean }[];
      theme: string;
      weeks: Record<string, number>;
      currentWeek: number | null;
    }>("campusos:desk-calendar:data");

    expect(data.theme).toBe("light");
    // 课程与截止
    expect(data.items.find((i) => i.id === "course:c1")).toMatchObject({ kind: "course", time: "08:00" });
    expect(data.items.find((i) => i.id === "deadline:d1")).toMatchObject({ kind: "assignment" });
    expect(data.items.find((i) => i.id === "deadline:d2")).toMatchObject({ kind: "exam", time: "09:00" });
    // 任务：上海时区时间，避免 UTC 8h 偏移
    expect(data.items.find((i) => i.id.startsWith("task:t1:"))).toMatchObject({ kind: "task", time: "14:30", status: "running" });
    // 节假日/补班
    expect(data.holidays).toContainEqual({ date: "2026-10-01", label: "国庆节", holiday: true });
    expect(data.holidays).toContainEqual({ date: "2026-10-10", label: "补班", holiday: false });
  });

  it("creates an event through the authoritative schedule save path", async () => {
    const result = await invoke<{ ok: boolean; error?: string }>("campusos:desk-calendar:create-event", {
      date: "2026-09-10",
      title: "New event",
      startAt: "2026-09-10T09:00",
      endAt: "2026-09-10T10:00",
      location: "Library",
      note: "remember",
      reminderLeadMinutes: 30
    });
    expect(result.ok).toBe(true);
    expect(saveTask).toHaveBeenCalledTimes(1);
    const input = saveTask.mock.calls[0][0] as Record<string, unknown>;
    expect(input.title).toBe("New event");
    expect(input.location).toBe("Library");
    expect(input.repeatEndsOn).toBe("2026-09-10");
    expect(input.reminderMode).toBe("lead");
    expect(input.reminderLeadMinutes).toBe(30);
  });

  it("keeps the first Shanghai morning inside a date-only range", async () => {
    tasksState.tasks = [{
      id: "early", title: "Early event", status: "running", description: "",
      timeSpentMinutes: 0, timeNeededMinutes: 30,
      startAt: "2026-09-03T00:30:00+08:00", endAt: "2026-09-03T01:00:00+08:00",
      location: "", type: "fixed", repeatType: "norepeat", repeatPeriod: 1,
      repeatEndsOn: "2026-09-03", blocksPlanning: true, breakable: false, fromId: null
    }];
    const data = await invoke<{ items: { id: string }[] }>("campusos:desk-calendar:data", {
      startAt: "2026-09-03", endAt: "2026-09-04"
    });
    expect(data.items.some((item) => item.id === "task:early:0")).toBe(true);
  });

  it("saves every editable local field without inferring type from recurrence", async () => {
    const result = await invoke<{ ok: boolean }>("campusos:desk-calendar:save-event", {
      date: "2026-09-10", title: "One-off fixed event", type: "fixed",
      startAt: "2026-09-10T09:00", endAt: "2026-09-10T10:00",
      repeatType: "norepeat", timeSpentMinutes: 15, timeNeededMinutes: 90,
      breakable: false, blocksPlanning: true, reminderMode: "custom",
      reminderAt: "2026-09-10T08:20"
    });
    expect(result.ok).toBe(true);
    expect(saveTask).toHaveBeenCalledWith(expect.objectContaining({
      type: "fixed", repeatType: "norepeat", timeSpentMinutes: 15,
      timeNeededMinutes: 90, breakable: false, blocksPlanning: true,
      reminderMode: "custom", reminderAt: "2026-09-10T08:20"
    }));
  });

  it("rejects an event with a missing title", async () => {
    const result = await invoke<{ ok: boolean; error?: string }>("campusos:desk-calendar:create-event", { date: "2026-09-10", title: "" });
    expect(result.ok).toBe(false);
    expect(saveTask).not.toHaveBeenCalled();
  });

  it("completes and restores a task through the schedule mutation path", async () => {
    const done = await invoke<{ ok: boolean; error?: string }>("campusos:desk-calendar:complete-task", "t1", true);
    expect(done.ok).toBe(true);
    expect(mutateTask).toHaveBeenCalledWith({ id: "t1", status: "completed" });

    const restored = await invoke<{ ok: boolean; error?: string }>("campusos:desk-calendar:complete-task", "t1", false);
    expect(restored.ok).toBe(true);
    expect(mutateTask).toHaveBeenLastCalledWith({ id: "t1", action: "restore" });
  });

  it("errors on a missing task id for completion", async () => {
    const result = await invoke<{ ok: boolean; error?: string }>("campusos:desk-calendar:complete-task", "", true);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("任务不存在。");
    expect(mutateTask).not.toHaveBeenCalled();
  });

  it("reports running status and refresh feed", async () => {
    expect(await invoke<{ running: boolean }>("campusos:desk-calendar:process:status")).toEqual({ running: false });
    expect(await invoke<{ ok: boolean }>("campusos:desk-calendar:feed:refresh")).toEqual({ ok: true });
  });

  it("loads default settings and persists a partial update", async () => {
    const loaded = await invoke<{ opacity: number; showWeeks: boolean }>("campusos:desk-calendar:settings:load");
    expect(loaded.opacity).toBe(0.98);
    const saved = await invoke<{ opacity: number; showWeeks: boolean; colors?: unknown }>("campusos:desk-calendar:settings:save", { opacity: 0.6, showWeeks: false });
    expect(saved.opacity).toBe(0.6);
    expect(saved.showWeeks).toBe(false);
    const reloaded = await invoke<{ opacity: number; showWeeks: boolean }>("campusos:desk-calendar:settings:load");
    expect(reloaded.opacity).toBe(0.6);
    expect(reloaded.showWeeks).toBe(false);
  });

  it("keeps desk-calendar auto-start subordinate to CampusOS auto-start", async () => {
    const blocked = await invoke<{ autoStart: boolean; campusAutoStartEnabled: boolean }>(
      "campusos:desk-calendar:settings:save",
      { autoStart: true }
    );
    expect(blocked).toMatchObject({ autoStart: false, campusAutoStartEnabled: false });

    electronState.loginEnabled = true;
    const enabled = await invoke<{ autoStart: boolean; campusAutoStartEnabled: boolean }>(
      "campusos:desk-calendar:settings:save",
      { autoStart: true }
    );
    expect(enabled).toMatchObject({ autoStart: true, campusAutoStartEnabled: true });

    electronState.loginEnabled = false;
    const disabledAgain = await invoke<{ autoStart: boolean; campusAutoStartEnabled: boolean }>(
      "campusos:desk-calendar:settings:load"
    );
    expect(disabledAgain).toMatchObject({ autoStart: false, campusAutoStartEnabled: false });
  });
});

describe("resolveDeskCalendarPlacement", () => {
  const primary = { x: 0, y: 0, width: 1920, height: 1080 };
  const oneDisplay = [{ workArea: primary }];

  it("keeps a saved position that is still on-screen", () => {
    const result = resolveDeskCalendarPlacement({ x: 200, y: 150, width: 940, height: 700 }, oneDisplay, primary);
    expect(result).toEqual({ width: 940, height: 700, x: 200, y: 150, useDefault: false });
  });

  it("falls back to default center when the saved position is off-screen (e.g. WorkerW-polluted)", () => {
    const result = resolveDeskCalendarPlacement({ x: -2, y: -7841, width: 1282, height: 756 }, oneDisplay, primary);
    expect(result.useDefault).toBe(true);
    expect(result).toMatchObject({ width: 940, height: 700 });
    expect(result.x).toBe(primary.x + Math.round((primary.width - 940) / 2));
    expect(result.y).toBe(primary.y + Math.round((primary.height - 700) / 2));
  });

  it("does not accept a geometry with only a thin sliver left on-screen", () => {
    const result = resolveDeskCalendarPlacement({ x: 225, y: -925, width: 1254, height: 934 }, oneDisplay, primary);
    expect(result).toMatchObject({ width: 940, height: 700, useDefault: true });
    expect(result.x).toBe(primary.x + Math.round((primary.width - 940) / 2));
    expect(result.y).toBe(primary.y + Math.round((primary.height - 700) / 2));
  });

  it("falls back to default when no saved geometry exists", () => {
    const result = resolveDeskCalendarPlacement(null, oneDisplay, primary);
    expect(result.useDefault).toBe(true);
    expect(result).toMatchObject({ width: 940, height: 700 });
  });

  it("keeps a saved position entirely on a secondary display (no straddle)", () => {
    const twoDisplays = [
      { workArea: primary },
      { workArea: { x: 1920, y: 0, width: 1920, height: 1080 } }
    ];
    const result = resolveDeskCalendarPlacement({ x: 2000, y: 100, width: 940, height: 700 }, twoDisplays, primary);
    expect(result).toMatchObject({ x: 2000, y: 100, useDefault: false });
  });
});
