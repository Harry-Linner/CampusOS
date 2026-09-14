import { prepareFixtureWorkspace } from "./fixtureWorkspace";
import { expect, test, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { attachRendererGuard } from "./rendererGuard";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");



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
    await prepareFixtureWorkspace(page);

    // 总览（DashboardView）是默认视图；fixture 工作区应渲染出课程预览内容。
    await expect(page.getByRole("heading", { name: "今日事项预览" })).toBeVisible();

    // 课表投影走真实链路：fixture 的课表事件由真实投影函数按官方校历规则产出，
    // 因此国庆假期当天（2026-10-05）不得出现在快照里。
    const courseDates = await page.evaluate(async () =>
      (await window.campusos.workspace.sync()).snapshot.calendarEvents
        .filter((event) => event.kind === "course")
        .map((event) => event.startAt.slice(0, 10))
        .sort()
    );
    expect(courseDates).toEqual(["2026-09-14", "2026-09-21", "2026-09-28"]);

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
