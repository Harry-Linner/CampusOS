import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CampusReminder, CampusWorkspaceSnapshot, LocalTaskRecord } from "@campusos/shared";

const notificationState = vi.hoisted(() => ({
  supported: true,
  add: vi.fn(async () => undefined)
}));

vi.mock("electron", () => ({
  Notification: {
    isSupported(): boolean {
      return notificationState.supported;
    }
  }
}));

vi.mock("./notificationCenter", () => ({
  addNotification: notificationState.add
}));

import {
  getReminderSchedulerState,
  scheduleWorkspaceReminders
} from "./reminderScheduler";

const now = new Date("2026-08-05T08:00:00.000Z");

const reminder = (overrides: Partial<CampusReminder> = {}): CampusReminder => ({
  id: "deadline-1-lead-15",
  title: "课程作业 即将截止",
  kind: "deadline",
  sourceId: "learning-platform",
  fireAt: new Date(now.getTime() + 60_000).toISOString(),
  eventStartAt: new Date(now.getTime() + 16 * 60_000).toISOString(),
  leadMinutes: 15,
  ...overrides
});

const snapshot = (reminders: CampusReminder[]): CampusWorkspaceSnapshot => ({
  generatedAt: now.toISOString(),
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
  reminders,
  summary: {
    readySources: 0,
    totalSources: 0,
    downloadsInFlight: 0,
    materialsReady: 0,
    remindersQueued: reminders.length,
    deadlinesDueSoon: 0
  }
});

const localTask = (overrides: Partial<LocalTaskRecord> = {}): LocalTaskRecord => ({
  id: "local-1",
  status: "running",
  description: "",
  timeSpentMinutes: 0,
  timeNeededMinutes: 30,
  startAt: new Date(now.getTime() + 31 * 60_000).toISOString(),
  endAt: new Date(now.getTime() + 61 * 60_000).toISOString(),
  location: "自习室",
  title: "本地任务",
  breakable: true,
  type: "deadline",
  repeatType: "norepeat",
  repeatPeriod: 1,
  repeatEndsOn: "2026-08-05",
  blocksPlanning: true,
  fromId: null,
  ...overrides
});

describe("reminder scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    notificationState.supported = true;
    notificationState.add.mockClear();
    scheduleWorkspaceReminders(snapshot([]), {
      enabled: false,
      leadMinutes: [15],
      savedAt: null,
      storagePath: null
    }, now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires a valid future reminder into the notification center and updates scheduler state", async () => {
    const state = scheduleWorkspaceReminders(snapshot([reminder()]), {
      enabled: true,
      leadMinutes: [15],
      savedAt: null,
      storagePath: null
    }, now);

    expect(state).toMatchObject({
      enabled: true,
      supported: true,
      scheduledCount: 1,
      nextFireAt: reminder().fireAt
    });

    await vi.advanceTimersByTimeAsync(60_000);

    expect(notificationState.add).toHaveBeenCalledWith(expect.objectContaining({
      id: "reminder:deadline-1-lead-15",
      kind: "assignment",
      title: "课程作业 即将截止",
      body: "将在 15 分钟后截止",
      source: "schedule",
      actionTarget: { viewId: "schedule" },
      showDesktop: true
    }));
    expect(getReminderSchedulerState()).toMatchObject({
      scheduledCount: 0,
      nextFireAt: null
    });
  });

  it("records a course reminder with its schedule source", async () => {
    const courseReminder = reminder({
      id: "course-1-lead-15",
      title: "数据结构",
      kind: "course",
      location: "教室 A"
    });

    scheduleWorkspaceReminders(snapshot([courseReminder]), {
      enabled: true,
      leadMinutes: [15],
      savedAt: null,
      storagePath: null
    }, now);

    await vi.advanceTimersByTimeAsync(60_000);

    expect(notificationState.add).toHaveBeenCalledWith(expect.objectContaining({
      kind: "course",
      title: "数据结构",
      body: "课程将在 15 分钟后开始，地点：教室 A",
      source: "schedule"
    }));
  });

  it("rejects an invalid fire time instead of scheduling an immediate notification", () => {
    const state = scheduleWorkspaceReminders(snapshot([
      reminder({ id: "invalid", fireAt: "not-a-date" })
    ]), {
      enabled: true,
      leadMinutes: [15],
      savedAt: null,
      storagePath: null
    }, now);

    expect(state.scheduledCount).toBe(0);
    vi.runAllTimers();
    expect(notificationState.add).not.toHaveBeenCalled();
  });

  it("cancels existing timers as soon as reminders are disabled", () => {
    scheduleWorkspaceReminders(snapshot([reminder()]), {
      enabled: true,
      leadMinutes: [15],
      savedAt: null,
      storagePath: null
    }, now);

    const state = scheduleWorkspaceReminders(snapshot([reminder()]), {
      enabled: false,
      leadMinutes: [15],
      savedAt: null,
      storagePath: null
    }, now);
    vi.runAllTimers();

    expect(state).toMatchObject({ enabled: false, scheduledCount: 0, nextFireAt: null });
    expect(notificationState.add).not.toHaveBeenCalled();
  });

  it("schedules a local task with its own lead time instead of the global value", async () => {
    const state = scheduleWorkspaceReminders(snapshot([]), {
      enabled: true,
      leadMinutes: [15],
      savedAt: null,
      storagePath: null
    }, now, [localTask({ reminderMode: "lead", reminderLeadMinutes: 60 })]);

    expect(state.scheduledCount).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(notificationState.add).toHaveBeenCalledWith(expect.objectContaining({
      title: "本地任务",
      body: "将在 60 分钟后开始",
      kind: "task"
    }));
  });

  it("catches up reminders fired within the last 24 hours and dedupes by occurrence id", async () => {
    const missed = reminder({ fireAt: new Date(now.getTime() - 60 * 60 * 1000).toISOString() });
    scheduleWorkspaceReminders(snapshot([missed]), {
      enabled: true,
      leadMinutes: [15],
      savedAt: null,
      storagePath: null
    }, now);
    await Promise.resolve();

    expect(notificationState.add).toHaveBeenCalledWith(expect.objectContaining({ id: `reminder:${missed.id}` }));

    notificationState.add.mockClear();
    scheduleWorkspaceReminders(snapshot([reminder({ fireAt: new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString() })]), {
      enabled: true,
      leadMinutes: [15],
      savedAt: null,
      storagePath: null
    }, now);
    await Promise.resolve();
    expect(notificationState.add).not.toHaveBeenCalled();
  });

  it("does not schedule a local task whose reminder is disabled", () => {
    const state = scheduleWorkspaceReminders(snapshot([]), {
      enabled: true,
      leadMinutes: [15],
      savedAt: null,
      storagePath: null
    }, now, [localTask({ reminderMode: "none" })]);

    expect(state.scheduledCount).toBe(0);
  });

});
