import { app, BrowserWindow, ipcMain, Notification } from "electron";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  NotificationActionTarget,
  NotificationKind,
  NotificationRecord,
  NotificationSource,
  NotificationState
} from "../shared/notificationBridge";
import { assertTrustedRenderer } from "./ipcSecurity";
import { getAppLifecycleSettings, navigateCampusMainWindow } from "./appLifecycle";
import { getOfficialDatabaseService } from "./officialDatabaseService";

const FILE = "notifications.json";
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_RECORDS = 500;
export const NOTIFICATIONS_CHANGED_CHANNEL = "campusos:notifications:changed";

export interface AddNotificationInput {
  id?: string;
  kind: NotificationKind;
  title: string;
  body: string;
  actionTarget?: string | NotificationActionTarget | null;
  source?: NotificationSource;
  sourceId?: string | null;
  sourceLabel?: string | null;
  groupId?: string | null;
  entityId?: string | null;
  publishedAt?: string | null;
  showDesktop?: boolean;
  desktopTitle?: string;
  desktopBody?: string;
}

interface TransientNotificationInput {
  title: string;
  body: string;
  actionTarget?: string | NotificationActionTarget | null;
}

const filePath = (): string => join(app.getPath("userData"), "notifications", FILE);
const isMissing = (error: unknown): boolean => typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
const validState = (value: unknown): value is NotificationState =>
  value === "unread" || value === "read" || value === "handled" || value === "expired";
const validKind = (value: unknown): value is NotificationKind =>
  value === "course" || value === "exam" || value === "assignment" || value === "task" || value === "grade" || value === "sync" || value === "feed" || value === "system";
const validSource = (value: unknown): value is NotificationSource =>
  value === "system" || value === "schedule" || value === "campus-feed" || value === "academic";
const optionalText = (value: unknown, limit: number): string | null =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, limit) : null;

const normalizeTarget = (value: unknown): string | NotificationActionTarget | null => {
  if (typeof value === "string" && value.trim()) return value.trim().slice(0, 80);
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<NotificationActionTarget>;
  if (typeof candidate.viewId !== "string" || !candidate.viewId.trim()) return null;
  return {
    viewId: candidate.viewId.trim().slice(0, 80),
    ...(typeof candidate.entityId === "string" && candidate.entityId.trim()
      ? { entityId: candidate.entityId.trim().slice(0, 240) }
      : {})
  };
};

const normalizeRecord = (value: unknown): NotificationRecord | null => {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<NotificationRecord>;
  if (
    typeof candidate.id !== "string" || !candidate.id ||
    typeof candidate.title !== "string" ||
    typeof candidate.body !== "string" ||
    !validKind(candidate.kind) ||
    !validState(candidate.state) ||
    typeof candidate.createdAt !== "string" ||
    !Number.isFinite(Date.parse(candidate.createdAt))
  ) return null;
  const createdAt = new Date(candidate.createdAt).toISOString();
  return {
    id: candidate.id.slice(0, 320),
    kind: candidate.kind,
    title: candidate.title.slice(0, 160),
    body: candidate.body.slice(0, 500),
    state: candidate.state,
    createdAt,
    expiresAt: typeof candidate.expiresAt === "string" && Number.isFinite(Date.parse(candidate.expiresAt))
      ? new Date(candidate.expiresAt).toISOString()
      : new Date(Date.parse(createdAt) + RETENTION_MS).toISOString(),
    actionTarget: normalizeTarget(candidate.actionTarget),
    source: validSource(candidate.source)
      ? candidate.source
      : candidate.kind === "feed" ? "campus-feed" : candidate.kind === "grade" ? "academic" : "system",
    sourceId: optionalText(candidate.sourceId, 160),
    sourceLabel: optionalText(candidate.sourceLabel, 120),
    groupId: optionalText(candidate.groupId, 240),
    entityId: optionalText(candidate.entityId, 240),
    publishedAt: typeof candidate.publishedAt === "string" && Number.isFinite(Date.parse(candidate.publishedAt))
      ? new Date(candidate.publishedAt).toISOString()
      : null
  };
};

