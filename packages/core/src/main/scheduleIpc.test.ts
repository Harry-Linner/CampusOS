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
  }
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

const assistantTaskInput: LocalTaskInput = {
  title: "Review project brief",
  description: "Prepare the review notes",
  timeSpentMinutes: 0,
  timeNeededMinutes: 60,
  startAt: "2026-08-20T08:00:00.000Z",
  endAt: "2026-08-20T09:00:00.000Z",
  location: "",
  breakable: true,
  type: "deadline",
  repeatType: "norepeat",
  repeatPeriod: 1,
  repeatEndsOn: "2026-08-20",
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
      "campusos:schedule:plan:generate",
      "campusos:schedule:plan:load",
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
});
