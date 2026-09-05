import { test, expect, _electron as electron } from "@playwright/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import koffi from "koffi";

test("desktop calendar has a working preload, native top-level input and bounded IPC lifecycle", async () => {
  const profile = await mkdtemp(join(tmpdir(), "campusos-desk-e2e-"));
  await mkdir(join(profile, "settings"));
  await writeFile(join(profile, "settings/desk-calendar-settings.json"), JSON.stringify({ alwaysOnTop: true, opacity: 0.9 }));
  const app = await electron.launch({
    args: [resolve("out/main/main.js"), `--user-data-dir=${profile}`],
    env: { ...process.env, CAMPUSOS_E2E_FIXTURE: "1" }
  });
  const channels = ["drag-move", "drag-end", "transparency", "close"].map((name) => `campusos:desk-calendar:${name}`);
  try {
    const main = await app.firstWindow();
    for (let cycle = 0; cycle < 3; cycle++) {
      const opened = app.waitForEvent("window");
      await main.evaluate(() => window.campusos.desktopCalendarHost.start());
      const desk = await opened;
      await desk.waitForLoadState();
      await expect.poll(() => desk.evaluate(() => typeof (window as unknown as { deskCalendar?: unknown }).deskCalendar)).toBe("object");
      await desk.getByRole("button", { name: "周", exact: true }).click();
      await expect(desk.getByRole("button", { name: "周", exact: true })).toHaveClass("is-active");
      await desk.getByRole("button", { name: "⚙ 设置" }).click();
      await expect(desk.getByRole("heading", { name: "日历设置", exact: true })).toBeVisible();
      await expect(desk.getByLabel("置顶", { exact: true })).toHaveCount(0);

      if (process.platform === "win32") {
        const hwnd = await app.evaluate(({ BrowserWindow }) => Number(BrowserWindow.getAllWindows()
          .find((win) => win.webContents.getURL().includes("desk-calendar"))!.getNativeWindowHandle().readBigUInt64LE()));
        const getAncestor = koffi.load("user32.dll").func("GetAncestor", "uintptr_t", ["uintptr_t", "uint32"]);
        // CDP bypasses desktop hit testing. At least enforce the native parent
        // invariant in CI; real coordinate clicks remain a local acceptance gate.
        expect(Number(getAncestor(hwnd, 2))).toBe(hwnd);
        const getStyle = koffi.load("user32.dll").func("GetWindowLongPtrW", "intptr_t", ["uintptr_t", "int32"]);
        await expect.poll(() => Number(getStyle(hwnd, -20)) & 8).toBe(0);
        const mainHwnd = await app.evaluate(({ BrowserWindow }) => Number(BrowserWindow.getAllWindows()
          .find((win) => !win.webContents.getURL().includes("desk-calendar"))!.getNativeWindowHandle().readBigUInt64LE()));
        const getWindow = koffi.load("user32.dll").func("GetWindow", "uintptr_t", ["uintptr_t", "uint32"]);
        await expect.poll(() => {
          const visited = new Set<number>();
          let current = mainHwnd;
          while (current && !visited.has(current) && visited.size < 1024) {
            if (current === hwnd) return true;
            visited.add(current);
            current = Number(getWindow(current, 2));
          }
          return false;
        }).toBe(true); // Activating the calendar must not put it above the main app.
        const showWindow = koffi.load("user32.dll").func("ShowWindow", "bool", ["uintptr_t", "int32"]);
        const isVisible = koffi.load("user32.dll").func("IsWindowVisible", "bool", ["uintptr_t"]);
        showWindow(hwnd, 0); // Simulate Explorer SW_HIDE, bypassing Electron's cache.
        await expect.poll(() => Boolean(isVisible(hwnd))).toBe(true);
      }
      const counts = await app.evaluate(({ ipcMain }, names) => names.map((name) => ipcMain.listenerCount(name)), channels);
      expect(counts).toEqual([1, 1, 1, 1]);
      await main.evaluate(() => window.campusos.desktopCalendarHost.stop());
      expect(await app.evaluate(({ ipcMain }, names) => names.map((name) => ipcMain.listenerCount(name)), channels)).toEqual([0, 0, 0, 0]);
    }
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});
