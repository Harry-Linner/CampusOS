import { describe, expect, it } from "vitest";
import { clampBoundsToWorkArea, normalizeWindowState } from "./windowStateStore";

const displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }];

describe("window state store", () => {
  it("clamps a cross-screen window fully back onto the target work area", () => {
    const area = { x: 0, y: 0, width: 1920, height: 1080 };
    // 横跨主屏右缘到 2 号屏：钳制后必须完全落在主屏内，且右缘 <= 主屏宽。
    const clamped = clampBoundsToWorkArea({ x: 1500, y: 200, width: 1280, height: 800 }, area);
    expect(clamped.x + clamped.width).toBeLessThanOrEqual(area.width);
    expect(clamped.x).toBe(area.width - clamped.width);
    expect(clamped).toMatchObject({ width: 1280, height: 800 });
  });

  it("clamps a window fully on a secondary display back into the target work area", () => {
    const area = { x: 0, y: 0, width: 1920, height: 1080 };
    const clamped = clampBoundsToWorkArea({ x: 2000, y: 100, width: 800, height: 600 }, area);
    expect(clamped.x).toBe(area.x + area.width - 800);
  });

  it("keeps bounds already fully inside the work area unchanged", () => {
    const area = { x: 0, y: 0, width: 1920, height: 1080 };
    expect(clampBoundsToWorkArea({ x: 120, y: 80, width: 1280, height: 800 }, area)).toEqual({ x: 120, y: 80, width: 1280, height: 800 });
  });

  it("keeps valid bounds and restores maximized state", () => {
    expect(normalizeWindowState({ bounds: { x: 120, y: 80, width: 1280, height: 800 }, maximized: true }, displays)).toEqual({
      bounds: { x: 120, y: 80, width: 1280, height: 800 },
      maximized: true
    });
  });

  it("rejects a window that is fully outside every display", () => {
    expect(normalizeWindowState({ bounds: { x: 4000, y: 4000, width: 1280, height: 800 }, maximized: false }, displays)).toBeNull();
  });

  it("enforces the application minimum dimensions", () => {
    expect(normalizeWindowState({ bounds: { x: 10, y: 10, width: 200, height: 200 }, maximized: false }, displays)?.bounds).toMatchObject({ width: 1100, height: 720 });
  });

  it("uses the desktop calendar minimum dimensions without inheriting main-window sizing", () => {
    expect(normalizeWindowState({ bounds: { x: 10, y: 10, width: 200, height: 200 }, maximized: false }, displays, { minimumWidth: 420, minimumHeight: 320 })?.bounds).toMatchObject({ width: 420, height: 320 });
  });
});
