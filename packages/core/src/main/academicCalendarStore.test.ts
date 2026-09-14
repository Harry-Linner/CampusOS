import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electronState = vi.hoisted(() => ({
  userDataPath: "",
  handlers: new Map<string, (...args: unknown[]) => unknown>()
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => electronState.userDataPath)
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      electronState.handlers.set(channel, handler);
    })
  }
}));

import { registerAcademicCalendarHandlers } from "./academicCalendarStore";
import { closeOfficialDatabaseService } from "./officialDatabaseService";

const temporaryDirectories: string[] = [];

const trustedEvent = (): { senderFrame: { url: string }; sender: { mainFrame: unknown } } => {
  const mainFrame = { url: "http://127.0.0.1:5173/" };
  return { senderFrame: mainFrame, sender: { mainFrame } };
};

beforeEach(() => {
  electronState.handlers.clear();
  process.env.ELECTRON_RENDERER_URL = "http://127.0.0.1:5173/";
});

afterEach(async () => {
  delete process.env.ELECTRON_RENDERER_URL;
  closeOfficialDatabaseService();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

const handlerFor = (channel: string): ((...args: unknown[]) => unknown) => {
  const handler = electronState.handlers.get(channel);
  if (!handler) throw new Error(`${channel} handler was not registered`);
  return handler;
};

describe("academic calendar settings IPC", () => {
  it("defaults to empty holiday/makeup lists and persists a save", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "campusos-academic-calendar-"));
    temporaryDirectories.push(storageRoot);
    electronState.userDataPath = storageRoot;
    registerAcademicCalendarHandlers();

    const load = handlerFor("campusos:academic-calendar:settings:load");
    const save = handlerFor("campusos:academic-calendar:settings:save");

    const initial = await load(trustedEvent()) as { statutoryHolidays: unknown[]; makeupDays: unknown[] };
    expect(initial.statutoryHolidays).toEqual([]);
    expect(initial.makeupDays).toEqual([]);

    const saved = await save(trustedEvent(), {
      statutoryHolidays: [{ date: "2026-10-01", label: "国庆节" }],
      makeupDays: [{ date: "2026-10-04", weekday: 1, source: "manual" }]
    }) as { statutoryHolidays: Array<{ date: string; label: string }>; makeupDays: Array<{ date: string; weekday: number; source: string }> };
    expect(saved.statutoryHolidays).toEqual([{ date: "2026-10-01", label: "国庆节" }]);
    expect(saved.makeupDays).toEqual([{ date: "2026-10-04", weekday: 1, source: "manual" }]);

    const reloaded = await load(trustedEvent()) as { statutoryHolidays: Array<{ date: string; label: string }> };
    expect(reloaded.statutoryHolidays).toEqual([{ date: "2026-10-01", label: "国庆节" }]);
  });

  it("drops malformed holiday/makeup entries during normalization", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "campusos-academic-calendar-"));
    temporaryDirectories.push(storageRoot);
    electronState.userDataPath = storageRoot;
    registerAcademicCalendarHandlers();

    const save = handlerFor("campusos:academic-calendar:settings:save");
    const saved = await save(trustedEvent(), {
      statutoryHolidays: [{ date: "bad", label: "无效" }, { date: "2026-10-01", label: "国庆节" }],
      makeupDays: [{ date: "2026-10-04", weekday: 9, source: "manual" }]
    }) as { statutoryHolidays: Array<{ date: string; label: string }>; makeupDays: unknown[] };
    expect(saved.statutoryHolidays).toEqual([{ date: "2026-10-01", label: "国庆节" }]);
    expect(saved.makeupDays).toEqual([]);
  });
});
