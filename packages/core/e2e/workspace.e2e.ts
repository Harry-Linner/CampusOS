import { expect, test, _electron as electron, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const completeOnboarding = async (page: Page): Promise<void> => {
  await page.getByRole("button", { name: "开始配置" }).click();
  await page.getByRole("button", { name: "开发模式跳过认证" }).click();
  await page.getByRole("button", { name: "开始同步" }).click();
  await page.getByRole("button", { name: "确认，继续" }).click();
  await page.getByRole("button", { name: "安装选中插件" }).click();
  await page.getByRole("button", { name: "进入 CampusOS" }).click();
};

const expectNoRootOverflow = async (page: Page): Promise<void> => {
  await expect.poll(() => page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }))).toEqual(expect.objectContaining({
    clientWidth: expect.any(Number),
    scrollWidth: expect.any(Number)
  }));
  const widths = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(widths.scrollWidth).toBeLessThanOrEqual(widths.clientWidth + 1);
};

const settleView = async (page: Page): Promise<void> => {
  await page.locator(".view-stage").evaluate(async (element) => {
    await Promise.all(
      element.getAnimations({ subtree: true }).map((animation) => animation.finished)
    );
  });
};

test("validates the complete fixture-backed workspace at desktop and narrow widths", async ({ browserName: _browserName }, testInfo) => {
  void _browserName;
  const userDataPath = await mkdtemp(join(tmpdir(), "campusos-workspace-e2e-"));
  const app = await electron.launch({
    args: [
      join(packageRoot, "out/main/main.js"),
      `--user-data-dir=${userDataPath}`
    ],
    env: {
      ...process.env,
      CAMPUSOS_E2E_FIXTURE: "1"
    }
  });

  try {
    const page = await app.firstWindow({ timeout: 10_000 });
    await page.setViewportSize({ width: 1440, height: 960 });
    await completeOnboarding(page);

    await page.getByLabel("主导航").getByRole("button", { name: "学业" }).click();
    for (const label of ["课表", "课程", "考试", "成绩", "素拓"]) {
      await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
    }
    await settleView(page);
    await expectNoRootOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("academic-desktop.png"),
      fullPage: true
    });

    await page.getByLabel("主导航").getByRole("button", { name: "日程" }).click();
    for (const label of ["月历", "周视图", "日程", "日视图"]) {
      await expect(
        page.getByLabel("日历视图").getByRole("button", { name: label, exact: true })
      ).toBeVisible();
    }
    await expect(page.getByRole("heading", { name: "接下来 48 小时" })).toBeVisible();
    await settleView(page);
    await expectNoRootOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("schedule-desktop.png"),
      fullPage: true
    });

    await page.getByLabel("主导航").getByRole("button", { name: "资料" }).click();
    await expect(page.getByRole("button", { name: "课程资料", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "下载队列", exact: true })).toBeVisible();
    await settleView(page);
    await expectNoRootOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("materials-desktop.png"),
      fullPage: true
    });

    await page.getByRole("button", { name: "搜索" }).click();
    const search = page.getByRole("searchbox", { name: "搜索课程、事项和资料" });
    await search.fill("软件工程");
    await expect(page.getByRole("dialog", { name: "全局搜索" })).toBeVisible();
    await expect(page.locator(".global-search-results li").first()).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByLabel("应用设置").getByRole("button", { name: "设置" }).click();
    await expect(page.getByRole("heading", { name: "更新" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "关于" })).toBeVisible();
    await expect(page.getByText("MIT", { exact: true })).toBeVisible();
    await page.getByRole("checkbox", { name: "启用桌面通知" }).uncheck();
    await page.getByRole("checkbox", { name: "启用成绩变化通知" }).uncheck();
    await page.getByRole("button", { name: "保存提醒" }).click();
    await expect(page.getByText("已保存", { exact: true })).toBeVisible();
    await expect.poll(async () => page.evaluate(async () =>
      window.campusos?.reminders.loadScheduleState()
    )).toMatchObject({
      enabled: false,
      scheduledCount: 0,
      nextFireAt: null
    });
    await expect.poll(async () => page.evaluate(async () =>
      window.campusos?.reminders.loadSettings()
    )).toMatchObject({
      gradeChangesEnabled: false
    });
    await settleView(page);
    await expectNoRootOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("settings-desktop.png"),
      fullPage: true
    });

    await page.setViewportSize({ width: 820, height: 900 });
    await page.getByLabel("主导航").getByRole("button", { name: "学业" }).click();
    await settleView(page);
    await expectNoRootOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("academic-narrow.png"),
      fullPage: true
    });

    await page.getByLabel("主导航").getByRole("button", { name: "资料" }).click();
    await settleView(page);
    await expectNoRootOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("materials-narrow.png"),
      fullPage: true
    });

    await page.getByLabel("主导航").getByRole("button", { name: "日程" }).click();
    await settleView(page);
    await expectNoRootOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("schedule-narrow.png"),
      fullPage: true
    });
  } finally {
    await app.close();
    await rm(userDataPath, { recursive: true, force: true });
  }
});
