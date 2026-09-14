import { readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CampusWorkspaceSnapshot, LocalTaskInput, LocalTaskRecord, LocalTasksData } from "@campusos/shared";
import { createDatabaseService, type DatabaseService } from "./databaseService";

const electronState = vi.hoisted(() => ({
  documentsPath: "",
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  openPath: vi.fn(async () => "")
}));
const databaseState = vi.hoisted(() => ({ database: null as DatabaseService | null }));
const workspaceState = vi.hoisted(() => ({
  snapshot: null as CampusWorkspaceSnapshot | null
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => electronState.documentsPath)
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => [])
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      electronState.handlers.set(channel, handler);
    })
  },
  shell: {
    openPath: electronState.openPath
  }
}));

vi.mock("./officialDatabaseService", () => ({
  getOfficialDatabaseService: (): DatabaseService => {
    if (!databaseState.database) throw new Error("test database is not initialized");
    return databaseState.database;
  }
}));

vi.mock("./campusWorkspaceStore", () => ({
  hydrateCampusWorkspace: async () => {
    if (!workspaceState.snapshot) throw new Error("test workspace is not initialized");
    return { snapshot: workspaceState.snapshot };
  },
  rescheduleCampusWorkspaceReminders: vi.fn(async () => ({
    enabled: true,
    supported: true,
    scheduledCount: 0,
    nextFireAt: null,
    lastScheduledAt: fixedNow.toISOString(),
    transport: "electron"
  }))
}));

vi.mock("./reminderSettingsStore", () => ({
  readReminderSettingsRecord: vi.fn(async () => ({
    enabled: true,
    leadMinutes: [15],
    savedAt: null,
    storagePath: null
  }))
}));

import {
  registerScheduleHandlers,
  writeScheduleIcalFile
} from "./scheduleIpc";

const fixedNow = new Date("2026-08-04T10:00:00+08:00");

const snapshot: CampusWorkspaceSnapshot = {
  generatedAt: fixedNow.toISOString(),
  term: {
    label: "2026-2027 秋冬",
    phase: "upcoming",
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
  summary: {
    readySources: 0,
    totalSources: 0,
    downloadsInFlight: 0,
    materialsReady: 0,
    remindersQueued: 0,
    deadlinesDueSoon: 0
  }
};

const task: LocalTaskRecord = {
  id: "task-1",
  status: "running",
  description: "",
  timeSpentMinutes: 0,
  timeNeededMinutes: 60,
  startAt: "2026-08-04T08:00:00+08:00",
  endAt: "2026-08-04T18:00:00+08:00",
  location: "",
  title: "Read notes",
  breakable: true,
  type: "deadline",
  repeatType: "norepeat",
  repeatPeriod: 1,
  repeatEndsOn: "2026-08-04",
  blocksPlanning: true,
  fromId: null
};

const assistantTaskInput: LocalTaskInput = (() => {
  // Time-relative fixture so the task stays "running" regardless of run date.
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    title: "Review project brief",
    description: "Prepare the review notes",
    timeSpentMinutes: 0,
    timeNeededMinutes: 60,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    location: "",
    breakable: true,
    type: "deadline",
    repeatType: "norepeat",
    repeatPeriod: 1,
    repeatEndsOn: start.toISOString().slice(0, 10),
    blocksPlanning: true,
    courseName: "Sample Course",
    source: {
      kind: "ai-assistant",
      fingerprint: "assistant-fingerprint-1",
      provider: "deepseek",
      model: "deepseek-chat",
      importedAt: "2026-08-08T00:00:00.000Z"
    }
  };
})();

const trustedEvent = (): { senderFrame: { url: string }; sender: { mainFrame: unknown } } => {
  const frame = { url: "http://localhost:5173/" };
  return { senderFrame: frame, sender: { mainFrame: frame } };
};

const invoke = async <T>(channel: string, ...args: unknown[]): Promise<T> => {
  const handler = electronState.handlers.get(channel);
  if (!handler) throw new Error(`missing handler: ${channel}`);
  return await handler(trustedEvent(), ...args) as T;
};

const temporaryDirectories: string[] = [];

