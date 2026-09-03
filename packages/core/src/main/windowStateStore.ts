import { app, screen, type BrowserWindow, type Rectangle } from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

export interface StoredWindowState {
  bounds: Rectangle;
  maximized: boolean;
}

const statePath = (key = "main-window"): string => join(app.getPath("userData"), "settings", `${key}.json`);

const isRectangle = (value: unknown): value is Rectangle => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Rectangle>;
  return [candidate.x, candidate.y, candidate.width, candidate.height].every((item) => typeof item === "number" && Number.isFinite(item));
};

/** 把窗口 bounds 钳制到指定工作区内，确保完全落在该区域（不跨屏、不回中贴边）。 */
export const clampBoundsToWorkArea = (bounds: Rectangle, area: Rectangle): Rectangle => {
  const width = Math.min(Math.max(1, Math.round(bounds.width)), Math.round(area.width));
  const height = Math.min(Math.max(1, Math.round(bounds.height)), Math.round(area.height));
  const x = Math.min(Math.max(Math.round(bounds.x), Math.round(area.x)), Math.round(area.x) + Math.round(area.width) - width);
  const y = Math.min(Math.max(Math.round(bounds.y), Math.round(area.y)), Math.round(area.y) + Math.round(area.height) - height);
  return { x, y, width, height };
};

/**
 * 决定恢复窗口时应放置的位置：
 * - 只在「横跨多个显示器」时才归位到主屏（避免窗口横在 1 号屏和 2 号屏之间）；
 * - 若窗口只落在单个显示器内（即便略超出 workArea 边界），保持原位置不动，
 *   这既满足"不跨屏"，又保留用户设定的位置、不强制缩小。
 */
export const resolveWindowPlacement = (
  bounds: Rectangle,
  displays: ReadonlyArray<{ workArea: Rectangle }>,
  primaryWorkArea: Rectangle
): Rectangle => {
  const intersecting = displays.filter((display) => {
    const area = display.workArea;
    return Math.max(bounds.x, area.x) < Math.min(bounds.x + bounds.width, area.x + area.width) &&
      Math.max(bounds.y, area.y) < Math.min(bounds.y + bounds.height, area.y + area.height);
  }).length;
  if (intersecting <= 1) return bounds;
  return clampBoundsToWorkArea(bounds, primaryWorkArea);
};

export const normalizeWindowState = (value: unknown, displays: ReadonlyArray<{ workArea: Rectangle }> = screen.getAllDisplays(), options: { minimumWidth?: number; minimumHeight?: number } = {}): StoredWindowState | null => {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<StoredWindowState>;
  if (!isRectangle(candidate.bounds) || typeof candidate.maximized !== "boolean") return null;
  const bounds = candidate.bounds;
  const minimumWidth = options.minimumWidth ?? 1100;
  const minimumHeight = options.minimumHeight ?? 720;
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

export const loadWindowState = async (key = "main-window", options: { minimumWidth?: number; minimumHeight?: number } = {}): Promise<StoredWindowState | null> => {
  try {
    return normalizeWindowState(JSON.parse(await readFile(statePath(key), "utf8")), undefined, options);
  } catch {
    return null;
  }
};

export const saveWindowState = async (window: BrowserWindow, key = "main-window"): Promise<void> => {
  const state: StoredWindowState = { bounds: window.getNormalBounds(), maximized: window.isMaximized() };
  const target = statePath(key);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(state, null, 2), "utf8");
  await rename(temporary, target);
};

export const attachWindowStatePersistence = (window: BrowserWindow, key = "main-window"): (() => void) => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let detached = false;
  const persist = (): void => {
    if (detached) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void saveWindowState(window, key).catch(() => undefined);
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
