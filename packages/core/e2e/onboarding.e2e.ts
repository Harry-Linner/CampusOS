import { expect, test, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("renders the first-run onboarding with its stylesheet in Electron", async ({ browserName: _browserName }, testInfo) => {
  void _browserName;
  const userDataPath = await mkdtemp(join(tmpdir(), "campusos-e2e-"));
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
  const stderr: string[] = [];
  app.process().stderr?.on("data", (chunk: Buffer) => {
    stderr.push(chunk.toString("utf8"));
  });

  try {
    let page;
    try {
      page = await app.firstWindow({ timeout: 10_000 });
    } catch (error) {
      await testInfo.attach("electron-stderr.txt", {
        body: Buffer.from(stderr.join(""), "utf8"),
        contentType: "text/plain"
      });
      throw error;
    }
    await expect(page.getByRole("button", { name: "开始配置" })).toBeVisible();
    await expect(page.getByText("把校园事务放回一个清晰的工作台。"))
      .toBeVisible();

    await expect(page.locator(".onboarding-shell")).toHaveCSS("display", "grid");
    await expect(page.locator(".onboarding-card")).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await page.screenshot({
      path: testInfo.outputPath("onboarding-first-run.png"),
      fullPage: true
    });

    await page.getByRole("button", { name: "开始配置" }).click();
    await expect(page.getByRole("heading", { name: "连接 ZJU 统一认证" }))
      .toBeVisible();
  } finally {
    await app.close();
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("takes a fixture-backed onboarding through the calendar using real Electron IPC", async ({ browserName: _browserName }) => {
  void _browserName;
  const userDataPath = await mkdtemp(join(tmpdir(), "campusos-e2e-"));
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
    await page.getByRole("button", { name: "开始配置" }).click();
    await page.getByRole("button", { name: "开发模式跳过认证" }).click();
    await page.getByRole("button", { name: "开始同步" }).click();
    await expect(page.getByText("看起来对吗？")).toBeVisible();

    await page.getByRole("button", { name: "确认，继续" }).click();
    await expect(page.getByRole("heading", { name: "推荐扩展" })).toBeVisible();
    await page.getByRole("button", { name: "安装选中插件" }).click();
    await expect(page.getByRole("heading", { name: "一切就绪" })).toBeVisible();

    await page.getByRole("button", { name: "进入 CampusOS" }).click();
    await page.getByRole("button", { name: "日历" }).click();
    await expect(
      page.getByRole("button", { name: /软件工程课程设计/ })
    ).toBeVisible();
  } finally {
    await app.close();
    await rm(userDataPath, { recursive: true, force: true });
  }
});
