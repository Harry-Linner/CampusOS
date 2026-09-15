import { app, BrowserWindow, shell } from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  CalendarExportInput,
  CalendarExportResult,
  LocalTaskInput,
  LocalTaskMutation,
  LocalTaskRecord,
  LocalTaskPeriod,
  LocalTasksData
} from "@campusos/shared";
import { registerTrustedIpcHandler } from "./trustedIpc";
import { getOfficialDatabaseService } from "./officialDatabaseService";
import {
  hydrateCampusWorkspace,
  rescheduleCampusWorkspaceReminders
} from "./campusWorkspaceStore";
import { readReminderSettingsRecord } from "./reminderSettingsStore";
import { loadCalendarEventPersonalizations, saveCalendarEventPersonalization } from "./deskCalendarStateStore";
import { openZhiyunClassroom, parseZhiyunClassroomOpenInput } from "./zhiyunClassroom";
import { loadUnifiedCalendarData } from "./calendarDataService";
import {
  applyTaskMutation,
  createIcalContent,
  createTaskRecord,
  getTaskCalendarPeriods,
  getTaskOccurrenceBounds,
  normalizeTaskSeries,
  refreshLocalTasks
} from "./scheduleDomain";

export const SCHEDULE_CHANGED_CHANNEL = "campusos:schedule:changed";
let afterScheduleChanged: (() => void | Promise<void>) | null = null;

const notifyScheduleChanged = (): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(SCHEDULE_CHANGED_CHANNEL);
  }
  if (afterScheduleChanged) void Promise.resolve(afterScheduleChanged()).catch(() => undefined);
};

const nowIso = (): string => new Date().toISOString();

