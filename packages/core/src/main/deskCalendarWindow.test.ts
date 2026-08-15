import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeskCalendarSettings } from "@campusos/shared";

const electronState = vi.hoisted(() => ({
  userDataPath: "",
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  windows: [] as Array<{ webContents: { send: ReturnType<typeof vi.fn> }; show: ReturnType<typeof vi.fn>; focus: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; isDestroyed: () => boolean; loadURL: ReturnType<typeof vi.fn>; loadFile: ReturnType<typeof vi.fn>; setAlwaysOnTop: ReturnType<typeof vi.fn>; setMenu: ReturnType<typeof vi.fn> }>
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
        on: vi.fn(),
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
  assertTrustedRenderer: vi.fn()
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

  it("normalizes an invalid persisted view to month", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "campusos-desk-cal-"));
    temporaryDirectories.push(storageRoot);
    electronState.userDataPath = storageRoot;
    const storagePath = join(storageRoot, "preferences", "desk-calendar.json");
    await (await import("node:fs/promises")).mkdir(join(storageRoot, "preferences"), { recursive: true });
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
