import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalTaskInput, LocalTaskRecord } from "@campusos/shared";
import { createDatabaseService, type DatabaseService } from "./databaseService";
import {
  applyTaskMutation,
  createTaskRecord,
  getTaskCalendarPeriods,
  refreshLocalTasks
} from "./scheduleDomain";

const state = vi.hoisted(() => {
  let database: DatabaseService | null = null;
  return {
    get database(): DatabaseService | null { return database; },
    set database(value: DatabaseService | null) { database = value; },
    get tasks(): LocalTaskRecord[] {
      return (database?.loadLocalTasks()?.tasks ?? []) as LocalTaskRecord[];
    },
    set tasks(value: LocalTaskRecord[]) {
      if (!database) throw new Error("test database is not initialized");
      database.saveLocalTasks(value, "2030-01-01T00:00:00.000Z");
    }
  };
});

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => ".tmp/recurrence-regression") },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  ipcMain: { handle: vi.fn() },
  shell: { openPath: vi.fn(async () => "") }
}));

vi.mock("./officialDatabaseService", () => ({
  getOfficialDatabaseService: (): DatabaseService => {
    if (!state.database) throw new Error("test database is not initialized");
    return state.database;
  }
}));

vi.mock("./campusWorkspaceStore", () => ({
  hydrateCampusWorkspace: vi.fn(async () => ({ snapshot: {} })),
  rescheduleCampusWorkspaceReminders: vi.fn(async () => ({
    enabled: true,
    supported: true,
    scheduledCount: 0,
    nextFireAt: null,
    lastScheduledAt: null,
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

vi.mock("./deskCalendarStateStore", () => ({
  loadCalendarEventPersonalizations: vi.fn(() => ({})),
  saveCalendarEventPersonalization: vi.fn()
}));

vi.mock("./calendarDataService", () => ({
  loadUnifiedCalendarData: vi.fn(async () => ({}))
}));

import {
  loadSchedulePeriods,
  saveScheduleTask
} from "./scheduleIpc";

const rangeStart = new Date("2030-01-01T00:00:00+08:00");
const rangeEnd = new Date("2030-01-20T00:00:00+08:00");

const recurringInput = (overrides: Partial<LocalTaskInput> = {}): LocalTaskInput => ({
  title: "Daily series",
  description: "",
  timeSpentMinutes: 0,
  timeNeededMinutes: 60,
  startAt: "2030-01-01T09:00:00+08:00",
  endAt: "2030-01-01T10:00:00+08:00",
  location: "",
  breakable: true,
  type: "fixed",
  repeatType: "days",
  repeatPeriod: 1,
  repeatEndsOn: "2030-01-10",
  repeatEndMode: "date",
  repeatCount: null,
  repeatWeekdays: [],
  blocksPlanning: true,
  reminderMode: "none",
  reminderLeadMinutes: null,
  reminderAt: null,
  ...overrides
});

const periods = (tasks: LocalTaskRecord[] = state.tasks) =>
  getTaskCalendarPeriods(tasks, rangeStart, rangeEnd);

const resetState = (): void => {
  state.tasks = [];
};

beforeEach(() => {
  state.database = createDatabaseService({ databasePath: ":memory:" });
});

afterEach(() => {
  state.database?.close();
  state.database = null;
});

const seedSplitSeries = (): { root: LocalTaskRecord; first: LocalTaskRecord; later: LocalTaskRecord } => {
  const root = createTaskRecord(recurringInput({
    id: "series-root",
    repeatEndsOn: "2030-01-02"
  }));
  const first = createTaskRecord(recurringInput({
    id: "series-first",
    startAt: "2030-01-03T09:00:00+08:00",
    endAt: "2030-01-03T10:00:00+08:00",
    repeatEndsOn: "2030-01-04",
    repeatEndMode: "never",
    seriesGroupId: root.seriesGroupId
  }));
  const later = createTaskRecord(recurringInput({
    id: "series-later",
    startAt: "2030-01-05T09:00:00+08:00",
    endAt: "2030-01-05T10:00:00+08:00",
    repeatEndsOn: "2030-01-10",
    repeatEndMode: "never",
    seriesGroupId: root.seriesGroupId
  }));
  state.tasks = refreshLocalTasks([root, first, later], new Date("2030-01-01T00:00:00+08:00")).tasks;
  return {
    root: state.tasks.find((task) => task.id === root.id)!,
    first: state.tasks.find((task) => task.id === first.id)!,
    later: state.tasks.find((task) => task.id === later.id)!
  };
};

describe("schedule recurrence regressions", () => {
  it("keeps a completed one-off fixed task completed after refresh and projection", () => {
    const task = createTaskRecord(recurringInput({
      id: "one-off",
      repeatType: "norepeat",
      repeatEndsOn: "2030-01-01",
      repeatEndMode: "date",
      timeSpentMinutes: 60
    }));
    task.status = "completed";
    const refreshed = refreshLocalTasks([task], new Date("2030-01-02T00:00:00+08:00"));

    expect(refreshed.tasks[0].status).toBe("completed");
    expect(getTaskCalendarPeriods(refreshed.tasks, rangeStart, rangeEnd)[0].status).toBe("completed");
  });

  it("rejects a recurring end date before the series start", () => {
    expect(() => createTaskRecord(recurringInput({
      startAt: "2030-01-10T09:00:00+08:00",
      endAt: "2030-01-10T10:00:00+08:00",
      repeatEndsOn: "2030-01-01"
    }))).toThrow();
  });

  it("keeps earlier occurrences when a moved late occurrence is saved as the series", async () => {
    resetState();
    const created = await saveScheduleTask(recurringInput());
    const id = created.tasks[0].id;
    await saveScheduleTask(recurringInput({
      id,
      occurrenceKey: "4",
      editScope: "single",
      title: "Moved fifth",
      startAt: "2030-01-05T13:00:00+08:00",
      endAt: "2030-01-05T14:00:00+08:00"
    }));
    await saveScheduleTask(recurringInput({
      id,
      occurrenceKey: "4",
      editScope: "series",
      title: "Renamed series",
      startAt: "2030-01-05T13:00:00+08:00",
      endAt: "2030-01-05T14:00:00+08:00"
    }));

    expect(periods()).toEqual(expect.arrayContaining([
      expect.objectContaining({ occurrenceKey: "0", title: "Renamed series" }),
      expect.objectContaining({ occurrenceKey: "1", title: "Renamed series" }),
      expect.objectContaining({ occurrenceKey: "2", title: "Renamed series" }),
      expect.objectContaining({ occurrenceKey: "3", title: "Renamed series" })
    ]));
  });

  it("removes old later segments when future edit is repeated on a split series", async () => {
    resetState();
    const created = await saveScheduleTask(recurringInput({ repeatEndMode: "never" }));
    const rootId = created.tasks[0].id;
    await saveScheduleTask(recurringInput({
      id: rootId,
      occurrenceKey: "4",
      editScope: "future",
      title: "First future segment",
      startAt: "2030-01-05T12:00:00+08:00",
      endAt: "2030-01-05T13:00:00+08:00"
    }));
    const original = await loadSchedulePeriods({
      startAt: rangeStart.toISOString(),
      endAt: rangeEnd.toISOString()
    });
    const secondTarget = original.find((period) => period.occurrenceKey === "2");
    expect(secondTarget).toBeDefined();
    await saveScheduleTask(recurringInput({
      id: secondTarget!.taskId,
      occurrenceKey: secondTarget!.occurrenceKey,
      editScope: "future",
      title: "Second future segment",
      startAt: "2030-01-03T12:00:00+08:00",
      endAt: "2030-01-03T13:00:00+08:00"
    }));

    const visible = periods();
    const jan5 = visible.filter((item) => item.occurrenceStartAt.slice(0, 10) === "2030-01-05");
    expect(jan5).toHaveLength(1);
  });

  it("keeps occurrence ids stable as a series is split", async () => {
    resetState();
    const created = await saveScheduleTask(recurringInput());
    const id = created.tasks[0].id;
    const before = periods();
    await saveScheduleTask(recurringInput({
      id,
      occurrenceKey: "3",
      editScope: "future",
      startAt: "2030-01-04T12:00:00+08:00",
      endAt: "2030-01-04T13:00:00+08:00"
    }));
    const after = periods();

    expect(after.map((item) => item.occurrenceId)).toEqual(before.map((item) => item.occurrenceId));
    expect(after.every((item) => item.occurrenceId === `${item.seriesGroupId}:${item.occurrenceKey}`)).toBe(true);
  });

  it("future delete from the root also hides an already existing later segment", () => {
    const { root } = seedSplitSeries();
    const normalized = refreshLocalTasks(state.tasks, new Date("2030-01-01T00:00:00+08:00")).tasks;
    const updated = applyTaskMutation(normalized, {
      id: root.id,
      occurrenceKey: "1",
      scope: "future",
      status: "deleted"
    });

    expect(periods(updated)).toEqual([
      expect.objectContaining({ taskId: root.id, occurrenceKey: "0" })
    ]);
  });

  it("series delete without completed inclusion preserves completed history", () => {
    const root = createTaskRecord(recurringInput({ id: "completed-history" }));
    const completed = applyTaskMutation([root], {
      id: root.id,
      occurrenceKey: "1",
      status: "completed"
    });
    const deleted = applyTaskMutation(completed, {
      id: root.id,
      occurrenceKey: "3",
      scope: "series",
      status: "deleted",
      includeCompleted: false
    });

    expect(periods(deleted)).toEqual([
      expect.objectContaining({ occurrenceKey: "1", status: "completed" })
    ]);
  });

  it("removes a fully deleted series after thirty days while retaining protected completed history", () => {
    const root = createTaskRecord(recurringInput({ id: "retention" }));
    const completed = applyTaskMutation([root], { id: root.id, occurrenceKey: "1", status: "completed" });
    const fullyDeleted = applyTaskMutation(completed, { id: root.id, scope: "series", status: "deleted", includeCompleted: true });
    const protectedHistory = applyTaskMutation(completed, { id: root.id, scope: "series", status: "deleted", includeCompleted: false });
    const later = new Date(Date.now() + 31 * 86_400_000);
    expect(refreshLocalTasks(fullyDeleted, later).tasks).toEqual([]);
    expect(periods(refreshLocalTasks(protectedHistory, later).tasks)).toEqual([expect.objectContaining({ occurrenceKey: "1", status: "completed" })]);
  });

  it("restores every split segment and each original occurrence status", () => {
    const { root, first, later } = seedSplitSeries();
    const completed = applyTaskMutation(state.tasks, {
      id: root.id,
      occurrenceKey: "1",
      status: "completed"
    });
    const deleted = applyTaskMutation(completed, {
      id: root.id,
      occurrenceKey: "1",
      scope: "series",
      status: "deleted",
      includeCompleted: true
    });
    const restored = applyTaskMutation(deleted, {
      id: root.id,
      scope: "series",
      action: "restore"
    });

    expect(restored.filter((task) => task.seriesGroupId === root.seriesGroupId)).toHaveLength(3);
    expect(periods(restored)).toEqual(expect.arrayContaining([
      expect.objectContaining({ taskId: root.id, occurrenceKey: "1", status: "completed" }),
      expect.objectContaining({ taskId: first.id }),
      expect.objectContaining({ taskId: later.id })
    ]));
  });

  it("purge with completed protection keeps history and does not restore purged future instances", () => {
    const root = createTaskRecord(recurringInput({ id: "purge-history" }));
    const completed = applyTaskMutation([root], {
      id: root.id,
      occurrenceKey: "1",
      status: "completed"
    });
    const deleted = applyTaskMutation(completed, {
      id: root.id,
      occurrenceKey: "3",
      scope: "series",
      status: "deleted",
      includeCompleted: false
    });
    const purged = applyTaskMutation(deleted, {
      id: root.id,
      scope: "series",
      action: "purge",
      includeCompleted: false
    });
    const restored = applyTaskMutation(purged, {
      id: root.id,
      scope: "series",
      action: "restore"
    });

    expect(periods(purged)).toEqual([
      expect.objectContaining({ occurrenceKey: "1", status: "completed" })
    ]);
    expect(periods(restored)).toEqual([
      expect.objectContaining({ occurrenceKey: "1", status: "completed" })
    ]);
  });

  it("loads the same recurrence projection through the formal IPC period path", async () => {
    resetState();
    await saveScheduleTask(recurringInput());
    const loaded = await loadSchedulePeriods({
      startAt: rangeStart.toISOString(),
      endAt: rangeEnd.toISOString()
    });

    expect(loaded.map((item) => item.occurrenceKey)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
  });

  it("keeps a count-limited series at ten occurrences after a fourth-occurrence future edit", async () => {
    resetState();
    const created = await saveScheduleTask(recurringInput({
      repeatEndMode: "count",
      repeatCount: 10,
      repeatEndsOn: "2030-01-10"
    }));
    await saveScheduleTask(recurringInput({
      id: created.tasks[0].id,
      occurrenceKey: "4",
      editScope: "future",
      startAt: "2030-01-05T12:00:00+08:00",
      endAt: "2030-01-05T13:00:00+08:00"
    }));

    const loaded = await loadSchedulePeriods({
      startAt: rangeStart.toISOString(),
      endAt: new Date("2030-02-01T00:00:00+08:00").toISOString()
    });
    expect(loaded).toHaveLength(10);
    expect(new Set(loaded.map((item) => item.occurrenceKey))).toEqual(new Set(Array.from({ length: 10 }, (_, index) => String(index))));
  });

  it("moves the canonical series start by one hour when the fifth occurrence is moved by one hour", async () => {
    resetState();
    const created = await saveScheduleTask(recurringInput());
    await saveScheduleTask(recurringInput({
      id: created.tasks[0].id,
      occurrenceKey: "4",
      editScope: "series",
      startAt: "2030-01-05T10:00:00+08:00",
      endAt: "2030-01-05T11:00:00+08:00"
    }));

    const root = state.tasks.find((task) => task.id === created.tasks[0].id);
    expect(root?.startAt).toBe("2030-01-01T02:00:00.000Z");
    expect(root?.endAt).toBe("2030-01-01T03:00:00.000Z");
  });

  it("rejects an unknown single occurrence without changing the persisted task", async () => {
    resetState();
    const created = await saveScheduleTask(recurringInput());
    const before = state.tasks;

    await expect(saveScheduleTask(recurringInput({
      id: created.tasks[0].id,
      occurrenceKey: "999",
      editScope: "single",
      title: "Should not save"
    }))).rejects.toThrow("任务实例不存在");
    expect(state.tasks).toEqual(before);
  });
});
