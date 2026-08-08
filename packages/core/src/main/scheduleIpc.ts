import { app, BrowserWindow, ipcMain, shell } from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  CalendarExportInput,
  CalendarExportResult,
  LocalTaskInput,
  LocalTaskMutation,
  LocalTaskRecord,
  LocalTaskPeriod,
  LocalTasksData,
  PlannerScheduleData,
  PlannerSettings
} from "@campusos/shared";
import { assertTrustedRenderer } from "./ipcSecurity";
import { getOfficialDatabaseService } from "./officialDatabaseService";
import { hydrateCampusWorkspace } from "./campusWorkspaceStore";
import {
  applyTaskMutation,
  createIcalContent,
  createTaskRecord,
  generatePlannerSchedule,
  getTaskCalendarPeriods,
  normalizeTaskRecord,
  refreshLocalTasks
} from "./scheduleDomain";

export const SCHEDULE_CHANGED_CHANNEL = "campusos:schedule:changed";

const notifyScheduleChanged = (): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(SCHEDULE_CHANGED_CHANNEL);
  }
};

const nowIso = (): string => new Date().toISOString();

const readStoredTasks = (): LocalTaskRecord[] => {
  const stored = getOfficialDatabaseService().loadLocalTasks();
  if (!stored || !Array.isArray(stored.tasks)) return [];
  return (stored.tasks as LocalTaskRecord[]).map((task) => normalizeTaskRecord(task));
};

const persistTasks = (tasks: LocalTaskRecord[]): LocalTasksData => {
  const updatedAt = nowIso();
  getOfficialDatabaseService().saveLocalTasks(tasks, updatedAt);
  return { tasks, updatedAt };
};

const loadTasks = (): LocalTasksData => {
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

const loadPeriods = (input: { startAt: string; endAt: string }): LocalTaskPeriod[] => {
  const start = new Date(input.startAt);
  const end = new Date(input.endAt);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) {
    throw new Error("日程范围无效。");
  }
  // The recurrence and day-chopping rules are kept in scheduleDomain.ts,
  // directly ported from Celechron task.dart getPeriodOfDay/chopDatePeriod.
  return getTaskCalendarPeriods(loadTasks().tasks, start, end);
};

const saveTask = (input: LocalTaskInput): LocalTasksData => {
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
  const next = createTaskRecord(input);
  const existingIndex = input.id
    ? source.findIndex((task) => task.id === input.id)
    : -1;
  if (input.id && existingIndex < 0) {
    throw new Error("要编辑的任务不存在。");
  }
  if (existingIndex >= 0) {
    const existing = source[existingIndex];
    if (existing.type === "fixedlegacy") {
      throw new Error("历史日程只读，不能编辑。");
    }
    source.splice(existingIndex, 1, {
      ...next,
      status: existing.status,
      timeSpentMinutes: Math.min(existing.timeSpentMinutes, next.timeNeededMinutes)
    });
    source.splice(
      0,
      source.length,
      ...source.filter((task) => task.type !== "fixedlegacy" || task.fromId !== next.id)
    );
  } else {
    source.push(next);
  }
  const refreshed = refreshLocalTasks(source, new Date());
  const result = persistTasks(refreshed.tasks);
  result.operation = { kind: existingIndex >= 0 ? "updated" : "created", taskId: next.id };
  notifyScheduleChanged();
  return result;
};

const mutateTask = (input: LocalTaskMutation): LocalTasksData => {
  const refreshed = refreshLocalTasks(readStoredTasks(), new Date());
  const updated = applyTaskMutation(refreshed.tasks, input);
  const result = persistTasks(refreshLocalTasks(updated, new Date()).tasks);
  notifyScheduleChanged();
  return result;
};

const generatePlan = async (settings: PlannerSettings): Promise<PlannerScheduleData> => {
  const tasks = loadTasks().tasks;
  const workspace = await hydrateCampusWorkspace();
  const plan = generatePlannerSchedule(
    workspace.snapshot,
    tasks,
    settings,
    new Date()
  );
  getOfficialDatabaseService().savePlannerSchedule(plan, plan.generatedAt);
  notifyScheduleChanged();
  return plan;
};

const loadPlan = (): PlannerScheduleData | null => {
  const stored = getOfficialDatabaseService().loadPlannerSchedule();
  if (!stored || typeof stored.schedule !== "object" || stored.schedule === null) return null;
  return stored.schedule as PlannerScheduleData;
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
  const tasks = loadTasks().tasks;
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

export const registerScheduleHandlers = (): void => {
  ipcMain.handle("campusos:schedule:tasks:load", async (event) => {
    assertTrustedRenderer(event);
    return loadTasks();
  });
  ipcMain.handle("campusos:schedule:periods:load", async (event, input: { startAt: string; endAt: string }) => {
    assertTrustedRenderer(event);
    return loadPeriods(input);
  });
  ipcMain.handle("campusos:schedule:task:save", async (event, input: LocalTaskInput) => {
    assertTrustedRenderer(event);
    return saveTask(input);
  });
  ipcMain.handle("campusos:schedule:task:mutate", async (event, input: LocalTaskMutation) => {
    assertTrustedRenderer(event);
    return mutateTask(input);
  });
  ipcMain.handle("campusos:schedule:plan:generate", async (event, settings: PlannerSettings) => {
    assertTrustedRenderer(event);
    return generatePlan(settings);
  });
  ipcMain.handle("campusos:schedule:plan:load", async (event) => {
    assertTrustedRenderer(event);
    return loadPlan();
  });
  ipcMain.handle("campusos:schedule:ical:export", async (event, input: CalendarExportInput) => {
    assertTrustedRenderer(event);
    return exportIcal(input);
  });
};
