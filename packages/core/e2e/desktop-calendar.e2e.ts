import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import koffi from "koffi";
import { desktopPort, connectDesktop, calendarPanel, closeCalendarPanel } from "./desktopFixture";

test("calendar startup unlocks live after enabling CampusOS login startup", async () => {
  test.setTimeout(120000);
  const profile = await mkdtemp(join(tmpdir(), "campusos-startup-e2e-"));
  const port = await desktopPort();
  const app = await electron.launch({ args: [resolve("out/main/main.js"), `--user-data-dir=${profile}`], env: { ...process.env, CAMPUSOS_E2E_FIXTURE: "1", CAMPUSOS_DESKTOP_CDP_PORT: port } });
  try {
    const main = await app.firstWindow();
    await main.evaluate(() => window.campusos.desktopCalendarHost.start());
    const desk = await connectDesktop(app, port);
    const panel = await calendarPanel(app, desk, () => desk.getByRole("button", { name: "⚙ 设置" }).click());
    const startup = panel.getByRole("checkbox", { name: "随 CampusOS 开机恢复" });
    const hint = panel.getByText("请先在 CampusOS 设置中开启“开机启动”。", { exact: true });
    await expect(startup).toBeDisabled();
    await expect(hint).toBeVisible();
    await main.evaluate(() => window.campusos.lifecycle.save({ launchAtLogin: true }));
    await expect(startup).toBeEnabled();
    await expect(hint).toHaveCount(0);
    await startup.click();
    await expect(startup).toBeChecked();
    await expect.poll(() => desk.evaluate(async () => (await window.deskCalendar!.getSettings()).autoStart)).toBe(true);
    await closeCalendarPanel(panel);
    const reopened = await calendarPanel(app, desk, () => desk.getByRole("button", { name: "⚙ 设置" }).click());
    await expect(reopened.getByRole("checkbox", { name: "随 CampusOS 开机恢复" })).toBeChecked();
    await main.evaluate(() => window.campusos.lifecycle.save({ launchAtLogin: false }));
    await expect(reopened.getByRole("checkbox", { name: "随 CampusOS 开机恢复" })).toBeDisabled();
    await expect(reopened.getByRole("checkbox", { name: "随 CampusOS 开机恢复" })).not.toBeChecked();
    await main.evaluate(() => window.campusos.lifecycle.save({ launchAtLogin: true }));
    await expect(reopened.getByRole("checkbox", { name: "随 CampusOS 开机恢复" })).toBeEnabled();
    await expect(reopened.getByRole("checkbox", { name: "随 CampusOS 开机恢复" })).not.toBeChecked();
  } finally {
    await app.evaluate(({ app: electronApp }) => electronApp.setLoginItemSettings({ openAtLogin: false }));
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test("desktop calendar isolates DPI, saves through primary IPC and closes its native host", async () => {
  test.setTimeout(120000);
  const profile = await mkdtemp(join(tmpdir(), "campusos-desk-e2e-"));
  const port = await desktopPort();
  const app = await electron.launch({ args: [resolve("out/main/main.js"), `--user-data-dir=${profile}`], env: { ...process.env, CAMPUSOS_E2E_FIXTURE: "1", CAMPUSOS_DESKTOP_CDP_PORT: port } });
  try {
    const main = await app.firstWindow();
    const before = await main.evaluate(() => ({ ratio: devicePixelRatio, width: innerWidth, height: innerHeight }));
    for (let cycle = 0; cycle < 3; cycle++) {
      await main.evaluate(() => Promise.all([window.campusos.desktopCalendarHost.start(), window.campusos.desktopCalendarHost.start()]));
      const desk = await connectDesktop(app, port);
      await expect(desk.getByRole("button", { name: "周", exact: true })).toBeVisible();
      await desk.getByRole("button", { name: "周", exact: true }).click();
      await expect(desk.getByRole("button", { name: "周", exact: true })).toHaveClass("is-active");
      expect(await main.evaluate(() => ({ ratio: devicePixelRatio, width: innerWidth, height: innerHeight }))).toEqual(before);
      const settings = await calendarPanel(app, desk, () => desk.getByRole("button", { name: "⚙ 设置" }).click());
      await expect(settings.getByRole("heading", { name: "日历设置", exact: true })).toBeVisible();
      await settings.getByLabel("农历", { exact: true }).click();
      await expect.poll(() => desk.evaluate(async () => (await window.deskCalendar!.getSettings()).showLunar)).toBe(cycle % 2 === 0);
      await closeCalendarPanel(settings);
      if (process.platform === "win32") {
        const session = await desk.context().browser()!.newBrowserCDPSession();
        const info = await session.send("SystemInfo.getProcessInfo");
        const pid = info.processInfo.find(item => item.type === "browser")!.id;
        expect(pid).not.toBe(app.process().pid);
        const lib = koffi.load("user32.dll");
        const callbackType = koffi.proto(`bool __stdcall CampusDesktopEnum${cycle}(uintptr_t hwnd, intptr_t arg)`);
        const enumChildren = lib.func("EnumChildWindows", "bool", ["uintptr_t", koffi.pointer(callbackType), "intptr_t"]);
        const threadPid = lib.func("GetWindowThreadProcessId", "uint32", ["uintptr_t", koffi.out(koffi.pointer("uint32"))]);
        const parentOf = lib.func("GetParent", "uintptr_t", ["uintptr_t"]);
        const style = lib.func("GetWindowLongPtrW", "intptr_t", ["uintptr_t", "int32"]);
        const desktop = lib.func("GetDesktopWindow", "uintptr_t", []);
        let hwnd = 0;
        const callback = koffi.register((handle: number) => { const result = [0]; threadPid(handle, result); if (result[0] === pid && (Number(style(handle, -16)) & 0x40000000) !== 0) hwnd = Number(handle); return true; }, koffi.pointer(callbackType));
        try { enumChildren(desktop(), callback, 0); } finally { koffi.unregister(callback); }
        expect(hwnd).toBeGreaterThan(0);
        expect(Number(parentOf(hwnd))).toBeGreaterThan(0);
        expect(Number(style(hwnd, -20)) & 8).toBe(0);
        await session.detach();
      }
      await desk.getByRole("button", { name: "月", exact: true }).click();
      const editor = await calendarPanel(app, desk, () => desk.locator(".dk-month-cell.is-today time").dblclick());
      await expect(editor.getByRole("heading", { name: "新增事件" })).toBeVisible();
      await editor.getByLabel("名称", { exact: true }).fill(`Desktop persistence ${cycle}`);
      await editor.getByRole("button", { name: "保存", exact: true }).click();
      await expect.poll(() => main.evaluate(async () => (await window.campusos.schedule.loadTasks()).tasks.length)).toBe(cycle + 1);
      await expect(desk.getByText(`Desktop persistence ${cycle}`, { exact: true })).toBeVisible();
      await main.evaluate(() => window.campusos.desktopCalendarHost.stop());
      await expect.poll(() => main.evaluate(() => window.campusos.desktopCalendarHost.status())).toEqual({ running: false });
      if (process.platform === "win32") await expect.poll(() => desk.isClosed()).toBe(true);
    }
    if (process.platform === "win32") {
      await main.evaluate(() => window.campusos.desktopCalendarHost.start());
      const crashed = await connectDesktop(app, port);
      const session = await crashed.context().browser()!.newBrowserCDPSession();
      const info = await session.send("SystemInfo.getProcessInfo");
      const pid = info.processInfo.find(item => item.type === "browser")!.id;
      process.kill(pid); // Only this test's isolated host; primary owns recovery.
      await expect.poll(() => crashed.isClosed()).toBe(true);
      await expect.poll(() => main.evaluate(() => window.campusos.desktopCalendarHost.status()), { timeout: 15000 }).toEqual({ running: true });
      const recovered = await connectDesktop(app, port);
      await expect(recovered.getByText("Desktop persistence 2", { exact: true })).toBeVisible();
      await main.evaluate(() => window.campusos.desktopCalendarHost.stop());
    }
  } finally { await app.close(); await rm(profile, { recursive: true, force: true }); }
});
