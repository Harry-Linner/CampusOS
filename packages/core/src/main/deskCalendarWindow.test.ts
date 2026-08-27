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
    isMinimized: ReturnType<typeof vi.fn>;
    restore: ReturnType<typeof vi.fn>;
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
        isMinimized: vi.fn(() => false),
        restore: vi.fn(),
        close: vi.fn(),
        isDestroyed: () => false,
        listeners: new Map<string, () => void>(),
        on: vi.fn((event: string, listener: () => void) => {
          window.listeners.set(event, listener);
        }),
        loadURL: vi.fn(async () => undefined),
        loadFile: vi.fn(async () => undefined),
        setAlwaysOnTop: vi.fn(),
        setMenu: vi.fn(),
        getNormalBounds: vi.fn(() => ({ x: 0, y: 0, width: 720, height: 560 })),
        isMaximized: vi.fn(() => false)
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

vi.mock("./scheduleIpc", () => ({
  loadSchedulePeriods: vi.fn(() => []),
  loadScheduleTasks: vi.fn(() => ({ tasks: [], updatedAt: "2026-08-15T04:00:00.000Z" })),
  saveScheduleTask: vi.fn(async () => ({ tasks: [], updatedAt: "2026-08-15T04:00:00.000Z" })),
  mutateScheduleTask: vi.fn(async () => ({ tasks: [], updatedAt: "2026-08-15T04:00:00.000Z" }))
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
    expect(initial).toMatchObject({ enabled: false, view: "month", showClock: true });

    const saved = await save({}, { enabled: true, view: "week", showClock: false }) as DeskCalendarSettings;
    expect(saved).toMatchObject({ enabled: true, view: "week", showClock: false });
    await expect(readFile(saved.storagePath, "utf8")).resolves.toContain(
      '"view": "week"'
    );

    // Re-loading after save returns the persisted state.
    const reloaded = await load({}) as DeskCalendarSettings;
    expect(reloaded).toMatchObject({ enabled: true, view: "week", showClock: false });
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
    electronState.windows[0].listeners.get("move")?.();

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

  it("saves a desktop task through the trusted schedule mutation path", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "campusos-desk-cal-"));
    temporaryDirectories.push(storageRoot);
    electronState.userDataPath = storageRoot;
    await registerFresh();
    const saveTask = handlerFor("campusos:desk-calendar:task:save");
    await saveTask({}, {
      title: "Direct task",
      description: "",
      startAt: "2026-08-16T01:00:00.000Z",
      endAt: "2026-08-16T02:00:00.000Z",
      location: "",
      timeSpentMinutes: 0,
      timeNeededMinutes: 60,
      breakable: true,
      type: "fixed",
      repeatType: "norepeat",
      repeatPeriod: 1,
      repeatEndsOn: "2026-08-16",
      blocksPlanning: true
    });
    const schedule = await import("./scheduleIpc");
    expect(schedule.saveScheduleTask).toHaveBeenCalledWith(expect.objectContaining({ title: "Direct task", type: "fixed" }));
  });

  it("refreshes weather through the main-process provider and persists the cache", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "campusos-desk-cal-"));
    temporaryDirectories.push(storageRoot);
    electronState.userDataPath = storageRoot;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [{ latitude: 30.27, longitude: 120.15, name: "杭州" }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        current: { temperature_2m: 27.5, weather_code: 1, time: "2026-08-16T12:00" },
        daily: {
          time: ["2026-08-16", "2026-08-17", "2026-08-18", "2026-08-19"],
          weather_code: [1, 2, 3, 61],
          temperature_2m_max: [30, 31, 29, 28],
          temperature_2m_min: [24, 25, 23, 22]
        }
      }) });
    vi.stubGlobal("fetch", fetchMock);
    await registerFresh();
    const save = handlerFor("campusos:desk-calendar:settings:save");
    await save({}, { weather: { location: "杭州" } });
    const weather = await handlerFor("campusos:desk-calendar:weather:refresh")({}) as { location: string; temperatureC: number; weatherCode: number; error: string | null; forecast?: Array<{ date: string; weatherCode: number; tempMax: number; tempMin: number }> };
    expect(weather).toMatchObject({ location: "杭州", temperatureC: 27.5, weatherCode: 1, error: null });
    expect(weather.forecast).toHaveLength(4);
    expect(weather.forecast?.[0]).toEqual({ date: "2026-08-16", weatherCode: 1, tempMax: 30, tempMin: 24 });
    expect(weather.forecast?.[3]).toEqual({ date: "2026-08-19", weatherCode: 61, tempMax: 28, tempMin: 22 });
    const stored = JSON.parse(await readFile(join(storageRoot, "settings", "desk-calendar.json"), "utf8")) as { weather: { temperatureC: number; forecast: unknown[] } };
    expect(stored.weather.temperatureC).toBe(27.5);
    expect(stored.weather.forecast).toHaveLength(4);
  });

  it("persists normalized widget, countdown, progress, appearance, holiday, and display settings", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "campusos-desk-cal-"));
    temporaryDirectories.push(storageRoot);
    electronState.userDataPath = storageRoot;
    await registerFresh();
    const save = handlerFor("campusos:desk-calendar:settings:save");
    await save({}, {
      widgets: [{ id: "clock", enabled: false }, { id: "weather", enabled: true }],
      countdowns: [{ id: "countdown-1", title: "Exam", targetAt: "2026-08-20T00:00:00.000Z" }],
      progress: [{ id: "progress-1", title: "Term", startAt: "2026-08-01T00:00:00.000Z", endAt: "2026-09-01T00:00:00.000Z" }],
      appearance: { opacity: 0.55, background: "#223344", theme: "aurora" },
      statutoryHolidays: [{ date: "2026-10-01", label: "国庆节" }],
      makeupDays: [{ date: "2026-10-09", weekday: 5, source: "manual" as const }],
      displayProfiles: [{ displayKey: "primary", bounds: { x: 0, y: 0, width: 720, height: 560 } }]
    });
    await expect(handlerFor("campusos:desk-calendar:settings:load")({})).resolves.toMatchObject({
      countdowns: [{ id: "countdown-1" }],
      progress: [{ id: "progress-1" }],
      appearance: { opacity: 0.55, background: "#223344", theme: "aurora" },
      statutoryHolidays: [{ date: "2026-10-01", label: "国庆节" }],
      makeupDays: [{ date: "2026-10-09", weekday: 5, source: "manual" }],
      displayProfiles: [{ displayKey: "primary" }]
    });
  });

  it("returns the cached weather with an explicit provider error", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "campusos-desk-cal-"));
    temporaryDirectories.push(storageRoot);
    electronState.userDataPath = storageRoot;
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })));
    await registerFresh();
    const save = handlerFor("campusos:desk-calendar:settings:save");
    await save({}, { weather: { location: "杭州", temperatureC: 26, weatherCode: 2, observedAt: "2026-08-16T11:00:00.000Z", cachedAt: "2026-08-16T11:00:00.000Z", error: null } });
    const weather = await handlerFor("campusos:desk-calendar:weather:refresh")({});
    expect(weather).toMatchObject({ location: "杭州", temperatureC: 26, weatherCode: 2, error: "定位服务返回 503" });
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

  it("focuses the main window and forwards the exact selected event", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "campusos-desk-cal-"));
    temporaryDirectories.push(storageRoot);
    electronState.userDataPath = storageRoot;

    await registerFresh();
    const save = handlerFor("campusos:desk-calendar:settings:save");
    await save({}, { enabled: true });
    const { BrowserWindow } = await import("electron");
    const mainWindow = new BrowserWindow();
    const openMain = handlerFor("campusos:desk-calendar:window:open-main");

    await openMain({}, { entityId: "calendar:event-1" });

    expect(mainWindow.show).toHaveBeenCalled();
    expect(mainWindow.focus).toHaveBeenCalled();
    expect(mainWindow.webContents.send).toHaveBeenCalledWith(
      "campusos:navigation:request",
      expect.objectContaining({ viewId: "schedule", entityId: "calendar:event-1" })
    );
  });
});
