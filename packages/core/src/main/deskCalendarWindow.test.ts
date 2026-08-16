import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeskCalendarSettings } from "@campusos/shared";

const electronState = vi.hoisted(() => ({
  userDataPath: "",
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  windows: [] as Array<{
    webContents: { send: ReturnType<typeof vi.fn> };
    show: ReturnType<typeof vi.fn>;
    focus: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    isDestroyed: () => boolean;
    loadURL: ReturnType<typeof vi.fn>;
    loadFile: ReturnType<typeof vi.fn>;
    setAlwaysOnTop: ReturnType<typeof vi.fn>;
    setMenu: ReturnType<typeof vi.fn>;
    listeners: Map<string, () => void>;
  }>
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => electronState.userDataPath)
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      electronState.handlers.set(channel, handler);
    })
  },
  BrowserWindow: Object.assign(
    vi.fn().mockImplementation(() => {
      const window = {
        webContents: { send: vi.fn() },
        show: vi.fn(),
        focus: vi.fn(),
        close: vi.fn(),
        isDestroyed: () => false,
        listeners: new Map<string, () => void>(),
        on: vi.fn((event: string, listener: () => void) => {
          window.listeners.set(event, listener);
        }),
        loadURL: vi.fn(async () => undefined),
        loadFile: vi.fn(async () => undefined),
        setAlwaysOnTop: vi.fn(),
        setMenu: vi.fn()
      };
      electronState.windows.push(window);
      return window;
    }),
    { getAllWindows: () => electronState.windows }
  )
}));

const snapshot = {
  generatedAt: "2026-08-15T04:00:00.000Z",
  term: {
    label: "2025-2026 春夏学期",
    phase: "active" as const,
    currentWeek: null,
    progressPercent: 0
  },
  sourceStates: [],
  courses: [],
  todayCourses: [],
  deadlines: [],
  materials: [],
  downloads: [],
  reminders: [],
  summary: {
    readySources: 0,
    totalSources: 0,
    downloadsInFlight: 0,
    materialsReady: 0,
    remindersQueued: 0,
    deadlinesDueSoon: 0
  }
};

vi.mock("./campusWorkspaceStore", () => ({
  hydrateCampusWorkspace: vi.fn(async () => ({
    snapshot,
    savedAt: "2026-08-15T04:00:00.000Z",
    storagePath: "C:/workspace.sqlite",
    hydratedFrom: "disk"
  }))
}));

vi.mock("./ipcSecurity", () => ({
  assertTrustedDeskCalendarCaller: vi.fn()
}));

const temporaryDirectories: string[] = [];

