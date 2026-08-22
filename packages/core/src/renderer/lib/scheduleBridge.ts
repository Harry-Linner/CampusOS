import type {
  CalendarExportInput,
  CalendarExportResult,
  LocalTaskInput,
  LocalTaskMutation,
  LocalTaskPeriod,
  LocalTasksData
} from "@campusos/shared";
import type { ScheduleBridge } from "../../shared/scheduleBridge";

const requireScheduleBridge = (): ScheduleBridge => {
  if (typeof window === "undefined" || !window.campusos?.schedule) {
    throw new Error("CampusOS 日程服务不可用。");
  }
  return window.campusos.schedule;
};

export const loadLocalTasks = (): Promise<LocalTasksData> =>
  requireScheduleBridge().loadTasks();

export const loadLocalTaskPeriods = (input: { startAt: string; endAt: string }): Promise<LocalTaskPeriod[]> =>
  requireScheduleBridge().loadPeriods(input);

export const saveLocalTask = (input: LocalTaskInput): Promise<LocalTasksData> =>
  requireScheduleBridge().saveTask(input);

export const mutateLocalTask = (input: LocalTaskMutation): Promise<LocalTasksData> =>
  requireScheduleBridge().mutateTask(input);

export const exportScheduleIcal = (input: CalendarExportInput): Promise<CalendarExportResult> =>
  requireScheduleBridge().exportIcal(input);

export const subscribeToScheduleChanges = (listener: () => void): (() => void) =>
  requireScheduleBridge().subscribe(listener);
