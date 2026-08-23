/* Manual visual-capture helper (NOT part of CI).
 * Launches the built CampusOS app and captures the dashboard + daily-brief
 * views in the three themes for Phase A visual-regression review.
 * Run from packages/core:  node scripts/capture-ui.mjs   (requires `pnpm build` first)
 */
import { _electron as electron } from "playwright";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = resolve(packageRoot, "..", ".tmp", "ui-capture");

const themes = ["light", "dark", "high-contrast"];

const userDataPath = await mkdtemp(join(tmpdir(), "campusos-capture-"));
await mkdir(outputRoot, { recursive: true });

const app = await electron.launch({
  args: [join(packageRoot, "out/main/main.js"), `--user-data-dir=${userDataPath}`],
  env: { ...process.env, CAMPUSOS_E2E_FIXTURE: "1" }
});

try {
  const page = await app.firstWindow({ timeout: 15_000 });
  page.setDefaultTimeout(15_000);
  await page.waitForLoadState("domcontentloaded");

  for (const theme of themes) {
    await page.evaluate((value) => {
      localStorage.setItem("campusos.theme", value);
      localStorage.setItem("campusos.onboarding.completed", "1");
    }, theme);
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await page.locator(".app-shell").waitFor({ timeout: 15_000 });
    // Let the dashboard settle after hydration.
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(outputRoot, `dashboard-${theme}.png`), fullPage: true });

    await page.locator('[data-activity-id="daily-brief"]').click();
    await page.getByRole("heading", { name: "早报", exact: true }).waitFor({ timeout: 15_000 });
    // Let the auto-generated refresh finish (fetch + AI attempt).
    await page.waitForTimeout(4000);
    await page.screenshot({ path: join(outputRoot, `brief-${theme}.png`), fullPage: true });
  }
  console.log("captured to", outputRoot);
} finally {
  await app.close();
  await rm(userDataPath, { recursive: true, force: true });
}