beforeEach(() => {
  vi.resetModules();
  electronState.handlers.clear();
  electronState.windows.length = 0;
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

const registerFresh = async () => {
  const { registerDeskCalendarHandlers } = await import("./deskCalendarWindow");
  registerDeskCalendarHandlers();
};

const handlerFor = (channel: string) => {
  const handler = electronState.handlers.get(channel);
  if (!handler) throw new Error(`handler not registered: ${channel}`);
  return handler;
};

describe("desk calendar window IPC", () => {
  it("defaults to disabled with the month view and persists settings", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "campusos-desk-cal-"));
    temporaryDirectories.push(storageRoot);
    electronState.userDataPath = storageRoot;

    await registerFresh();
    const load = handlerFor("campusos:desk-calendar:settings:load");
    const save = handlerFor("campusos:desk-calendar:settings:save");

    const initial = await load({}) as DeskCalendarSettings;
    expect(initial).toMatchObject({ enabled: false, view: "month" });

    const saved = await save({}, { enabled: true, view: "week" }) as DeskCalendarSettings;
    expect(saved).toMatchObject({ enabled: true, view: "week" });
    await expect(readFile(saved.storagePath, "utf8")).resolves.toContain(
      '"view": "week"'
    );

    // Re-loading after save returns the persisted state.
    const reloaded = await load({}) as DeskCalendarSettings;
    expect(reloaded).toMatchObject({ enabled: true, view: "week" });
  });

  it("persists settings when a legacy preferences file already exists", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "campusos-desk-cal-"));
    temporaryDirectories.push(storageRoot);
    electronState.userDataPath = storageRoot;
    await writeFile(
      join(storageRoot, "preferences"),
      JSON.stringify({ spellcheck: true }),
      "utf8"
    );

    await registerFresh();
    const save = handlerFor("campusos:desk-calendar:settings:save");
    const saved = await save({}, { enabled: true, view: "week" }) as DeskCalendarSettings;

    expect(saved.storagePath).toBe(join(storageRoot, "settings", "desk-calendar.json"));
    await expect(readFile(saved.storagePath, "utf8")).resolves.toContain('"enabled": true');
  });

  it("normalizes an invalid persisted view to month", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "campusos-desk-cal-"));
    temporaryDirectories.push(storageRoot);
    electronState.userDataPath = storageRoot;
    const storagePath = join(storageRoot, "settings", "desk-calendar.json");
    await (await import("node:fs/promises")).mkdir(join(storageRoot, "settings"), { recursive: true });
    await (await import("node:fs/promises")).writeFile(storagePath, JSON.stringify({
      enabled: false,
      view: "year",
      savedAt: "2026-08-05T08:00:00.000Z"
    }), "utf8");

    await registerFresh();
    const load = handlerFor("campusos:desk-calendar:settings:load");
    await expect(load({})).resolves.toMatchObject({ enabled: false, view: "month" });
  });

  it("opens a floating window when enabled and closes it when disabled", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "campusos-desk-cal-"));
    temporaryDirectories.push(storageRoot);
    electronState.userDataPath = storageRoot;

    await registerFresh();
    const save = handlerFor("campusos:desk-calendar:settings:save");
    await save({}, { enabled: true });
    expect(electronState.windows).toHaveLength(1);
    expect(electronState.windows[0].setAlwaysOnTop).toHaveBeenCalled();

    await save({}, { enabled: false });
    expect(electronState.windows[0].close).toHaveBeenCalled();
  });

  it("restores an enabled floating window on app startup", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "campusos-desk-cal-"));
    temporaryDirectories.push(storageRoot);
    electronState.userDataPath = storageRoot;
    await (await import("node:fs/promises")).mkdir(join(storageRoot, "settings"), { recursive: true });
    await (await import("node:fs/promises")).writeFile(
      join(storageRoot, "settings", "desk-calendar.json"),
      JSON.stringify({ enabled: true, view: "week", savedAt: "2026-08-15T04:00:00.000Z" }),
      "utf8"
    );

    const { restoreDeskCalendarWindow } = await import("./deskCalendarWindow");
    await restoreDeskCalendarWindow();

    expect(electronState.windows).toHaveLength(1);
    expect(electronState.windows[0].show).toHaveBeenCalled();
  });

  it("pushes a changed view to an already open floating window", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "campusos-desk-cal-"));
    temporaryDirectories.push(storageRoot);
    electronState.userDataPath = storageRoot;

    await registerFresh();
    const save = handlerFor("campusos:desk-calendar:settings:save");
    await save({}, { enabled: true });
    electronState.windows[0].webContents.send.mockClear();

    await save({}, { view: "day" });
    await vi.waitFor(() => {
      expect(electronState.windows[0].webContents.send).toHaveBeenCalledWith(
        "campusos:desk-calendar:snapshot",
        expect.objectContaining({ view: "day" })
      );
    });
  });

  it("disables the preference when the window is closed outside the UI", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "campusos-desk-cal-"));
    temporaryDirectories.push(storageRoot);
    electronState.userDataPath = storageRoot;

    await registerFresh();
    const save = handlerFor("campusos:desk-calendar:settings:save");
    const load = handlerFor("campusos:desk-calendar:settings:load");
    await save({}, { enabled: true });

    electronState.windows[0].listeners.get("closed")?.();
    await vi.waitFor(async () => {
      await expect(load({})).resolves.toMatchObject({ enabled: false });
    });
  });

  it("returns the current workspace snapshot to the floating window", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "campusos-desk-cal-"));
    temporaryDirectories.push(storageRoot);
    electronState.userDataPath = storageRoot;

    await registerFresh();
    const snapshotHandler = handlerFor("campusos:desk-calendar:window:snapshot");
    const message = await snapshotHandler({}) as { snapshot: typeof snapshot; view: string };
    expect(message.snapshot.generatedAt).toBe("2026-08-15T04:00:00.000Z");
    expect(message.view).toBe("month");
  });

  it("closes the floating window and disables the setting on close", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "campusos-desk-cal-"));
    temporaryDirectories.push(storageRoot);
    electronState.userDataPath = storageRoot;

    await registerFresh();
    const save = handlerFor("campusos:desk-calendar:settings:save");
    const close = handlerFor("campusos:desk-calendar:window:close");
    await save({}, { enabled: true });
    expect(electronState.windows).toHaveLength(1);

    await close({});
    expect(electronState.windows[0].close).toHaveBeenCalled();

    const load = handlerFor("campusos:desk-calendar:settings:load");
    await expect(load({})).resolves.toMatchObject({ enabled: false });
  });
});
