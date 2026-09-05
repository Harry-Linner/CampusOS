import { expect, test, _electron as electron, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { attachRendererGuard } from "./rendererGuard";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const completeOnboarding = async (page: Page): Promise<void> => {
  await page.getByRole("button", { name: "开始配置" }).click();
  await page.getByRole("button", { name: "开发模式跳过认证" }).click();
  await page.getByRole("button", { name: "开始同步" }).click();
  await page.getByRole("button", { name: "确认，继续" }).click();
  await page.getByRole("button", { name: "安装选中插件" }).click();
  await page.getByRole("button", { name: "保存并继续" }).click();
  await page.getByRole("button", { name: "进入 CampusOS" }).click();
};

test("renders the dashboard overview without renderer crashes across the loading transition", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "campusos-dashboard-e2e-"));
  const app = await electron.launch({
    args: [join(packageRoot, "out/main/main.js"), `--user-data-dir=${userDataPath}`],
    env: { ...process.env, CAMPUSOS_E2E_FIXTURE: "1" }
  });

  try {
    const page = await app.firstWindow({ timeout: 10_000 });
    page.setDefaultTimeout(15_000);
    // 守卫：渲染器任何未捕获异常 / console.error 立即失败测试。
    attachRendererGuard(page);
    await page.waitForLoadState("domcontentloaded");
    await completeOnboarding(page);

    // 总览（DashboardView）是默认视图；fixture 工作区应渲染出课程预览内容。
    await expect(page.getByRole("heading", { name: "今日事项预览" })).toBeVisible();

    // 切到其它视图再切回，反复经过 DashboardView 挂载/卸载路径。
    await page.getByLabel("应用设置").getByRole("button", { name: "设置" }).click();
    await expect(page.getByRole("heading", { name: "设置", exact: true })).toBeVisible();
    await page.getByLabel("主导航").getByRole("button", { name: "总览" }).click();
    await expect(page.getByRole("heading", { name: "今日事项预览" })).toBeVisible();
  } finally {
    await app.close();
    await rm(userDataPath, { recursive: true, force: true });
  }
});
