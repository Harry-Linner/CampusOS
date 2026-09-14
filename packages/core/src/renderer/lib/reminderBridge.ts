import type {
  ReminderSchedulerState,
  ReminderSettingsInput,
  ReminderSettingsRecord
} from "../../shared/reminderBridge";
import type { CampusosBridge } from "../../shared/campusBridge";

const resolveCampusosBridge = (): CampusosBridge | null => {
  if (typeof window === "undefined") {
    return null;
  }

  return window.campusos ?? null;
};

const requireCampusosBridge = (): CampusosBridge => {
  const bridge = resolveCampusosBridge();

  if (!bridge) {
    throw new Error("CampusOS 主进程连接不可用，无法读取或保存提醒设置。");
  }

  return bridge;
};

export const loadReminderSettingsRecord =
  async (): Promise<ReminderSettingsRecord> => {
    return requireCampusosBridge().reminders.loadSettings();
  };

export const saveReminderSettingsRecord = async (
  input: ReminderSettingsInput
): Promise<ReminderSettingsRecord> => {
  return requireCampusosBridge().reminders.saveSettings(input);
};

export const loadReminderSchedulerState =
  async (): Promise<ReminderSchedulerState> => {
    return requireCampusosBridge().reminders.loadScheduleState();
  };
