import { test, expect, _electron as electron } from "@playwright/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("recurrence editing keeps the occurrence reminder and rejected drafts, with SQLite notification recovery", async () => {
  const profile = await mkdtemp(join(tmpdir(), "campusos-recovery-e2e-"));
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const rootStart = new Date(Date.parse(`${today}T09:00:00+08:00`) - 4 * 86_400_000);
  const legacy = { id: "fixture-notification", title: "Fixture notification", body: "SQLite recovery fixture", kind: "system", state: "unread", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString(), actionTarget: "schedule", source: "system" };
  await mkdir(join(profile, "notifications"));
  await writeFile(join(profile, "notifications/notifications.json"), JSON.stringify([legacy]));
  const launch = () => electron.launch({ args: [resolve("out/main/main.js"), `--user-data-dir=${profile}`], env: { ...process.env, CAMPUSOS_E2E_FIXTURE: "1" } });
  let app = await launch();
  try {
    const main = await app.firstWindow();
    const created = await main.evaluate((startAt) => window.campusos.schedule.saveTask({
      title: "Recurrence acceptance", description: "", timeSpentMinutes: 0, timeNeededMinutes: 60,
      startAt, endAt: new Date(Date.parse(startAt) + 3_600_000).toISOString(), location: "",
      breakable: false, blocksPlanning: false, type: "fixed", repeatType: "days", repeatPeriod: 1,
      repeatEndMode: "count", repeatCount: 10, repeatEndsOn: startAt.slice(0, 10),
      reminderMode: "custom", reminderAt: new Date(Date.parse(startAt) - 1_800_000).toISOString()
    }), rootStart.toISOString());
    const taskId = created.operation!.taskId!;
    for (const name of ["开始配置", "开发模式跳过认证", "开始同步", "确认，继续", "安装选中插件", "保存并继续", "进入 CampusOS"]) {
      await main.getByRole("button", { name, exact: true }).click();
    }
    await main.getByRole("button", { name: "日程", exact: true }).click();
    await main.getByRole("button", { name: "日视图", exact: true }).click();
    await main.getByRole("button", { name: "今天", exact: true }).click();
    await main.getByRole("button", { name: "Recurrence acceptance", exact: true }).dblclick();
    await expect(main.getByLabel("提醒时间", { exact: true })).toHaveValue(`${today}T08:30`);
    // Clicks/double-clicks must not enter the drag-save path or create an override.
    expect((await main.evaluate(() => window.campusos.schedule.loadTasks())).tasks.find((task) => task.id === taskId)?.occurrenceOverrides).toEqual({});
    await main.getByLabel("标题", { exact: true }).fill("Series acceptance");
    await main.getByLabel(/编辑范围/).selectOption("series");
    await main.getByRole("button", { name: "保存任务", exact: true }).click();
    const series = (await main.evaluate(() => window.campusos.schedule.loadTasks())).tasks.find((task) => task.id === taskId)!;
    expect(series.startAt).toBe(rootStart.toISOString());
    expect(series.reminderAt).toBe(new Date(rootStart.getTime() - 1_800_000).toISOString());
    expect(series.occurrenceOverrides).toEqual({});
    const eventButton = main.getByRole("button", { name: "Series acceptance", exact: true });
    await eventButton.scrollIntoViewIfNeeded();
    const eventBox = (await eventButton.boundingBox())!;
    const timeline = (await main.locator(".schedule-day-timeline").boundingBox())!;
    await main.mouse.move(eventBox.x + eventBox.width / 2, eventBox.y + 10);
    await main.mouse.down();
    await main.mouse.move(eventBox.x + eventBox.width / 2, eventBox.y + 10 + timeline.height / 48, { steps: 5 });
    await main.mouse.up();
    await expect.poll(async () => (await main.evaluate(() => window.campusos.schedule.loadTasks())).tasks.find((task) => task.id === taskId)?.occurrenceOverrides?.["4"]?.reminderAt)
      .toBe(new Date(`${today}T09:00:00+08:00`).toISOString());
    const opened = app.waitForEvent("window");
    await main.evaluate(() => window.campusos.desktopCalendarHost.start());
    const desk = await opened;
    await desk.getByRole("button", { name: "日", exact: true }).click();
    await desk.getByText("Series acceptance", { exact: true }).first().dblclick();
    await expect(desk.getByLabel("提醒时间", { exact: true })).toHaveValue(`${today}T09:00`);
    await desk.getByLabel("名称", { exact: true }).fill("Edited occurrence");
    await desk.getByRole("button", { name: "保存", exact: true }).click();
    await expect(desk.getByLabel("名称", { exact: true })).toHaveCount(0);
    const saved = await main.evaluate(() => window.campusos.schedule.loadTasks());
    expect(saved.tasks.find((task) => task.id === taskId)?.occurrenceOverrides?.["4"]?.reminderAt)
      .toBe(new Date(`${today}T09:00:00+08:00`).toISOString());
    await desk.getByText("Edited occurrence", { exact: true }).first().dblclick();
    await desk.getByLabel(/编辑范围/).selectOption("series");
    await desk.locator("select").filter({ has: desk.locator('option[value="never"]') }).selectOption("date");
    await desk.getByLabel("结束日期", { exact: true }).fill(new Date(rootStart.getTime() - 86_400_000).toISOString().slice(0, 10));
    await desk.getByRole("button", { name: "保存", exact: true }).click();
    await expect(desk.getByRole("alert")).toContainText("重复结束日期");
    await expect(desk.getByLabel("名称", { exact: true })).toHaveValue("Edited occurrence");
    await desk.screenshot({ path: test.info().outputPath("invalid-range-draft.png") });
    expect((await main.evaluate(() => window.campusos.schedule.loadTasks())).tasks).toEqual(saved.tasks);
    await main.evaluate(() => window.campusos.notifications.markHandled("fixture-notification"));
    await app.close();
    app = await launch();
    const reopened = await app.firstWindow();
    expect((await reopened.evaluate(() => window.campusos.notifications.load())).find((item) => item.id === "fixture-notification")?.state).toBe("handled");
    expect((await reopened.evaluate(() => window.campusos.schedule.loadTasks())).tasks.find((task) => task.id === taskId)?.occurrenceOverrides?.["4"]?.title).toBe("Edited occurrence");
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});
