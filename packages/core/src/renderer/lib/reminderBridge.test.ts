import { describe, expect, it } from "vitest";
import {
  loadReminderSchedulerState,
  loadReminderSettingsRecord,
  saveReminderSettingsRecord
} from "./reminderBridge";

describe("reminderBridge without Electron", () => {
  it("fails instead of persisting reminder settings in memory", async () => {
    await expect(loadReminderSettingsRecord()).rejects.toThrow("主进程连接不可用");
    await expect(saveReminderSettingsRecord({
      enabled: true,
      leadMinutes: [120, 15, 15, 60]
    })).rejects.toThrow("主进程连接不可用");
    await expect(loadReminderSchedulerState()).rejects.toThrow("主进程连接不可用");
  });
});
