import type {
  CalendarExportInput,
  CalendarExportResult,
  LocalTaskInput,
  LocalTaskMutation,
  LocalTaskPeriod,
  LocalTasksData,
  PlannerScheduleData,
  PlannerSettings
} from "@campusos/shared";

export interface ScheduleBridge {
  loadTasks: () => Promise<LocalTasksData>;
  loadPeriods: (input: { startAt: string; endAt: string }) => Promise<LocalTaskPeriod[]>;
  saveTask: (input: LocalTaskInput) => Promise<LocalTasksData>;
  mutateTask: (input: LocalTaskMutation) => Promise<LocalTasksData>;
  generatePlan: (settings: PlannerSettings) => Promise<PlannerScheduleData>;
  loadPlan: () => Promise<PlannerScheduleData | null>;
  exportIcal: (input: CalendarExportInput) => Promise<CalendarExportResult>;
  subscribe: (listener: () => void) => () => void;
}