const previousShanghaiDate = (iso: string): string => {
  const date = new Date(Date.parse(iso) - 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const record = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${record.year}-${record.month}-${record.day}`;
};

const readStoredTasks = (): LocalTaskRecord[] => {
  const stored = getOfficialDatabaseService().loadLocalTasks();
  if (!stored || !Array.isArray(stored.tasks)) return [];
  return normalizeTaskSeries(stored.tasks as LocalTaskRecord[]);
};

const persistTasks = (tasks: LocalTaskRecord[]): LocalTasksData => {
  const updatedAt = nowIso();
  getOfficialDatabaseService().saveLocalTasks(tasks, updatedAt);
  return { tasks, updatedAt };
};

export const loadScheduleTasks = (): LocalTasksData => {
  const stored = getOfficialDatabaseService().loadLocalTasks();
  const source = stored && Array.isArray(stored.tasks)
    ? (stored.tasks as LocalTaskRecord[])
    : [];
  const refreshed = refreshLocalTasks(source, new Date());
  if (refreshed.changed || !stored) {
    return persistTasks(refreshed.tasks);
  }
  return { tasks: refreshed.tasks, updatedAt: stored.savedAt };
};

export const loadSchedulePeriods = (input: { startAt: string; endAt: string }): LocalTaskPeriod[] => {
  const start = new Date(input.startAt);
  const end = new Date(input.endAt);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) {
    throw new Error("日程范围无效。");
  }
  // The recurrence and day-chopping rules are kept in scheduleDomain.ts,
  // directly ported from Celechron task.dart getPeriodOfDay/chopDatePeriod.
  return getTaskCalendarPeriods(loadScheduleTasks().tasks, start, end);
};

export const saveScheduleTask = async (input: LocalTaskInput): Promise<LocalTasksData> => {
  const source = readStoredTasks();
  if (!input.id && input.source?.kind === "ai-assistant") {
    const duplicate = source.find((task) => task.source?.kind === "ai-assistant" && task.source.fingerprint === input.source?.fingerprint);
    if (duplicate) {
      const stored = getOfficialDatabaseService().loadLocalTasks();
      return {
        tasks: source,
        updatedAt: stored?.savedAt ?? nowIso(),
        operation: { kind: "deduplicated", taskId: duplicate.id }
      };
    }
  }
  const existingIndex = input.id
    ? source.findIndex((task) => task.id === input.id)
    : -1;
  if (input.id && existingIndex < 0) {
    throw new Error("要编辑的任务不存在。");
  }
  // Single-instance commands cannot change the series rule; validate their own
  // time interval without rejecting a moved occurrence against the series cutoff.
  const next = createTaskRecord(input.editScope === "single" && existingIndex >= 0 ? { ...input, repeatType: "norepeat" } : input);
  let savedTaskId = next.id;
  if (existingIndex >= 0) {
    const existing = source[existingIndex];
    if (existing.type === "fixedlegacy") {
      throw new Error("历史日程只读，不能编辑。");
    }
    const scope = input.editScope ?? "series";
    const occurrenceKey = input.occurrenceKey;
    const recurringOccurrence = existing.type === "fixed" && existing.repeatType !== "norepeat" && occurrenceKey !== undefined;
    const originalOccurrence = recurringOccurrence ? getTaskOccurrenceBounds(existing, occurrenceKey) : null;
    if (recurringOccurrence && !originalOccurrence) throw new Error("任务实例不存在。");
    if (recurringOccurrence && scope === "single") {
      source.splice(existingIndex, 1, {
        ...existing,
        occurrenceOverrides: {
          ...(existing.occurrenceOverrides ?? {}),
          [occurrenceKey]: {
            ...(existing.occurrenceOverrides?.[occurrenceKey] ?? {}),
            title: next.title,
            description: next.description,
            startAt: next.startAt,
            endAt: next.endAt,
            location: next.location,
            timeSpentMinutes: next.timeSpentMinutes,
            reminderMode: next.reminderMode,
            reminderLeadMinutes: next.reminderLeadMinutes,
            reminderAt: next.reminderAt
          }
        }
      });
    } else if (existing.type === "fixed" && existing.repeatType !== "norepeat") {
      // A repeating series keeps a stable per-occurrence status and can be edited by
      // scope (single / future / series); occurrences are addressed by
      // `seriesOccurrenceOffset`, and a split re-roots the remaining occurrences.
      const groupId = existing.seriesGroupId ?? existing.id;
      const group = source.filter((task) => (task.seriesGroupId ?? task.id) === groupId)
        .sort((a, b) => (a.seriesOccurrenceOffset ?? 0) - (b.seriesOccurrenceOffset ?? 0));
      const root = group[0];
      const tail = group[group.length - 1];
      const isFuture = scope === "future" && originalOccurrence !== null;
      const boundary = isFuture ? Number(occurrenceKey) : 0;
      const prior = occurrenceKey === undefined ? undefined : existing.occurrenceOverrides?.[occurrenceKey];
      const displayedStart = prior?.startAt ?? originalOccurrence?.startAt ?? existing.startAt;
      const displayedEnd = prior?.endAt ?? originalOccurrence?.endAt ?? existing.endAt;
      const deltaStart = Date.parse(next.startAt) - Date.parse(displayedStart);
      const deltaEnd = Date.parse(next.endAt) - Date.parse(displayedEnd);
      const startAt = isFuture ? next.startAt : new Date(Date.parse(root.startAt) + deltaStart).toISOString();
      const endAt = isFuture ? next.endAt : new Date(Date.parse(root.endAt) + deltaEnd).toISOString();
      const unchangedEnd = input.repeatEndMode === existing.repeatEndMode && input.repeatEndsOn === existing.repeatEndsOn && (input.repeatCount ?? null) === (existing.repeatCount ?? null);
      const originalTotal = (tail.seriesOccurrenceOffset ?? 0) + (tail.repeatCount ?? 1);
      const segment = createTaskRecord({
        ...input, id: isFuture ? undefined : root.id, startAt, endAt,
        seriesGroupId: groupId,
        ...(unchangedEnd ? { repeatEndMode: tail.repeatEndMode, repeatEndsOn: tail.repeatEndsOn,
          repeatCount: tail.repeatEndMode === "count" ? Math.max(1, originalTotal - boundary) : null } : {}),
        reminderAt: next.reminderAt ? new Date(Date.parse(startAt) + Date.parse(next.reminderAt) - Date.parse(next.startAt)).toISOString() : null
      });
      segment.seriesOccurrenceOffset = boundary;
      segment.occurrenceOverrides = Object.fromEntries(group.flatMap((task) => Object.entries(task.occurrenceOverrides ?? {})).filter(([key]) => Number(key) >= boundary));
      for (const [key, override] of Object.entries(segment.occurrenceOverrides)) {
        const updated = { ...override };
        // A changed common field applies to the selected scope, while unrelated
        // instance exceptions and completion/deletion history remain intact.
        if (next.title !== (prior?.title ?? existing.title)) delete updated.title;
        if (next.description !== (prior?.description ?? existing.description)) delete updated.description;
        if (next.location !== (prior?.location ?? existing.location)) delete updated.location;
        if (deltaStart && updated.startAt) updated.startAt = new Date(Date.parse(updated.startAt) + deltaStart).toISOString();
        if (deltaEnd && updated.endAt) updated.endAt = new Date(Date.parse(updated.endAt) + deltaEnd).toISOString();
        if (deltaStart && updated.reminderAt) updated.reminderAt = new Date(Date.parse(updated.reminderAt) + deltaStart).toISOString();
        segment.occurrenceOverrides[key] = updated;
      }
      segment.occurrenceDeletions = group.flatMap((task) => task.occurrenceDeletions ?? []);
      savedTaskId = segment.id;
      const retained = source.filter((task) => (task.seriesGroupId ?? task.id) !== groupId || (isFuture && (task.seriesOccurrenceOffset ?? 0) < boundary));
      for (const task of retained) {
        if ((task.seriesGroupId ?? task.id) !== groupId || (task.seriesEndBefore ?? Infinity) <= boundary) continue;
        task.seriesEndBefore = boundary;
        if (originalOccurrence) {
          task.repeatEndMode = "date";
          task.repeatEndsOn = previousShanghaiDate(originalOccurrence.startAt);
        }
        task.occurrenceOverrides = Object.fromEntries(Object.entries(task.occurrenceOverrides ?? {}).filter(([key]) => Number(key) < boundary));
      }
      source.splice(0, source.length, ...retained, segment);
    } else {
      source.splice(existingIndex, 1, {
        ...next,
        seriesGroupId: existing.seriesGroupId ?? existing.id,
        occurrenceOverrides: existing.occurrenceOverrides ?? {},
        status: existing.status,
        timeSpentMinutes: Math.min(existing.timeSpentMinutes, next.timeNeededMinutes)
      });
      source.splice(
        0,
        source.length,
        ...source.filter((task) => task.type !== "fixedlegacy" || task.fromId !== next.id)
      );
    }
  } else {
    source.push(next);
  }
  const refreshed = refreshLocalTasks(source, new Date());
  const result = persistTasks(refreshed.tasks);
  result.operation = { kind: existingIndex >= 0 ? "updated" : "created", taskId: savedTaskId };
  notifyScheduleChanged();
  await rescheduleCampusWorkspaceReminders(await readReminderSettingsRecord());
  return result;
};

export const mutateScheduleTask = async (input: LocalTaskMutation): Promise<LocalTasksData> => {
  const refreshed = refreshLocalTasks(readStoredTasks(), new Date());
  const updated = applyTaskMutation(refreshed.tasks, input);
  const result = persistTasks(refreshLocalTasks(updated, new Date()).tasks);
  notifyScheduleChanged();
  await rescheduleCampusWorkspaceReminders(await readReminderSettingsRecord());
  return result;
};

const sanitizeFilePart = (value: string): string => {
  const normalized = value.trim().replace(/[^\p{L}\p{N}_-]+/gu, "-");
  return normalized.replace(/^-+|-+$/g, "").slice(0, 80) || "calendar";
};

export const writeScheduleIcalFile = async (
  snapshot: Awaited<ReturnType<typeof hydrateCampusWorkspace>>["snapshot"],
  tasks: LocalTaskRecord[],
  input: CalendarExportInput,
  now = new Date()
): Promise<CalendarExportResult> => {
  const { content, eventCount } = createIcalContent(snapshot, tasks, input, now);
  const directory = join(app.getPath("documents"), "CampusOS");
  await mkdir(directory, { recursive: true });
  const filePath = join(directory, `schedule-${sanitizeFilePart(input.termLabel)}.ics`);
  await writeFile(filePath, content, "utf8");
  const openError = await shell.openPath(filePath);
  if (openError) throw new Error(`系统日历文件无法打开：${openError}`);
  return { filePath, eventCount, generatedAt: now.toISOString() };
};

const exportIcal = async (input: CalendarExportInput): Promise<CalendarExportResult> => {
  if (!input || typeof input.termLabel !== "string") {
    throw new Error("日历导出参数无效。");
  }
  const tasks = loadScheduleTasks().tasks;
  const workspace = await hydrateCampusWorkspace();
  const result = await writeScheduleIcalFile(
    workspace.snapshot,
    tasks,
    input,
    new Date()
  );
  notifyScheduleChanged();
  return result;
};

export const registerScheduleHandlers = (options?: { onChanged?: () => void | Promise<void> }): void => {
  afterScheduleChanged = options?.onChanged ?? null;
  registerTrustedIpcHandler("campusos:schedule:tasks:load", async () => {
    return loadScheduleTasks();
  });
  registerTrustedIpcHandler("campusos:schedule:periods:load", async (input: { startAt: string; endAt: string }) => {
    return loadSchedulePeriods(input);
  });
  registerTrustedIpcHandler("campusos:schedule:task:save", async (input: LocalTaskInput) => {
    return saveScheduleTask(input);
  });
  registerTrustedIpcHandler("campusos:schedule:task:mutate", async (input: LocalTaskMutation) => {
    return mutateScheduleTask(input);
  });
  registerTrustedIpcHandler("campusos:schedule:personalizations:load", async () => {
    return loadCalendarEventPersonalizations();
  });
  registerTrustedIpcHandler("campusos:schedule:personalization:save", async (eventId: string, input: { note?: string; reminderLeadMinutes?: number | null; zhiyunUrl?: string | null; completed?: boolean; completedAt?: string | null }) => {
    const result = saveCalendarEventPersonalization(eventId, input ?? {});
    notifyScheduleChanged();
    await rescheduleCampusWorkspaceReminders(await readReminderSettingsRecord());
    return result;
  });
  registerTrustedIpcHandler("campusos:schedule:zhiyun:open", async (input: unknown) => {
    const parsed = parseZhiyunClassroomOpenInput(input);
    if (!parsed) throw new Error("智云课堂请求无效。");
    return openZhiyunClassroom(parsed);
  });
  registerTrustedIpcHandler("campusos:schedule:calendar-data:load", async (input: { today: string; startAt: string; endAt: string }) => {
    if (!input || typeof input.today !== "string") throw new Error("日历范围无效。");
    return loadUnifiedCalendarData(input.today, input);
  });
  registerTrustedIpcHandler("campusos:schedule:ical:export", async (input: CalendarExportInput) => {
    return exportIcal(input);
  });
};
