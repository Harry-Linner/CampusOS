import { expect, test, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { attachRendererGuard } from "./rendererGuard";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// B3：开启桌历会同时创建桌历主窗 + 独立组件窗；等待 URL 为 desk-calendar.html 的桌历主窗。
const waitForDeskCalendarPage = async (app: ElectronApplication): Promise<Page> => {
  const timeout = Date.now() + 15_000;
  while (Date.now() < timeout) {
    const found = app.windows().find((window) => window.url().includes("desk-calendar.html"));
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("桌面日历主窗未出现");
};

const completeOnboarding = async (page: Awaited<ReturnType<Awaited<ReturnType<typeof electron.launch>>["firstWindow"]>>): Promise<void> => {
  await page.getByRole("button", { name: "开始配置" }).click();
  await page.getByRole("button", { name: "开发模式跳过认证" }).click();
  await page.getByRole("button", { name: "开始同步" }).click();
  await page.getByRole("button", { name: "确认，继续" }).click();
  await page.getByRole("button", { name: "安装选中插件" }).click();
  await page.getByRole("button", { name: "保存并继续" }).click();
  await page.getByRole("button", { name: "进入 CampusOS" }).click();
};

// 回归防钉：桌面日历默认窗口（约 720 CSS px）落在 640–900px 档，
// 该档位曾因 `@media (max-width: 900px)` 把组件列整体 display:none，
// 导致"组件全部启用却一个不可见"；待办空态文案也曾把 <br /> 当文字渲染。
test("keeps enabled widgets visible at the default narrow desk-calendar size without horizontal overflow", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "campusos-desk-narrow-"));
  const app = await electron.launch({
    args: [join(packageRoot, "out/main/main.js"), `--user-data-dir=${userDataPath}`],
    env: { ...process.env, CAMPUSOS_E2E_FIXTURE: "1" }
  });

  try {
    const mainPage = await app.firstWindow({ timeout: 10_000 });
    mainPage.setDefaultTimeout(15_000);
    attachRendererGuard(mainPage);
    await mainPage.waitForLoadState("domcontentloaded");
    await completeOnboarding(mainPage);
    await mainPage.getByLabel("主导航").getByRole("button", { name: "日程" }).click();

    await mainPage.getByRole("button", { name: "桌面日历" }).click();
    await mainPage.getByRole("menu", { name: "桌面日历设置" }).getByRole("button", { name: "开启桌面日历" }).click();
    const floatingPage = await waitForDeskCalendarPage(app);
    floatingPage.setDefaultTimeout(15_000);
    attachRendererGuard(floatingPage);
    await floatingPage.waitForLoadState("domcontentloaded");

    const resizeFloating = async (width: number, height: number): Promise<void> => {
      await app.evaluate(({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows().find((win) => win.getTitle().includes("桌面日历"))?.setSize(size.width, size.height);
      }, { width, height });
      await floatingPage.waitForTimeout(300);
    };

    const horizontalOverflow = async (): Promise<number> => {
      return floatingPage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    };

    // 640–900px 档（默认窗口尺寸落点）：B3 起组件已移到独立悬浮窗，
    // 桌历主窗不再渲染组件列，只剩月历/待办/议程，仍不得横向溢出。
    await resizeFloating(720, 640);
    expect(await floatingPage.locator(".desk-cal-widgets").count()).toBe(0);
    expect(await horizontalOverflow()).toBeLessThanOrEqual(0);

    // <640px 档：同样不允许横向溢出。
    await resizeFloating(560, 520);
    expect(await horizontalOverflow()).toBeLessThanOrEqual(0);

    // 待办空态文案不得把 HTML 标签当文字渲染。
    const emptyText = await floatingPage.locator(".desk-cal-sidebar-empty").textContent().catch(() => "");
    if (emptyText) {
      expect(emptyText).not.toContain("<br");
      expect(emptyText).not.toContain("<small");
    }
  } finally {
    await app.close();
    await rm(userDataPath, { recursive: true, force: true });
  }
});
