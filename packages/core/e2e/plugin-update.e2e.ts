import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, _electron as electron } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import {
  createCampusmodSigningPayload,
  generateEd25519KeyPair,
  signPackageContent
} from "../src/main/packageSignature";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginId = "dev.example.update-fixture";
const rendererPath = "dist/renderer.js";

interface TestPackage {
  archive: Buffer;
  manifest: Record<string, unknown>;
  archiveManifest: Record<string, unknown>;
}

const hash = (value: Uint8Array): string => createHash("sha256").update(value).digest("hex");

const createPackage = (version: string, label: string, privateKey: Buffer): TestPackage => {
  const renderer = strToU8(`export function mount(root) { root.textContent = "${label}"; return () => { root.textContent = "disposed"; }; }`);
  const baseManifest: Record<string, unknown> = {
    id: pluginId,
    name: "update-fixture",
    displayName: "Update Fixture",
    version,
    apiVersion: 2,
    kind: "feature",
    description: "真实插件更新链 E2E fixture。",
    icon: "Box",
    permissions: ["storage:local"],
    sourceScope: ["local"],
    releaseStage: "ready",
    provides: [],
    requires: [],
    optionalRequires: [],
    contributes: {
      views: [{
        id: "main",
        title: "Update Fixture",
        icon: "Box",
        location: "activity",
        activityTarget: "mod-dev-example-update-fixture"
      }]
    },
    entrypoints: { renderer: rendererPath }
  };
  const entries = new Map<string, Uint8Array>([
    ["manifest.json", strToU8(JSON.stringify(baseManifest))],
    [rendererPath, renderer]
  ]);
  const signature = signPackageContent(
    createCampusmodSigningPayload(baseManifest, entries),
    privateKey
  );
  const manifest = {
    ...baseManifest,
    contentHash: signature.sha256,
    developerSignature: signature.signature,
    developerPublicKey: signature.publicKey
  };
  const archive = Buffer.from(zipSync({
    "manifest.json": strToU8(JSON.stringify(manifest)),
    [rendererPath]: renderer
  }));
  const installedManifest = { ...manifest };
  delete installedManifest.entrypoints;
  return { archive, manifest: installedManifest, archiveManifest: manifest };
};

const seedInstalledPackage = async (userDataPath: string, pkg: TestPackage): Promise<void> => {
  const packagePath = join(userDataPath, "plugins", "installed", pluginId);
  await mkdir(join(packagePath, "dist"), { recursive: true });
  const manifestSource = JSON.stringify(pkg.archiveManifest);
  const renderer = strToU8(`export function mount(root) { root.textContent = "v1"; return () => { root.textContent = "disposed"; }; }`);
  await writeFile(join(packagePath, "manifest.json"), manifestSource, "utf8");
  await writeFile(join(packagePath, rendererPath), renderer);
  await writeFile(join(userDataPath, "plugins", "runtime-state.json"), JSON.stringify({
    dataVersion: 1,
    plugins: {
      [pluginId]: {
        enabled: true,
        grantedPermissions: ["storage:local"],
        updatedAt: new Date(0).toISOString()
      }
    }
  }), "utf8");
  await writeFile(join(packagePath, ".campusmod-install.json"), JSON.stringify({
    dataVersion: 1,
    manifest: pkg.manifest,
    entrypoints: { renderer: rendererPath },
    archiveSize: pkg.archive.length,
    unpackedSize: Buffer.byteLength(manifestSource) + renderer.byteLength,
    fileCount: 2,
    sha256: hash(pkg.archive),
    signatureStatus: "verified",
    installedAt: new Date(0).toISOString(),
    sourceFilename: "update-fixture.campusmod",
    files: { "manifest.json": hash(strToU8(manifestSource)), [rendererPath]: hash(renderer) }
  }), "utf8");
};

const completeOnboarding = async (page: Awaited<ReturnType<Awaited<ReturnType<typeof electron.launch>>["firstWindow"]>>): Promise<void> => {
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

test("updates a signed campusmod through a real local feed and preserves it on digest failure", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "campusos-plugin-update-"));
  const { privateKey } = generateEd25519KeyPair();
  const installed = createPackage("1.0.0", "v1", privateKey);
  const update = createPackage("2.0.0", "v2", privateKey);
  const failed = createPackage("3.0.0", "v3", privateKey);
  await seedInstalledPackage(userDataPath, installed);
  let activeFeed = {
    version: 1,
    generatedAt: "2026-08-16T00:00:00.000Z",
    updates: [{
      pluginId,
      version: update.manifest.version,
      packageUrl: "PACKAGE_URL",
      packageSha256: hash(update.archive),
      manifest: update.manifest
    }]
  };
  let activeArchive = update.archive;
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    if (request.url === "/updates.json") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(activeFeed));
      return;
    }
    response.statusCode = request.url === "/update.campusmod" ? 200 : 404;
    response.end(request.url === "/update.campusmod" ? activeArchive : "not found");
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("local update server did not start");
  const feedUrl = `http://127.0.0.1:${address.port}/updates.json`;
  activeFeed.updates[0].packageUrl = `http://127.0.0.1:${address.port}/update.campusmod`;

  const app = await electron.launch({
    args: [join(packageRoot, "out/main/main.js"), `--user-data-dir=${userDataPath}`],
    env: { ...process.env, CAMPUSOS_E2E_FIXTURE: "1", CAMPUSOS_PLUGIN_UPDATE_FEED_URL: feedUrl }
  });

  try {
    const page = await app.firstWindow({ timeout: 10_000 });
    page.setDefaultTimeout(15_000);
    await page.waitForLoadState("domcontentloaded");
    await completeOnboarding(page);
    await page.locator('[data-activity-id="extensions"]').click();
    await page.getByRole("button", { name: "检查插件更新" }).click();
    await expect(page.getByText("Update Fixture · v2.0.0", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "允许后台更新" }).click();
    await expect.poll(async () => (await page.evaluate(async () => window.campusos?.plugins.loadPackages()))?.packages.find((pkg) => pkg.manifest.id === pluginId)?.manifest.version).toBe("2.0.0");

    const updateView = page.locator('[data-activity-id="mod-dev-example-update-fixture"]');
    await updateView.click();
    await expect(page.frameLocator("iframe.campusmod-sandbox-frame").locator("#campusmod-root")).toHaveText("v2");

    activeArchive = failed.archive;
    activeFeed = {
      ...activeFeed,
      updates: [{ ...activeFeed.updates[0], version: failed.manifest.version, packageSha256: "0".repeat(64), manifest: failed.manifest }]
    };
    await page.getByRole("button", { name: "扩展" }).click();
    await page.getByRole("button", { name: "检查插件更新" }).click();
    await expect(page.getByText("Update Fixture · v3.0.0", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "允许后台更新" }).click();
    await expect(page.getByRole("alert")).toContainText("摘要");
    await expect.poll(async () => (await page.evaluate(async () => window.campusos?.plugins.loadPackages()))?.packages.find((pkg) => pkg.manifest.id === pluginId)?.manifest.version).toBe("2.0.0");
  } finally {
    await app.close();
    await new Promise<void>((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
    await rm(userDataPath, { recursive: true, force: true });
  }
});
