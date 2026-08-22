/* Diagnostic: verify theme switching + legacy styles survive the shadcn Phase A
 * layer contract. Prints computed evidence; run from packages/core. */
import { _electron as electron } from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const themes = ["light", "dark", "high-contrast"];
const userDataPath = await mkdtemp(join(tmpdir(), "campusos-theme-check-"));

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
    const probe = await page.evaluate(() => {
      const root = document.documentElement;
      const body = getComputedStyle(document.body);
      const rootStyle = getComputedStyle(root);
      const primaryButton = document.querySelector(".primary-button");
      const buttonBg = primaryButton ? getComputedStyle(primaryButton).backgroundColor : "n/a";
      const get = (name) => rootStyle.getPropertyValue(name).trim();
      return {
        dataTheme: root.getAttribute("data-theme"),
        bodyBackground: body.backgroundColor,
        legacyInk: get("--ink"),
        legacyAccent: get("--accent"),
        legacyWarning: get("--warning"),
        shadcnBackground: get("--background"),
        shadcnPrimary: get("--primary"),
        shadcnRing: get("--ring"),
        primaryButtonBackground: buttonBg,
        appShellPresent: Boolean(document.querySelector(".app-shell"))
      };
    });
    console.log(theme, JSON.stringify(probe));
  }
} finally {
  await app.close();
  await rm(userDataPath, { recursive: true, force: true });
}
