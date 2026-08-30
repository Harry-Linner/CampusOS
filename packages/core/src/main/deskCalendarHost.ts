import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { app, ipcMain } from "electron";
import { hydrateCampusWorkspace } from "./campusWorkspaceStore";
import { loadScheduleTasks } from "./scheduleIpc";

interface CampusFeedEvent {
  id: string;
  title: string;
  date: string;
  kind: "course" | "exam" | "assignment" | "task";
  time?: string;
}

let deskCalendarProcess: ChildProcess | null = null;

const findDeskCalendarDir = (): string | null => {
  const candidates = [
    resolve(process.cwd(), "desktop-calendar"),
    resolve(app.getAppPath(), "desktop-calendar"),
    resolve(dirname(app.getAppPath()), "desktop-calendar")
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "deskcal", "main.py"))) return candidate;
  }
  return null;
};

const findPython = (): string | null => {
  // 开发期优先用 Fork 自带的 venv；否则回退系统 python。
  const dir = findDeskCalendarDir();
  if (dir && existsSync(join(dir, ".venv", "Scripts", "python.exe"))) {
    return join(dir, ".venv", "Scripts", "python.exe");
  }
  return "python";
};

const getFeedPath = (): string =>
  join(app.getPath("userData"), "desk-calendar-feed.json");

const dateOf = (iso: string): string => iso.slice(0, 10);
const timeOf = (iso: string): string | undefined => {
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[1]}:${m[2]}` : undefined;
};

const toIso = (value: unknown): string | null =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) ? value : null;

export const writeDeskCalendarFeed = async (): Promise<void> => {
  const record = await hydrateCampusWorkspace();
  const snapshot = record.snapshot;
  const events: CampusFeedEvent[] = [];

  for (const course of snapshot.courses ?? []) {
    const start = toIso(course.startAt);
    if (!start) continue;
    events.push({
      id: `course:${course.id}`,
      title: course.title,
      date: dateOf(start),
      kind: "course",
      time: timeOf(start) ?? undefined
    });
  }

  for (const deadline of snapshot.deadlines ?? []) {
    const due = toIso(deadline.dueAt);
    if (!due) continue;
    events.push({
      id: `deadline:${deadline.id}`,
      title: deadline.title,
      date: dateOf(due),
      kind: deadline.kind === "exam" ? "exam" : "assignment",
      time: timeOf(due) ?? undefined
    });
  }

  for (const task of loadScheduleTasks().tasks) {
    if (task.status === "deleted" || task.status === "completed") continue;
    const start = toIso(task.startAt);
    if (!start) continue;
    events.push({
      id: `task:${task.id}`,
      title: task.title,
      date: dateOf(start),
      kind: "task",
      time: timeOf(start) ?? undefined
    });
  }

  const path = getFeedPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ events }, null, 2), "utf8");
};

export const launchDeskCalendar = async (): Promise<void> => {
  if (deskCalendarProcess && deskCalendarProcess.exitCode === null) return;
  const dir = findDeskCalendarDir();
  if (!dir) throw new Error("未找到桌面日历（desktop-calendar/）。");
  await writeDeskCalendarFeed();
  const python = findPython();
  if (!python) throw new Error("未找到 Python 运行时。");
  deskCalendarProcess = spawn(python, ["-m", "deskcal.main"], {
    cwd: dir,
    env: { ...process.env, CAMPUSOS_USER_DATA: app.getPath("userData") },
    stdio: "ignore",
    windowsHide: true
  });
  deskCalendarProcess.on("exit", () => {
    deskCalendarProcess = null;
  });
};

export const closeDeskCalendar = (): void => {
  if (deskCalendarProcess) {
    deskCalendarProcess.kill();
    deskCalendarProcess = null;
  }
};

export const isDeskCalendarRunning = (): boolean =>
  deskCalendarProcess !== null && deskCalendarProcess.exitCode === null;

export const registerDeskCalendarHostHandlers = (): void => {
  ipcMain.handle("campusos:desk-calendar:process:start", async () => {
    await launchDeskCalendar();
    return { running: isDeskCalendarRunning() };
  });
  ipcMain.handle("campusos:desk-calendar:process:stop", async () => {
    closeDeskCalendar();
    return { running: false };
  });
  ipcMain.handle("campusos:desk-calendar:process:status", async () => ({
    running: isDeskCalendarRunning()
  }));
  ipcMain.handle("campusos:desk-calendar:feed:refresh", async () => {
    await writeDeskCalendarFeed();
    return { ok: true };
  });
};
