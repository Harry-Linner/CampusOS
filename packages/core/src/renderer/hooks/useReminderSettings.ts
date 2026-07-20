import { useEffect, useMemo, useState } from "react";
import type {
  ReminderSchedulerState,
  ReminderSettingsInput,
  ReminderSettingsRecord
} from "../../shared/reminderBridge";
import {
  loadReminderSchedulerState,
  loadReminderSettingsRecord,
  saveReminderSettingsRecord
} from "../lib/reminderBridge";

interface ReminderSettingsState {
  loading: boolean;
  record: ReminderSettingsRecord | null;
  schedulerState: ReminderSchedulerState | null;
  error: string | null;
  load: () => Promise<void>;
  save: (input: ReminderSettingsInput) => Promise<void>;
}

export const useReminderSettings = (): ReminderSettingsState => {
  const [loading, setLoading] = useState(false);
  const [record, setRecord] = useState<ReminderSettingsRecord | null>(null);
  const [schedulerState, setSchedulerState] =
    useState<ReminderSchedulerState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);

      try {
        const [nextRecord, nextSchedulerState] = await Promise.all([
          loadReminderSettingsRecord(),
          loadReminderSchedulerState()
        ]);
        setRecord(nextRecord);
        setSchedulerState(nextSchedulerState);
        setError(null);
      } catch (nextError) {
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Failed to load reminder settings."
        );
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return useMemo(
    () => ({
      loading,
      record,
      schedulerState,
      error,
      load: async () => {
        setLoading(true);

        try {
          const [nextRecord, nextSchedulerState] = await Promise.all([
            loadReminderSettingsRecord(),
            loadReminderSchedulerState()
          ]);
          setRecord(nextRecord);
          setSchedulerState(nextSchedulerState);
          setError(null);
        } catch (nextError) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : "Failed to load reminder settings."
          );
        } finally {
          setLoading(false);
        }
      },
      save: async (input) => {
        setLoading(true);

        try {
          const nextRecord = await saveReminderSettingsRecord(input);
          const nextSchedulerState = await loadReminderSchedulerState();
          setRecord(nextRecord);
          setSchedulerState(nextSchedulerState);
          setError(null);
        } catch (nextError) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : "Failed to save reminder settings."
          );
        } finally {
          setLoading(false);
        }
      }
    }),
    [error, loading, record, schedulerState]
  );
};
