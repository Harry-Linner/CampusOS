import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabaseService, type DatabaseService } from "./databaseService";
import type { NotificationRecord } from "../shared/notificationBridge";

const persistenceState = vi.hoisted(() => ({
  current: null as DatabaseService | null,
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  userDataPath: "",
  notifications: [] as Array<{ handlers: Map<string, () => void>; show: ReturnType<typeof vi.fn> }>,
  holdLifecycle: false,
  lifecycleEntered: false,
  releaseLifecycle: null as (() => void) | null,
  openDialogResult: { canceled: true, filePaths: [] as string[] },
  saveDialogResult: { canceled: true, filePath: "" }
}));

vi.mock("./officialDatabaseService", () => ({
  getOfficialDatabaseService: vi.fn(() => {
    if (!persistenceState.current) throw new Error("database is not open");
    return persistenceState.current;
  }),
  closeOfficialDatabaseService: vi.fn()
}));

vi.mock("./appLifecycle", () => ({
  getAppLifecycleSettings: vi.fn(async () => {
    if (persistenceState.holdLifecycle) {
      persistenceState.lifecycleEntered = true;
      await new Promise<void>((resolve) => { persistenceState.releaseLifecycle = resolve; });
    }
    return { notificationEnabled: true };
  }),
  navigateCampusMainWindow: vi.fn()
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => persistenceState.userDataPath),
    setLoginItemSettings: vi.fn(),
    getLoginItemSettings: vi.fn(() => ({ openAtLogin: false }))
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      persistenceState.handlers.set(channel, handler);
    })
  },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  dialog: {
    showOpenDialog: vi.fn(async () => persistenceState.openDialogResult),
    showSaveDialog: vi.fn(async () => persistenceState.saveDialogResult)
  },
  Notification: class {
    static isSupported = vi.fn(() => true);
    handlers = new Map<string, () => void>();
    show = vi.fn();
    constructor() { persistenceState.notifications.push(this); }
    on(event: string, handler: () => void): void { this.handlers.set(event, handler); }
  },
  safeStorage: { isEncryptionAvailable: vi.fn(() => true) }
}));

const temporaryDirectories: string[] = [];

const makeRecord = (id: string, overrides: Partial<NotificationRecord> = {}): NotificationRecord => ({
  id,
  kind: "feed",
  title: `通知 ${id}`,
  body: "正文",
  state: "unread",
  createdAt: "2026-09-01T00:00:00.000Z",
  expiresAt: "2026-10-01T00:00:00.000Z",
  actionTarget: { viewId: "campus-feed", entityId: `entity-${id}` },
  source: "campus-feed",
  sourceId: "source-1",
  sourceLabel: "校园资讯",
  groupId: "group-1",
  entityId: `entity-${id}`,
  publishedAt: "2026-09-01T00:00:00.000Z",
  ...overrides
});

const loadNotificationCenter = async (): Promise<typeof import("./notificationCenter")> => {
  vi.resetModules();
  return import("./notificationCenter");
};

const trustedEvent = (): { senderFrame: { url: string }; sender: { mainFrame: unknown } } => {
  const frame = { url: "http://localhost:5173/" };
  return { senderFrame: frame, sender: { mainFrame: frame } };
};

const invoke = async <T>(channel: string, ...args: unknown[]): Promise<T> => {
  const handler = persistenceState.handlers.get(channel);
  if (!handler) throw new Error(`missing handler: ${channel}`);
  return await handler(trustedEvent(), ...args) as T;
};

const reopenDatabase = (): void => {
  const databasePath = persistenceState.current?.databasePath;
  if (!databasePath) throw new Error("database path is not available");
  persistenceState.current?.close();
  persistenceState.current = createDatabaseService({ databasePath });
};

