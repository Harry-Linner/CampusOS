import { app, screen, type BrowserWindow, type Rectangle } from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

export interface StoredWindowState {
  bounds: Rectangle;
  maximized: boolean;
}

const statePath = (): string => join(app.getPath("userData"), "settings", "main-window.json");

const isRectangle = (value: unknown): value is Rectangle => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Rectangle>;
  return [candidate.x, candidate.y, candidate.width, candidate.height].every((item) => typeof item === "number" && Number.isFinite(item));
};

export const normalizeWindowState = (value: unknown, displays: ReadonlyArray<{ workArea: Rectangle }> = screen.getAllDisplays()): StoredWindowState | null => {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<StoredWindowState>;
  if (!isRectangle(candidate.bounds) || typeof candidate.maximized !== "boolean") return null;
  const bounds = candidate.bounds;
  const minimumWidth = 1100;
  const minimumHeight = 720;
  const width = Math.max(minimumWidth, Math.round(candidate.bounds.width));
  const height = Math.max(minimumHeight, Math.round(candidate.bounds.height));
  const visible = displays.some((display) => {
    const area = display.workArea;
    return Math.max(bounds.x, area.x) < Math.min(bounds.x + width, area.x + area.width) &&
      Math.max(bounds.y, area.y) < Math.min(bounds.y + height, area.y + area.height);
  });
  if (!visible) return null;
  return { bounds: { x: Math.round(bounds.x), y: Math.round(bounds.y), width, height }, maximized: candidate.maximized };
};

export const loadWindowState = async (): Promise<StoredWindowState | null> => {
  try {
    return normalizeWindowState(JSON.parse(await readFile(statePath(), "utf8")));
  } catch {
    return null;
  }
};

export const saveWindowState = async (window: BrowserWindow): Promise<void> => {
  const state: StoredWindowState = { bounds: window.getNormalBounds(), maximized: window.isMaximized() };
  const target = statePath();
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(state, null, 2), "utf8");
  await rename(temporary, target);
};

export const attachWindowStatePersistence = (window: BrowserWindow): (() => void) => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let detached = false;
  const persist = (): void => {
    if (detached) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void saveWindowState(window).catch(() => undefined);
    }, 250);
  };
  window.on("move", persist);
  window.on("resize", persist);
  window.on("maximize", persist);
  window.on("unmaximize", persist);
  window.on("close", persist);
  return () => {
    detached = true;
    if (timer) clearTimeout(timer);
  };
};
