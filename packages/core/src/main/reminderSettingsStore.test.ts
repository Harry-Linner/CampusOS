import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReminderSettingsRecord } from "../shared/reminderBridge";

const electronState = vi.hoisted(() => ({
  userDataPath: "",
  handlers: new Map<string, (...args: unknown[]) => unknown>()
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => electronState.userDataPath)
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      electronState.handlers.set(channel, handler);
    })
  }
}));

vi.mock("./reminderScheduler", () => ({
  getReminderSchedulerState: vi.fn(() => ({
    enabled: true,
    supported: true,
    scheduledCount: 0,
    nextFireAt: null,
    lastScheduledAt: null,
    transport: "electron"
  }))
}));

import { registerReminderSettingsHandlers } from "./reminderSettingsStore";

const temporaryDirectories: string[] = [];

beforeEach(() => {
  electronState.handlers.clear();
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("reminder settings IPC", () => {
  it("reschedules local workspace reminders immediately after persisting settings", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "campusos-reminders-"));
    temporaryDirectories.push(storageRoot);
    electronState.userDataPath = storageRoot;
    const onSettingsSaved = vi.fn(async () => undefined);
    registerReminderSettingsHandlers({ onSettingsSaved });
    const save = electronState.handlers.get("campusos:reminders:settings:save");
    if (!save) throw new Error("reminder settings save handler was not registered");

    const record = await save({}, {
      enabled: false,
      leadMinutes: [120, 15, 15]
    }) as ReminderSettingsRecord;

    expect(record).toMatchObject({ enabled: false, leadMinutes: [15, 120] });
    expect(onSettingsSaved).toHaveBeenCalledOnce();
    expect(onSettingsSaved).toHaveBeenCalledWith(record);
    await expect(readFile(record.storagePath!, "utf8")).resolves.toContain(
      '"enabled": false'
    );
  });
});
