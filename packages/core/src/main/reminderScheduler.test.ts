import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CampusReminder, CampusWorkspaceSnapshot } from "@campusos/shared";

const notificationState = vi.hoisted(() => ({
  supported: true,
  options: [] as Array<{ title: string; body: string; silent: boolean }>,
  show: vi.fn()
}));

vi.mock("electron", () => ({
  Notification: class {
    static isSupported(): boolean {
      return notificationState.supported;
    }

    constructor(options: { title: string; body: string; silent: boolean }) {
      notificationState.options.push(options);
    }

    show(): void {
      notificationState.show();
    }
  }
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

describe("reminder scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    notificationState.supported = true;
    notificationState.options.length = 0;
    notificationState.show.mockClear();
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

  it("fires a valid future reminder through Electron and updates scheduler state", () => {
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

    vi.advanceTimersByTime(60_000);

    expect(notificationState.options).toEqual([{
      title: "课程作业 即将截止",
      body: "将在 15 分钟后截止",
      silent: false
    }]);
    expect(notificationState.show).toHaveBeenCalledOnce();
    expect(getReminderSchedulerState()).toMatchObject({
      scheduledCount: 0,
      nextFireAt: null
    });
  });

  it("uses the same mocked Electron boundary for a course reminder fixture", () => {
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

    vi.advanceTimersByTime(60_000);

    expect(notificationState.options).toEqual([{
      title: "数据结构",
      body: "课程将在 15 分钟后开始，地点：教室 A",
      silent: false
    }]);
    expect(notificationState.show).toHaveBeenCalledOnce();
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
    expect(notificationState.show).not.toHaveBeenCalled();
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
    expect(notificationState.show).not.toHaveBeenCalled();
  });
});