beforeEach(async () => {
  const root = await mkdtemp(join(process.env.TEMP ?? process.cwd(), "campusos-schedule-ipc-"));
  temporaryDirectories.push(root);
  electronState.documentsPath = root;
  process.env.ELECTRON_RENDERER_URL = "http://localhost:5173/";
  electronState.handlers.clear();
  electronState.openPath.mockReset();
  electronState.openPath.mockResolvedValue("");
  databaseState.database = createDatabaseService({ databasePath: join(root, "campusos.sqlite") });
  workspaceState.snapshot = snapshot;
  registerScheduleHandlers();
});

afterEach(async () => {
  databaseState.database?.close();
  databaseState.database = null;
  workspaceState.snapshot = null;
  delete process.env.ELECTRON_RENDERER_URL;
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("schedule IPC", () => {
  it("registers formal handlers and persists task reads through SQLite", async () => {
    expect([...electronState.handlers.keys()]).toEqual([
      "campusos:schedule:tasks:load",
      "campusos:schedule:periods:load",
      "campusos:schedule:task:save",
      "campusos:schedule:task:mutate",
      "campusos:schedule:personalizations:load",
      "campusos:schedule:personalization:save",
      "campusos:schedule:calendar-data:load",
      "campusos:schedule:ical:export"
    ]);

    const loaded = await invoke<{ tasks: LocalTaskRecord[]; updatedAt: string }>("campusos:schedule:tasks:load");
    expect(loaded.tasks).toEqual([]);
    expect(databaseState.database?.loadLocalTasks()?.tasks).toEqual([]);
  });

  it("rejects an untrusted renderer before touching the data service", async () => {
    const handler = electronState.handlers.get("campusos:schedule:tasks:load");
    const frame = { url: "https://evil.example/" };
    await expect(handler?.({ senderFrame: frame, sender: { mainFrame: frame } })).rejects.toThrow("untrusted origin");
  });

  it("writes a deterministic iCal file and propagates an association failure", async () => {
    const input = { academicYearStart: 2026, termLabel: "2026-2027 秋冬", includeTasks: true };
    const first = await writeScheduleIcalFile(snapshot, [task], input, fixedNow);
    const second = await writeScheduleIcalFile(snapshot, [task], input, fixedNow);
    expect(first.filePath).toBe(second.filePath);
    expect(first.eventCount).toBe(1);
    expect(await readFile(first.filePath, "utf8")).toContain("SUMMARY:Read notes");
    expect((await readdir(join(electronState.documentsPath, "CampusOS"))).filter((name) => name.endsWith(".ics"))).toHaveLength(1);
    expect(electronState.openPath).toHaveBeenCalledTimes(2);

    electronState.openPath.mockResolvedValueOnce("No application is associated with this file");
    await expect(writeScheduleIcalFile(snapshot, [task], input, fixedNow)).rejects.toThrow("系统日历文件无法打开");
  });

  it("runs export through the trusted IPC path", async () => {
    const result = await invoke<{ eventCount: number }>("campusos:schedule:ical:export", {
      academicYearStart: 2026,
      termLabel: "2026-2027 秋冬",
      includeTasks: false
    });
    expect(result.eventCount).toBe(0);
  });

  it("creates, deduplicates, updates, and cancels AI tasks through the authoritative IPC path", async () => {
    const created = await invoke<LocalTasksData>("campusos:schedule:task:save", assistantTaskInput);
    const taskId = created.operation?.taskId;
    expect(created.operation).toEqual({ kind: "created", taskId });
    expect(taskId).toBeTruthy();
    expect(created.tasks).toHaveLength(1);
    expect(created.tasks[0].source).toMatchObject({ fingerprint: "assistant-fingerprint-1", provider: "deepseek" });

    const duplicate = await invoke<LocalTasksData>("campusos:schedule:task:save", assistantTaskInput);
    expect(duplicate.operation).toEqual({ kind: "deduplicated", taskId });
    expect(duplicate.tasks).toHaveLength(1);

    const updated = await invoke<LocalTasksData>("campusos:schedule:task:save", { ...assistantTaskInput, id: taskId, title: "Review updated project brief" });
    expect(updated.operation).toEqual({ kind: "updated", taskId });
    expect(updated.tasks).toHaveLength(1);
    expect(updated.tasks[0].title).toBe("Review updated project brief");

    const cancelled = await invoke<LocalTasksData>("campusos:schedule:task:mutate", { id: taskId, status: "deleted" });
    expect(cancelled.tasks).toHaveLength(1);
    expect(cancelled.tasks[0]).toMatchObject({ status: "deleted", title: "Review updated project brief" });

    const restored = await invoke<LocalTasksData>("campusos:schedule:task:mutate", { id: cancelled.tasks[0].id, action: "restore" });
    expect(restored.tasks[0]).toMatchObject({ status: "running" });

    const removed = await invoke<LocalTasksData>("campusos:schedule:task:mutate", { id: restored.tasks[0].id, action: "purge" });
    expect(removed.tasks).toEqual([]);
  });

  it("persists one-occurrence and future-segment edits for a recurring event", async () => {
    const start = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const recurring: LocalTaskInput = {
      title: "Daily review",
      description: "",
      timeSpentMinutes: 0,
      timeNeededMinutes: 60,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      location: "Library",
      breakable: true,
      type: "fixed",
      repeatType: "days",
      repeatPeriod: 1,
      repeatEndsOn: start.toISOString().slice(0, 10),
      repeatEndMode: "never",
      repeatCount: null,
      repeatWeekdays: [],
      blocksPlanning: false,
      reminderMode: "custom",
      reminderAt: new Date(start.getTime() - 60 * 60 * 1000).toISOString()
    };
    const created = await invoke<LocalTasksData>("campusos:schedule:task:save", recurring);
    const taskId = created.tasks[0].id;

    const secondStart = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const secondEnd = new Date(end.getTime() + 24 * 60 * 60 * 1000);
    const single = await invoke<LocalTasksData>("campusos:schedule:task:save", {
      ...recurring,
      id: taskId,
      occurrenceKey: "1",
      editScope: "single",
      title: "Private second review",
      timeSpentMinutes: 20,
      reminderMode: "none",
      reminderAt: null,
      startAt: secondStart.toISOString(),
      endAt: secondEnd.toISOString()
    });
    expect(single.tasks[0].occurrenceOverrides?.["1"]).toMatchObject({
      title: "Private second review",
      timeSpentMinutes: 20,
      reminderMode: "none",
      reminderAt: null
    });

    // Move the edited occurrence forward: the old segment must still end before
    // occurrence #2's original slot, not before its newly edited date.
    const thirdStart = new Date(start.getTime() + 10 * 24 * 60 * 60 * 1000);
    const thirdEnd = new Date(end.getTime() + 10 * 24 * 60 * 60 * 1000);
    const future = await invoke<LocalTasksData>("campusos:schedule:task:save", {
      ...recurring,
      id: taskId,
      occurrenceKey: "2",
      editScope: "future",
      title: "Review from now on",
      startAt: thirdStart.toISOString(),
      endAt: thirdEnd.toISOString()
    });
    expect(future.tasks).toHaveLength(2);
    expect(new Set(future.tasks.map((item) => item.seriesGroupId))).toEqual(new Set([taskId]));
    const originalCutoffParts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(new Date(start.getTime() + 24 * 60 * 60 * 1000));
    const originalCutoff = Object.fromEntries(originalCutoffParts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    expect(future.tasks.find((item) => item.id === taskId)).toMatchObject({
      repeatEndMode: "date",
      repeatEndsOn: `${originalCutoff.year}-${originalCutoff.month}-${originalCutoff.day}`
    });
    expect(future.tasks.find((item) => item.id !== taskId)).toMatchObject({
      title: "Review from now on",
      repeatEndMode: "never",
      startAt: thirdStart.toISOString()
    });
  });

  it("stores upstream event notes and reminder overrides in SQLite", async () => {
    await invoke("campusos:schedule:personalization:save", "course:event-1", {
      note: "Bring printed notes",
      reminderLeadMinutes: 45
    });
    const loaded = await invoke<Record<string, { note: string; reminderLeadMinutes: number | null }>>(
      "campusos:schedule:personalizations:load"
    );
    expect(loaded["course:event-1"]).toMatchObject({ note: "Bring printed notes", reminderLeadMinutes: 45 });
  });
});
