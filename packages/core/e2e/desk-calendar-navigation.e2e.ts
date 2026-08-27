import { expect, test, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const completeOnboarding = async (page: Awaited<ReturnType<Awaited<ReturnType<typeof electron.launch>>["firstWindow"]>>): Promise<void> => {
  await page.getByRole("button", { name: "开始配置" }).click();
  await page.getByRole("button", { name: "开发模式跳过认证" }).click();
  await page.getByRole("button", { name: "开始同步" }).click();
  await page.getByRole("button", { name: "确认，继续" }).click();
  await page.getByRole("button", { name: "安装选中插件" }).click();
  await page.getByRole("button", { name: "保存并继续" }).click();
  await page.getByRole("button", { name: "进入 CampusOS" }).click();
};

test("jumps to the exact event from the desk calendar and keeps in-place detail on right-click", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "campusos-desk-navigation-"));
  const app = await electron.launch({
    args: [join(packageRoot, "out/main/main.js"), `--user-data-dir=${userDataPath}`],
    env: { ...process.env, CAMPUSOS_E2E_FIXTURE: "1" }
  });

  try {
    const mainPage = await app.firstWindow({ timeout: 10_000 });
    mainPage.setDefaultTimeout(15_000);
    await mainPage.waitForLoadState("domcontentloaded");
    await completeOnboarding(mainPage);
    await mainPage.getByLabel("主导航").getByRole("button", { name: "日程" }).click();

    const floatingWindowPromise = app.waitForEvent("window");
    await mainPage.getByRole("button", { name: "桌面日历" }).click();
    await mainPage.getByRole("menu", { name: "桌面日历设置" }).getByRole("button", { name: "开启桌面日历" }).click();
    const floatingPage = await floatingWindowPromise;
    floatingPage.setDefaultTimeout(15_000);
    await floatingPage.waitForLoadState("domcontentloaded");

    // Decision 二.2: clicking an event in the floating window jumps to the main
    // window and locates that event (reusing the navigation chain).
    await floatingPage.getByRole("button", { name: "软件工程课程设计", exact: true }).first().click();

    const detailDialog = mainPage.getByRole("dialog");
    await expect(detailDialog).toBeVisible();
    await expect(detailDialog.getByText("软件工程课程设计", { exact: true })).toBeVisible();
    // Close the detail dialog so the (inert) calendar background becomes reachable.
    await mainPage.getByRole("button", { name: "Close" }).click();
    await expect(mainPage.getByRole("dialog")).toBeHidden();
    await expect(
      mainPage.getByLabel("日历视图", { exact: true }).getByRole("button", { name: "日视图" })
    ).toHaveAttribute("aria-pressed", "true");

    // Decision 二.1/二.2: right-click keeps the in-place detail panel for tasks.
    await floatingPage.getByRole("button", { name: "软件工程课程设计", exact: true }).first().click({ button: "right" });
    await expect(floatingPage.getByLabel("安排详情")).toBeVisible();
    await floatingPage.getByRole("button", { name: "关闭详情" }).click();

    await floatingPage.getByRole("button", { name: "关闭桌面日历" }).click();
    await expect.poll(() => app.windows().length).toBe(1);
  } finally {
    await app.close();
    await rm(userDataPath, { recursive: true, force: true });
  }
});
