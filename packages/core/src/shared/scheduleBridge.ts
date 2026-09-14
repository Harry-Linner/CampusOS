import type {
  CalendarExportInput,
  CalendarExportResult,
  CalendarEventPersonalization,
  LocalTaskInput,
  LocalTaskMutation,
  LocalTaskPeriod,
  LocalTasksData,
  UnifiedCalendarData
} from "@campusos/shared";

export interface ScheduleBridge {
  loadTasks: () => Promise<LocalTasksData>;
  loadPeriods: (input: { startAt: string; endAt: string }) => Promise<LocalTaskPeriod[]>;
  saveTask: (input: LocalTaskInput) => Promise<LocalTasksData>;
  mutateTask: (input: LocalTaskMutation) => Promise<LocalTasksData>;
  loadPersonalizations?: () => Promise<Record<string, CalendarEventPersonalization>>;
  savePersonalization?: (eventId: string, input: { note?: string; reminderLeadMinutes?: number | null }) => Promise<CalendarEventPersonalization>;
  loadCalendarData?: (input: { today: string; startAt: string; endAt: string }) => Promise<UnifiedCalendarData>;
  exportIcal: (input: CalendarExportInput) => Promise<CalendarExportResult>;
  subscribe: (listener: () => void) => () => void;
}
