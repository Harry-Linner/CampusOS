import { expect, test, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const launch = (userDataPath: string, extraArgs: string[] = []): Promise<ElectronApplication> => electron.launch({
  args: [join(packageRoot, "out/main/main.js"), `--user-data-dir=${userDataPath}`, ...extraArgs],
  env: { ...process.env, CAMPUSOS_E2E_FIXTURE: "1" }
});

const completeOnboarding = async (page: Page): Promise<void> => {
  await page.getByRole("button", { name: "开始配置" }).click();
  await page.getByRole("button", { name: "开发模式跳过认证" }).click();
  await page.getByRole("button", { name: "开始同步" }).click();
  await page.getByRole("button", { name: "确认，继续" }).click();
  await page.getByRole("button", { name: "安装选中插件" }).click();
  await page.getByRole("button", { name: "保存并继续" }).click();
  await page.getByRole("button", { name: "进入 CampusOS" }).click();
  const assistantSetup = page.getByRole("dialog", { name: "先配置 AI 连接" });
  if (await assistantSetup.isVisible()) await assistantSetup.getByRole("button", { name: "稍后配置" }).click();
};

test("persists close choice, window bounds, hidden startup, and rejects off-screen state", async () => {
  test.setTimeout(120_000);
  const userDataPath = await mkdtemp(join(tmpdir(), "campusos-lifecycle-e2e-"));
  const settingsDirectory = join(userDataPath, "settings");
  let app = await launch(userDataPath);

  try {
    let page = await app.firstWindow({ timeout: 10_000 });
    page.setDefaultTimeout(15_000);
    await page.waitForLoadState("domcontentloaded");
    await completeOnboarding(page);

    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: true }) as never;
    });
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find((window) => !window.isDestroyed())?.close();
    });
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible())).toBe(false);
    await expect.poll(async () => JSON.parse(await readFile(join(settingsDirectory, "app-lifecycle.json"), "utf8")).closeBehavior).toBe("hide-to-tray");

    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window?.show();
      window?.setBounds({ x: 160, y: 120, width: 1100, height: 720 });
    });
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 600));
    await app.close();
    const storedWindowState = JSON.parse(
      await readFile(join(settingsDirectory, "main-window.json"), "utf8")
    ) as { bounds: { x: number; y: number; width: number; height: number } };
    expect(storedWindowState.bounds.x).toBe(160);
    expect(storedWindowState.bounds.y).toBe(120);
    expect(storedWindowState.bounds.width).toBeGreaterThanOrEqual(1100);
    expect(storedWindowState.bounds.height).toBeGreaterThanOrEqual(720);

    app = await launch(userDataPath);
    page = await app.firstWindow({ timeout: 10_000 });
    const restored = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getBounds());
    expect(restored?.x).toBe(storedWindowState.bounds.x);
    expect(restored?.y).toBe(storedWindowState.bounds.y);
    expect(Math.abs((restored?.width ?? 0) - storedWindowState.bounds.width)).toBeLessThanOrEqual(4);
    expect(Math.abs((restored?.height ?? 0) - storedWindowState.bounds.height)).toBeLessThanOrEqual(4);
    await app.close();

    app = await launch(userDataPath, ["--hidden"]);
    await app.firstWindow({ timeout: 10_000 });
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible())).toBe(false);
    await app.close();

    await mkdir(settingsDirectory, { recursive: true });
    await writeFile(join(settingsDirectory, "main-window.json"), JSON.stringify({
      bounds: { x: 5000, y: 5000, width: 1180, height: 760 },
      maximized: false
    }), "utf8");
    app = await launch(userDataPath);
    await app.firstWindow({ timeout: 10_000 });
    const recovered = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getBounds());
    expect(recovered?.x).toBeLessThan(5000);
    expect(recovered?.y).toBeLessThan(5000);
  } finally {
    await app.close().catch(() => undefined);
    await rm(userDataPath, { recursive: true, force: true });
  }
});