const newestFirst = (left: NotificationRecord, right: NotificationRecord): number =>
  Date.parse(right.createdAt) - Date.parse(left.createdAt) || right.id.localeCompare(left.id);

const prune = (source: readonly NotificationRecord[] | null): NotificationRecord[] => {
  const now = Date.now();
  const normalized = [...new Map((source ?? [])
    .map(normalizeRecord)
    .filter((entry): entry is NotificationRecord => entry !== null)
    .map((entry) => [entry.id, entry] as const)).values()]
    .map((entry) =>
      (entry.state === "read" || entry.state === "handled") && Date.parse(entry.expiresAt) <= now
        ? { ...entry, state: "expired" as const }
        : entry
    )
    .sort(newestFirst);
  const priority: NotificationState[] = ["unread", "read", "handled", "expired"];
  const kept: NotificationRecord[] = [];
  for (const state of priority) {
    for (const entry of normalized) {
      if (entry.state === state && kept.length < MAX_RECORDS) kept.push(entry);
    }
  }
  return kept.sort(newestFirst);
};

// No await between load and save: each operation commits before yielding to
// another producer or app shutdown. SQLite is authoritative, including emptiness.
const load = (): NotificationRecord[] => {
  const database = getOfficialDatabaseService();
  let records = database.loadNotifications();
  if (!database.hasImportedLegacyNotifications()) {
    let legacy: NotificationRecord[] = [];
    try {
      const text = readFileSync(filePath(), "utf8");
      const parsed: unknown = text.trim() ? JSON.parse(text) : [];
      if (!Array.isArray(parsed)) throw new Error("invalid notification list");
      legacy = parsed.map(normalizeRecord).filter((entry): entry is NotificationRecord => entry !== null);
    } catch (error) {
      if (!isMissing(error)) throw new Error("旧通知记录无法读取，原文件和 SQLite 数据已保留。请修复旧通知文件后重试。");
    }
    records = prune([...legacy, ...records]);
    database.saveNotifications(records, true);
  }
  const retained = prune(records);
  if (JSON.stringify(retained) !== JSON.stringify(records)) database.saveNotifications(retained);
  return retained;
};

const broadcast = (): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(NOTIFICATIONS_CHANGED_CHANNEL);
  }
};

const persist = (records: readonly NotificationRecord[]): NotificationRecord[] => {
  const retained = prune(records);
  getOfficialDatabaseService().saveNotifications(retained);
  broadcast();
  return retained;
};

const targetToNavigation = (
  target: string | NotificationActionTarget | null | undefined
): NotificationActionTarget | null => {
  if (typeof target === "string" && target) return { viewId: target };
  return target && typeof target === "object" ? target : null;
};

export const showTransientNotification = async (input: TransientNotificationInput): Promise<void> => {
  const lifecycle = await getAppLifecycleSettings();
  if (!lifecycle.notificationEnabled || !Notification.isSupported()) return;
  const notification = new Notification({ title: input.title, body: input.body });
  const target = targetToNavigation(input.actionTarget);
  if (target) notification.on("click", () => navigateCampusMainWindow(target));
  notification.show();
};

export const readNotificationRecords = async (): Promise<NotificationRecord[]> => load();

export const markNotificationsReadByTarget = async (actionTarget: string): Promise<void> => {
  let records = load();
  records = (records ?? []).map((entry) => {
    const target = targetToNavigation(entry.actionTarget);
    return target?.viewId === actionTarget && entry.state === "unread"
      ? { ...entry, state: "read" }
      : entry;
  });
  persist(records);
};

export const markNotificationsHandledByEntities = async (
  source: NotificationSource,
  entityIds: readonly string[]
): Promise<void> => {
  let records = load();
  const ids = new Set(entityIds);
  records = (records ?? []).map((entry) =>
    entry.source === source && entry.entityId && ids.has(entry.entityId) && entry.state !== "expired"
      ? { ...entry, state: "handled" }
      : entry
  );
  persist(records);
};

