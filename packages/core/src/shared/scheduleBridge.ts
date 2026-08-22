import type {
  CalendarExportInput,
  CalendarExportResult,
  LocalTaskInput,
  LocalTaskMutation,
  LocalTaskPeriod,
  LocalTasksData
} from "@campusos/shared";

export interface ScheduleBridge {
  loadTasks: () => Promise<LocalTasksData>;
  loadPeriods: (input: { startAt: string; endAt: string }) => Promise<LocalTaskPeriod[]>;
  saveTask: (input: LocalTaskInput) => Promise<LocalTasksData>;
  mutateTask: (input: LocalTaskMutation) => Promise<LocalTasksData>;
  exportIcal: (input: CalendarExportInput) => Promise<CalendarExportResult>;
  subscribe: (listener: () => void) => () => void;
}
