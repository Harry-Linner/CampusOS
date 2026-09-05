import { dialog, ipcMain } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import type { BackupPreview, BackupRestoreMode } from "../shared/backupBridge";
import type { NotificationRecord } from "../shared/notificationBridge";
import { assertTrustedRenderer } from "./ipcSecurity";
import { getOfficialDatabaseService } from "./officialDatabaseService";
import { addNotification, readNotificationRecords, restoreNotificationRecords } from "./notificationCenter";

interface BackupPayload { schemaVersion: 1; exportedAt: string; tasks: unknown; notifications: unknown[]; }
let selectedImportPath: string | null = null;

const readPayload = async (filePath: string): Promise<BackupPayload> => {
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as Partial<BackupPayload>;
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.notifications)) throw new Error("备份文件版本或结构无效。");
  return { schemaVersion: 1, exportedAt: typeof parsed.exportedAt === "string" ? parsed.exportedAt : new Date().toISOString(), tasks: parsed.tasks ?? { tasks: [] }, notifications: parsed.notifications };
};

const preview = (filePath: string, payload: BackupPayload): BackupPreview => ({ filePath, taskCount: payload.tasks && typeof payload.tasks === "object" && "tasks" in payload.tasks && Array.isArray((payload.tasks as { tasks: unknown[] }).tasks) ? (payload.tasks as { tasks: unknown[] }).tasks.length : 0, notificationCount: payload.notifications.length, containsCredentials: false });

export const registerBackupHandlers = (): void => {
  ipcMain.handle("campusos:backup:export", async (event) => {
    assertTrustedRenderer(event);
    const result = await dialog.showSaveDialog({ title: "导出 CampusOS 备份", defaultPath: "CampusOS-backup.json", filters: [{ name: "CampusOS 备份", extensions: ["json"] }] });
    if (result.canceled || !result.filePath) return null;
    const database = getOfficialDatabaseService();
    const payload: BackupPayload = { schemaVersion: 1, exportedAt: new Date().toISOString(), tasks: database.loadLocalTasks() ?? { tasks: [], savedAt: new Date(0).toISOString() }, notifications: await readNotificationRecords() };
    await writeFile(result.filePath, JSON.stringify(payload, null, 2), "utf8");
    return { filePath: result.filePath, taskCount: Array.isArray((payload.tasks as { tasks?: unknown[] }).tasks) ? ((payload.tasks as { tasks: unknown[] }).tasks).length : 0 };
  });
  ipcMain.handle("campusos:backup:preview", async (event) => {
    assertTrustedRenderer(event);
    const result = await dialog.showOpenDialog({ title: "选择 CampusOS 备份", properties: ["openFile"], filters: [{ name: "CampusOS 备份", extensions: ["json"] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    selectedImportPath = result.filePaths[0];
    return preview(selectedImportPath, await readPayload(selectedImportPath));
  });
  ipcMain.handle("campusos:backup:restore", async (event, mode: BackupRestoreMode) => {
    assertTrustedRenderer(event);
    if (mode !== "merge" && mode !== "replace") throw new Error("恢复模式无效。");
    if (!selectedImportPath) throw new Error("请先预览备份文件。");
    const payload = await readPayload(selectedImportPath);
    const database = getOfficialDatabaseService();
    const incomingTasks = Array.isArray((payload.tasks as { tasks?: unknown[] }).tasks) ? (payload.tasks as { tasks: unknown[] }).tasks : [];
    const currentTasks = (database.loadLocalTasks()?.tasks ?? []) as unknown[];
    const tasks = mode === "replace" ? incomingTasks : [...currentTasks, ...incomingTasks.filter((candidate: unknown) => !currentTasks.some((current: unknown) => typeof candidate === "object" && candidate !== null && typeof current === "object" && current !== null && "id" in candidate && "id" in current && candidate.id === current.id))];
    database.transaction(() => {
      database.saveLocalTasks(tasks, new Date().toISOString());
      restoreNotificationRecords(payload.notifications as NotificationRecord[], mode);
    });
    await addNotification({ kind: "system", title: "备份已恢复", body: mode === "replace" ? "本地任务已按备份替换。" : "本地任务已与备份合并。", showDesktop: false });
    return preview(selectedImportPath, payload);
  });
};
