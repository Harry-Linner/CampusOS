import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, _electron as electron } from "@playwright/test";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const hash = (value: string): string =>
  createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");

const createInstalledPackage = async (userDataPath: string): Promise<void> => {
  const pluginId = "dev.example.hello";
  const rendererPath = "dist/renderer.js";
  const rendererSource = `export function mount(root, context) {
  root.textContent = "mounted:" + context.apiVersion + ":" + context.pluginId;
  return () => { root.textContent = "disposed"; };
}`;
  const manifest = {
    id: pluginId,
    name: "hello",
    displayName: "Hello CampusOS",
    version: "1.0.0",
    apiVersion: 2,
    kind: "feature",
    description: "Electron renderer sandbox fixture.",
    icon: "Box",
    permissions: ["storage:local"],
    sourceScope: ["local"],
    releaseStage: "ready",
    provides: [],
    requires: [],
    optionalRequires: [],
    contributes: {
      views: [{
        id: "hello-main",
        title: "Hello CampusOS",
        icon: "Box",
        location: "activity",
        activityTarget: "mod-dev-example-hello"
      }]
    }
  };
  const manifestSource = JSON.stringify({
    ...manifest,
    entrypoints: { renderer: rendererPath }
  });
  const pluginPath = join(userDataPath, "plugins", "installed", pluginId);
  await mkdir(join(pluginPath, "dist"), { recursive: true });
  await writeFile(join(pluginPath, "manifest.json"), manifestSource, "utf8");
  await writeFile(join(pluginPath, rendererPath), rendererSource, "utf8");
  await writeFile(
    join(pluginPath, ".campusmod-install.json"),
    JSON.stringify({
      dataVersion: 1,
      manifest,
      entrypoints: { renderer: rendererPath },
      archiveSize: Buffer.byteLength(rendererSource),
      unpackedSize: Buffer.byteLength(rendererSource),
      fileCount: 2,
      sha256: "0".repeat(64),
      signatureStatus: "unsigned",
      installedAt: new Date().toISOString(),
      sourceFilename: "hello.campusmod",
      files: {
        "manifest.json": hash(manifestSource),
        [rendererPath]: hash(rendererSource)
      }
    }),
    "utf8"
  );
  await writeFile(
    join(userDataPath, "plugins", "runtime-state.json"),
    JSON.stringify({
      dataVersion: 1,
      plugins: {
        [pluginId]: {
          enabled: true,
          grantedPermissions: ["storage:local"],
          updatedAt: new Date(0).toISOString()
        }
      }
    }),
    "utf8"
  );
};

test("renders an installed campusmod through the real Electron sandbox origin", async ({
  browserName: _browserName
}) => {
  void _browserName;
  const userDataPath = await mkdtemp(join(tmpdir(), "campusos-campusmod-e2e-"));
  await createInstalledPackage(userDataPath);
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
    page.setDefaultTimeout(15_000);
    await page.waitForLoadState("domcontentloaded");
    await page.locator(".onboarding-actions .primary-button").click();
    await page.locator(".onboarding-development-skip").click();
    await page.locator(".onboarding-sync-placeholder .primary-button").click();
    await page.locator(".onboarding-actions .primary-button").click();
    await page.locator(".onboarding-actions .primary-button").click();
    await page.locator(".onboarding-enter-button").click();
    const assistantSetup = page.getByRole("dialog", { name: "先配置 AI 连接" });
    await expect(assistantSetup).toBeVisible();
    await assistantSetup.getByRole("button", { name: "稍后配置" }).click();
    await page.locator('[data-activity-id="extensions"]').click();

    const pluginButton = page.getByRole("button", { name: "Hello CampusOS" });
    await expect(pluginButton).toBeVisible();
    await pluginButton.click();

    const frame = page.locator("iframe.campusmod-sandbox-frame");
    await expect(frame).toHaveAttribute("src", "campusmod://dev.example.hello/");
    await expect(
      page.frameLocator("iframe.campusmod-sandbox-frame").locator("#campusmod-root")
    ).toHaveText("mounted:1:dev.example.hello");
    expect(
      page.frames().some((candidate) =>
        candidate.url().startsWith("campusmod://dev.example.hello/"))
    ).toBe(true);
  } finally {
    await app.close();
    await rm(userDataPath, { recursive: true, force: true });
  }
});
