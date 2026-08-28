import { app, BrowserWindow, ipcMain, Notification } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { NotificationRecord, NotificationKind } from "../shared/notificationBridge";
import { assertTrustedRenderer } from "./ipcSecurity";
import { getAppLifecycleSettings } from "./appLifecycle";

const FILE = "notifications.json";
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
let records: NotificationRecord[] | null = null;
export const NOTIFICATIONS_CHANGED_CHANNEL = "campusos:notifications:changed";

const filePath = (): string => join(app.getPath("userData"), "notifications", FILE);
const isMissing = (error: unknown): boolean => typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";

const load = async (): Promise<NotificationRecord[]> => {
  if (records) return records.slice();
  try {
    const parsed = JSON.parse(await readFile(filePath(), "utf8")) as unknown;
    records = Array.isArray(parsed) ? parsed.filter((entry): entry is NotificationRecord => typeof entry === "object" && entry !== null && typeof (entry as NotificationRecord).id === "string") : [];
  } catch (error) {
    if (!isMissing(error)) records = [];
    else records = [];
  }
  return prune(records);
};

const prune = (source: NotificationRecord[] | null): NotificationRecord[] => {
  const cutoff = Date.now() - RETENTION_MS;
  records = (source ?? []).filter((entry) => Date.parse(entry.createdAt) >= cutoff && entry.state !== "expired");
  return records.slice();
};

const persist = async (): Promise<NotificationRecord[]> => {
  await mkdir(join(app.getPath("userData"), "notifications"), { recursive: true });
  await writeFile(filePath(), JSON.stringify(records ?? [], null, 2), "utf8");
  broadcast();
  return (records ?? []).slice();
};

const broadcast = (): void => {
  for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(NOTIFICATIONS_CHANGED_CHANNEL);
};

export const readNotificationRecords = (): Promise<NotificationRecord[]> => load();

/** Marks every unread notification carrying the given actionTarget as read (used to keep
 *  a source-of-truth module's unread state in sync with the notification bell). */
export const markNotificationsReadByTarget = async (actionTarget: string): Promise<void> => {
  await load();
  records = (records ?? []).map((entry) =>
    entry.actionTarget === actionTarget && entry.state === "unread"
      ? { ...entry, state: "read" }
      : entry
  );
  await persist();
};

export const restoreNotificationRecords = async (incoming: NotificationRecord[], mode: "merge" | "replace"): Promise<NotificationRecord[]> => {
  await load();
  records = mode === "replace" ? incoming.slice() : [...incoming, ...(records ?? []).filter((current) => !incoming.some((item) => item.id === current.id))];
  return persist();
};

export const addNotification = async (input: { kind: NotificationKind; title: string; body: string; actionTarget?: string | null; showDesktop?: boolean }): Promise<NotificationRecord> => {
  await load();
  const now = new Date();
  const record: NotificationRecord = { id: randomUUID(), kind: input.kind, title: input.title, body: input.body, state: "unread", createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + RETENTION_MS).toISOString(), actionTarget: input.actionTarget ?? null };
  records = [record, ...(records ?? [])];
  await persist();
  const lifecycle = await getAppLifecycleSettings();
  if (input.showDesktop !== false && lifecycle.notificationEnabled) {
    try { if (Notification.isSupported()) new Notification({ title: input.title, body: input.body }).show(); } catch (error) { void error; }
  }
  return record;
};

const mutate = async (id: string, state: "read" | "unread" | "handled"): Promise<NotificationRecord[]> => {
  await load();
  records = (records ?? []).map((entry) => entry.id === id ? { ...entry, state } : entry);
  return persist();
};

const mutateMany = async (ids: readonly string[], state: "read" | "unread" | "handled"): Promise<NotificationRecord[]> => {
  await load();
  const idSet = new Set(ids);
  records = (records ?? []).map((entry) => idSet.has(entry.id) ? { ...entry, state } : entry);
  return persist();
};

export const registerNotificationHandlers = (): void => {
  ipcMain.handle("campusos:notifications:load", async (event) => { assertTrustedRenderer(event); return load(); });
  ipcMain.handle("campusos:notifications:read", async (event, id: string) => { assertTrustedRenderer(event); return mutate(id, "read"); });
  ipcMain.handle("campusos:notifications:unread", async (event, id: string) => { assertTrustedRenderer(event); return mutate(id, "unread"); });
  ipcMain.handle("campusos:notifications:handled", async (event, id: string) => { assertTrustedRenderer(event); return mutate(id, "handled"); });
  ipcMain.handle("campusos:notifications:read-all", async (event) => {
    assertTrustedRenderer(event);
    await load();
    records = (records ?? []).map((entry) => entry.state === "unread" ? { ...entry, state: "read" } : entry);
    return persist();
  });
  ipcMain.handle("campusos:notifications:batch", async (event, input: { ids: string[]; state: "read" | "unread" | "handled" }) => {
    assertTrustedRenderer(event);
    if (!Array.isArray(input?.ids) || !["read", "unread", "handled"].includes(input?.state)) {
      throw new Error("通知批量操作参数无效。");
    }
    return mutateMany(input.ids.slice(0, 500), input.state);
  });
  ipcMain.handle("campusos:notifications:clear-expired", async (event) => { assertTrustedRenderer(event); await load(); return persist(); });
  ipcMain.handle("campusos:notifications:clear-all", async (event) => {
    assertTrustedRenderer(event);
    await load();
    records = [];
    return persist();
  });
};
