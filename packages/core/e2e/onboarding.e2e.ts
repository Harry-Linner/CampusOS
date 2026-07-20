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
    ]
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