beforeEach(async () => {
  const root = await mkdtemp(join(process.env.TEMP ?? process.cwd(), "campusos-notification-persistence-"));
  temporaryDirectories.push(root);
  persistenceState.userDataPath = root;
  persistenceState.handlers.clear();
  persistenceState.notifications.length = 0;
  persistenceState.holdLifecycle = false;
  persistenceState.lifecycleEntered = false;
  persistenceState.releaseLifecycle = null;
  persistenceState.openDialogResult = { canceled: true, filePaths: [] };
  persistenceState.saveDialogResult = { canceled: true, filePath: "" };
  persistenceState.current = createDatabaseService({ databasePath: join(root, "campusos.sqlite") });
  process.env.ELECTRON_RENDERER_URL = "http://localhost:5173/";
});

afterEach(async () => {
  persistenceState.releaseLifecycle?.();
  persistenceState.current?.close();
  persistenceState.current = null;
  delete process.env.ELECTRON_RENDERER_URL;
  vi.useRealTimers();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("notification SQLite persistence regressions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T00:00:00.000Z"));
  });

  it("commits both first-load concurrent notifications to SQLite", async () => {
    const { addNotification, readNotificationRecords } = await loadNotificationCenter();

    await Promise.all([
      addNotification({ id: "parallel-a", kind: "system", title: "A", body: "a", showDesktop: false }),
      addNotification({ id: "parallel-b", kind: "system", title: "B", body: "b", showDesktop: false })
    ]);

    expect((await readNotificationRecords()).map((entry) => entry.id).sort()).toEqual(["parallel-a", "parallel-b"]);
    expect(persistenceState.current?.loadNotifications().map((entry) => entry.id).sort()).toEqual(["parallel-a", "parallel-b"]);
  });

  it("imports a valid legacy JSON file once and never resurrects it after a cleared restart", async () => {
    const legacy = makeRecord("legacy-1", { state: "read", actionTarget: { viewId: "schedule", entityId: "course-1" } });
    await mkdir(join(persistenceState.userDataPath, "notifications"), { recursive: true });
    await writeFile(join(persistenceState.userDataPath, "notifications", "notifications.json"), JSON.stringify([legacy]), "utf8");

    const first = await loadNotificationCenter();
    expect(await first.readNotificationRecords()).toEqual([legacy]);
    expect(persistenceState.current?.hasImportedLegacyNotifications()).toBe(true);

    persistenceState.current?.saveNotifications([], true);
    reopenDatabase();
    const second = await loadNotificationCenter();
    expect(await second.readNotificationRecords()).toEqual([]);
    expect(persistenceState.current?.hasImportedLegacyNotifications()).toBe(true);
  });

  it("rejects malformed legacy JSON without replacing existing SQLite records", async () => {
    const existing = makeRecord("existing");
    persistenceState.current?.saveNotifications([existing]);
    await mkdir(join(persistenceState.userDataPath, "notifications"), { recursive: true });
    await writeFile(join(persistenceState.userDataPath, "notifications", "notifications.json"), "{broken", "utf8");

    const { readNotificationRecords } = await loadNotificationCenter();
    await expect(readNotificationRecords()).rejects.toThrow();
    expect(persistenceState.current?.loadNotifications()).toEqual([existing]);
    expect(persistenceState.current?.hasImportedLegacyNotifications()).toBe(false);
  });

  it("keeps notification records across official database close and reopen", async () => {
    const { addNotification } = await loadNotificationCenter();
    const added = await addNotification({
      id: "restart-record",
      kind: "task",
      title: "待办",
      body: "重启后仍存在",
      actionTarget: { viewId: "tasks", entityId: "task-1" },
      showDesktop: false
    });

    reopenDatabase();
    const { readNotificationRecords } = await loadNotificationCenter();
    expect(await readNotificationRecords()).toEqual([added]);
  });

  it("commits before waiting for desktop notification lifecycle settings", async () => {
    persistenceState.holdLifecycle = true;
    const { addNotification } = await loadNotificationCenter();
    const addition = addNotification({ id: "toast-order", kind: "system", title: "系统", body: "先持久化", showDesktop: true });

    for (let attempt = 0; attempt < 20 && !persistenceState.lifecycleEntered; attempt += 1) await Promise.resolve();
    expect(persistenceState.lifecycleEntered).toBe(true);
    expect(persistenceState.current?.loadNotifications().map((entry) => entry.id)).toEqual(["toast-order"]);

    persistenceState.releaseLifecycle?.();
    persistenceState.releaseLifecycle = null;
    await addition;
  });

  it("preserves state and action target through merge and replace restore", async () => {
    const initial = makeRecord("initial", { state: "handled" });
    const incoming = makeRecord("incoming", {
      state: "read",
      actionTarget: { viewId: "schedule", entityId: "exam-1" }
    });
    persistenceState.current?.saveNotifications([initial], true);
    const { restoreNotificationRecords, readNotificationRecords } = await loadNotificationCenter();

    expect(await restoreNotificationRecords([incoming], "merge")).toEqual(expect.arrayContaining([incoming, initial]));
    expect(await readNotificationRecords()).toEqual(expect.arrayContaining([incoming, initial]));

    const replacement = makeRecord("replacement", {
      state: "unread",
      actionTarget: { viewId: "campus-feed", entityId: "feed-2" }
    });
    expect(await restoreNotificationRecords([replacement], "replace")).toEqual([replacement]);
    expect(persistenceState.current?.loadNotifications()).toEqual([replacement]);
  });

  it("keeps all unread records ahead of read history at the 500-record cap", async () => {
    const unread = [makeRecord("unread-1", { createdAt: "2026-09-02T00:00:00.000Z" }), makeRecord("unread-2", { createdAt: "2026-09-03T00:00:00.000Z" })];
    const read = Array.from({ length: 500 }, (_, index) => makeRecord(`read-${index}`, { state: "read", createdAt: "2026-08-01T00:00:00.000Z" }));
    const { restoreNotificationRecords } = await loadNotificationCenter();

    const saved = await restoreNotificationRecords([...read, ...unread], "replace");
    expect(saved).toHaveLength(500);
    expect(saved.filter((entry) => entry.state === "unread").map((entry) => entry.id)).toEqual(["unread-2", "unread-1"]);
    expect(persistenceState.current?.loadNotifications()).toHaveLength(500);
  });

  it("has a real SQLite migration and keeps the public record fields available", async () => {
    expect(persistenceState.current?.schemaVersion).toBe(13);
    const record = makeRecord("api-shape");
    persistenceState.current?.saveNotifications([record], true);
    expect(persistenceState.current?.loadNotifications()).toEqual([record]);
  });

  it("re-applies the real v12-to-v13 migration after the v13 marker and tables are removed", () => {
    const databasePath = persistenceState.current?.databasePath;
    if (!databasePath) throw new Error("database path is not available");
    persistenceState.current?.close();

    const legacyDatabase = new Database(databasePath);
    legacyDatabase.exec("DROP TABLE notification_storage_meta; DROP TABLE notifications; DELETE FROM schema_migrations WHERE version = 13;");
    legacyDatabase.close();

    persistenceState.current = createDatabaseService({ databasePath });
    expect(persistenceState.current.schemaVersion).toBe(13);
    const record = makeRecord("migrated");
    persistenceState.current.saveNotifications([record], true);
    expect(persistenceState.current.loadNotifications()).toEqual([record]);
  });

  it("rolls back a duplicate-id save and keeps the previous notification set", () => {
    const previous = makeRecord("previous");
    persistenceState.current?.saveNotifications([previous], true);
    const duplicate = makeRecord("duplicate");

    expect(() => persistenceState.current?.saveNotifications([duplicate, duplicate], true)).toThrow();
    expect(persistenceState.current?.loadNotifications()).toEqual([previous]);
    expect(persistenceState.current?.hasImportedLegacyNotifications()).toBe(true);
  });

  it("runs backup preview and restore through IPC with an atomic task-notification boundary", async () => {
    const savedAt = "2026-09-06T00:00:00.000Z";
    const oldTask = { id: "old-task", title: "旧任务" };
    const replacementTask = { id: "replacement-task", title: "替换任务" };
    const mergeTask = { id: "merge-task", title: "合并任务" };
    const oldNotification = makeRecord("old-notification", { state: "handled" });
    const replacementNotification = makeRecord("replacement-notification", {
      state: "read",
      actionTarget: { viewId: "schedule", entityId: "exam-replacement" }
    });
    const mergeNotification = makeRecord("merge-notification", {
      state: "unread",
      actionTarget: { viewId: "campus-feed", entityId: "feed-merge" }
    });
    const backupPath = join(persistenceState.userDataPath, "backup.json");
    const legacyPath = join(persistenceState.userDataPath, "notifications", "notifications.json");

    persistenceState.current?.saveLocalTasks([oldTask], savedAt);
    persistenceState.current?.saveNotifications([oldNotification]);
    await mkdir(join(persistenceState.userDataPath, "notifications"), { recursive: true });
    await writeFile(legacyPath, "{broken", "utf8");
    await writeFile(backupPath, JSON.stringify({
      schemaVersion: 1,
      exportedAt: savedAt,
      tasks: { tasks: [replacementTask], savedAt },
      notifications: [replacementNotification]
    }), "utf8");

    persistenceState.openDialogResult = { canceled: false, filePaths: [backupPath] };
    const notificationCenter = await loadNotificationCenter();
    const { registerBackupHandlers } = await import("./backupStore");
    registerBackupHandlers();

    await expect(invoke("campusos:backup:preview")).resolves.toMatchObject({
      taskCount: 1,
      notificationCount: 1
    });
    await expect(invoke("campusos:backup:restore", "replace")).rejects.toThrow();
    expect(persistenceState.current?.loadLocalTasks()?.tasks).toEqual([oldTask]);
    expect(persistenceState.current?.loadNotifications()).toEqual([oldNotification]);

    await writeFile(legacyPath, JSON.stringify([makeRecord("legacy-before-restore")]), "utf8");
    await invoke("campusos:backup:restore", "replace");
    expect(persistenceState.current?.loadLocalTasks()?.tasks).toEqual([replacementTask]);
    const replaced = await notificationCenter.readNotificationRecords();
    expect(replaced).toEqual(expect.arrayContaining([replacementNotification]));
    expect(replaced).toHaveLength(2);
    expect(replaced.filter((entry) => entry.title === "备份已恢复")).toHaveLength(1);

    await writeFile(backupPath, JSON.stringify({
      schemaVersion: 1,
      exportedAt: savedAt,
      tasks: { tasks: [mergeTask], savedAt },
      notifications: [mergeNotification]
    }), "utf8");
    await invoke("campusos:backup:preview");
    await invoke("campusos:backup:restore", "merge");
    expect(persistenceState.current?.loadLocalTasks()?.tasks).toEqual([replacementTask, mergeTask]);
    const merged = await notificationCenter.readNotificationRecords();
    expect(merged).toEqual(expect.arrayContaining([replacementNotification, mergeNotification]));
    expect(merged.filter((entry) => entry.title === "备份已恢复")).toHaveLength(2);

    const exportPath = join(persistenceState.userDataPath, "export.json");
    persistenceState.saveDialogResult = { canceled: false, filePath: exportPath };
    await invoke("campusos:backup:export");
    const exported = JSON.parse(await readFile(exportPath, "utf8")) as {
      tasks: { tasks: unknown[] };
      notifications: NotificationRecord[];
    };
    expect(exported.tasks.tasks).toEqual([replacementTask, mergeTask]);
    expect(exported.notifications).toHaveLength(4);
    expect(exported.notifications).toEqual(expect.arrayContaining([replacementNotification, mergeNotification]));
    expect(exported.notifications.filter((entry) => entry.title === "备份已恢复")).toHaveLength(2);
  });
});
