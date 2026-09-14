/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { CampusosBridge } from "../../shared/campusBridge";
import type { ScheduleBridge } from "../../shared/scheduleBridge";
import {
  exportScheduleIcal,
  loadLocalTaskPeriods,
  loadLocalTasks,
  mutateLocalTask,
  saveLocalTask,
  subscribeToScheduleChanges
} from "./scheduleBridge";

const bridgeState = vi.hoisted(() => ({
  bridge: null as unknown as ScheduleBridge
}));

const installBridge = (bridge: ScheduleBridge): void => {
  bridgeState.bridge = bridge;
  (window as Window & { campusos?: CampusosBridge }).campusos = {
    shell: { platform: "win32", phase: "dev", storageMode: "sqlite" },
    workspace: {
      hydrate: vi.fn(),
      sync: vi.fn()
    },
    credentials: {
      academicAffairs: {} as CampusosBridge["credentials"]["academicAffairs"]
    },
    reminders: {} as CampusosBridge["reminders"],
    downloads: {} as CampusosBridge["downloads"],
    plugins: {} as CampusosBridge["plugins"],
    exports: { save: vi.fn(async () => ({ canceled: true, path: null })) },
    diagnostics: {} as CampusosBridge["diagnostics"],
    updates: {} as CampusosBridge["updates"],
    schedule: bridge
  };
};

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as Window & { campusos?: CampusosBridge }).campusos;
});

describe("scheduleBridge", () => {
  it("delegates task loading through the schedule bridge", async () => {
    const loadTasks = vi.fn(async () => ({ tasks: [], periods: [] }));
    installBridge({ loadTasks } as unknown as ScheduleBridge);
    await expect(loadLocalTasks()).resolves.toEqual({ tasks: [], periods: [] });
    expect(loadTasks).toHaveBeenCalledTimes(1);
  });

  it("delegates period loading with the input range", async () => {
    const loadPeriods = vi.fn(async () => []);
    installBridge({ loadPeriods } as unknown as ScheduleBridge);
    await expect(
      loadLocalTaskPeriods({ startAt: "2026-08-15T00:00:00.000Z", endAt: "2026-08-16T00:00:00.000Z" })
    ).resolves.toEqual([]);
    expect(loadPeriods).toHaveBeenCalledWith({
      startAt: "2026-08-15T00:00:00.000Z",
      endAt: "2026-08-16T00:00:00.000Z"
    });
  });

  it("delegates task saving and mutation", async () => {
    const saveTask = vi.fn(async (input: unknown) => ({ saved: input, tasks: [] }));
    const mutateTask = vi.fn(async () => ({ tasks: [] }));
    installBridge({ saveTask, mutateTask } as unknown as ScheduleBridge);
    await saveLocalTask({ title: "写报告", durationMinutes: 60 } as never);
    expect(saveTask).toHaveBeenCalledWith({ title: "写报告", durationMinutes: 60 });
    await mutateLocalTask({ id: "task-1", action: "complete" } as never);
    expect(mutateTask).toHaveBeenCalledWith({ id: "task-1", action: "complete" });
  });

  it("delegates iCal export and change subscription", async () => {
    const exportIcal = vi.fn(async () => ({ path: "C:/export.ics" }));
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(() => unsubscribe);
    installBridge({ exportIcal, subscribe } as unknown as ScheduleBridge);
    await expect(
      exportScheduleIcal({ includeExams: true, includeTasks: false } as never)
    ).resolves.toEqual({ path: "C:/export.ics" });
    const listener = vi.fn();
    const result = subscribeToScheduleChanges(listener);
    expect(subscribe).toHaveBeenCalledWith(listener);
    result();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("throws a user-facing error when the schedule bridge is unavailable", async () => {
    delete (window as Window & { campusos?: CampusosBridge }).campusos;
    expect(() => loadLocalTasks()).toThrow("CampusOS 日程服务不可用。");
    expect(() => saveLocalTask({} as never)).toThrow("CampusOS 日程服务不可用。");
    expect(() => exportScheduleIcal({} as never)).toThrow(
      "CampusOS 日程服务不可用。"
    );
    expect(() => subscribeToScheduleChanges(vi.fn())).toThrow(
      "CampusOS 日程服务不可用。"
    );
  });
});