export const restoreNotificationRecords = (incoming: NotificationRecord[], mode: "merge" | "replace"): NotificationRecord[] => {
  let records = load();
  const normalized = incoming.map(normalizeRecord).filter((entry): entry is NotificationRecord => entry !== null);
  records = mode === "replace"
    ? normalized
    : [...normalized, ...(records ?? []).filter((current) => !normalized.some((item) => item.id === current.id))];
  return persist(records);
};

export const addNotification = async (input: AddNotificationInput): Promise<NotificationRecord> => {
  let records = load();
  const now = new Date();
  const id = input.id?.slice(0, 320) || randomUUID();
  const existing = (records ?? []).find((entry) => entry.id === id);
  const record = normalizeRecord({
    id,
    kind: input.kind,
    title: input.title,
    body: input.body,
    state: "unread",
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + RETENTION_MS).toISOString(),
    actionTarget: input.actionTarget ?? null,
    source: input.source ?? "system",
    sourceId: input.sourceId ?? null,
    sourceLabel: input.sourceLabel ?? null,
    groupId: input.groupId ?? null,
    entityId: input.entityId ?? null,
    publishedAt: input.publishedAt ?? null
  });
  if (!record) throw new Error("通知内容无效。");
  if (existing && existing.title === record.title && existing.body === record.body) return existing;
  records = [record, ...(records ?? []).filter((entry) => entry.id !== id)];
  persist(records);
  if (input.showDesktop !== false) {
    const target = targetToNavigation(record.actionTarget);
    const lifecycle = await getAppLifecycleSettings();
    if (lifecycle.notificationEnabled && Notification.isSupported()) {
      const notification = new Notification({ title: input.desktopTitle ?? record.title, body: input.desktopBody ?? record.body });
      notification.on("click", () => {
        if (target) navigateCampusMainWindow(target);
        void mutate(record.id, "read");
      });
      notification.show();
    }
  }
  return record;
};

const mutate = async (id: string, state: "read" | "unread" | "handled"): Promise<NotificationRecord[]> => {
  let records = load();
  records = (records ?? []).map((entry) =>
    entry.id === id
      ? { ...entry, state, ...(state === "unread" ? { expiresAt: new Date(Date.now() + RETENTION_MS).toISOString() } : {}) }
      : entry
  );
  return persist(records);
};

const mutateMany = async (ids: readonly string[], state: "read" | "unread" | "handled"): Promise<NotificationRecord[]> => {
  let records = load();
  const idSet = new Set(ids);
  records = (records ?? []).map((entry) => idSet.has(entry.id) ? { ...entry, state } : entry);
  return persist(records);
};

export const registerNotificationHandlers = (): void => {
  ipcMain.handle("campusos:notifications:load", async (event) => { assertTrustedRenderer(event); return load(); });
  ipcMain.handle("campusos:notifications:read", async (event, id: string) => { assertTrustedRenderer(event); return mutate(id, "read"); });
  ipcMain.handle("campusos:notifications:unread", async (event, id: string) => { assertTrustedRenderer(event); return mutate(id, "unread"); });
  ipcMain.handle("campusos:notifications:handled", async (event, id: string) => { assertTrustedRenderer(event); return mutate(id, "handled"); });
  ipcMain.handle("campusos:notifications:read-all", async (event) => {
    assertTrustedRenderer(event);
    let records = load();
    records = (records ?? []).map((entry) => entry.state === "unread" ? { ...entry, state: "read" } : entry);
    return persist(records);
  });
  ipcMain.handle("campusos:notifications:batch", async (event, input: { ids: string[]; state: "read" | "unread" | "handled" }) => {
    assertTrustedRenderer(event);
    if (!Array.isArray(input?.ids) || !["read", "unread", "handled"].includes(input?.state)) {
      throw new Error("通知批量操作参数无效。");
    }
    return mutateMany(input.ids.slice(0, MAX_RECORDS), input.state);
  });
  ipcMain.handle("campusos:notifications:clear-expired", async (event) => { assertTrustedRenderer(event); const records = load(); return persist(records); });
  ipcMain.handle("campusos:notifications:clear-all", async (event) => {
    assertTrustedRenderer(event);
    let records = load();
    records = (records ?? []).map((entry) => entry.state === "expired" ? entry : { ...entry, state: "handled" });
    return persist(records);
  });
};
