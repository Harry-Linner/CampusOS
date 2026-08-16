import { describe, expect, it } from "vitest";
import { normalizeWindowState } from "./windowStateStore";

const displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }];

describe("window state store", () => {
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
