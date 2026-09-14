import { expect, test, _electron as electron } from "@playwright/test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createAccountProfileStore } from "../src/main/accountProfileStore";

test("logout keeps local data but reopens an empty onboarding profile", async () => {
  const root = await mkdtemp(join(tmpdir(), "campusos-logout-e2e-"));
  const launch = () => electron.launch({ args: [resolve("out/main/main.js"), `--user-data-dir=${root}`], env: { ...process.env, CAMPUSOS_E2E_FIXTURE: "1" } });
  let app = await launch();
  let closed = false;
  try {
    const encryptedBeforeLogout = await app.evaluate(({ safeStorage }) => safeStorage.encryptString("synthetic-profile-secret").toString("base64"));
    const page = await app.firstWindow();
    const task = await page.evaluate(() => window.campusos.schedule.saveTask({
      title: "Private account fixture", description: "", timeSpentMinutes: 0, timeNeededMinutes: 30,
      startAt: new Date().toISOString(), endAt: new Date(Date.now() + 1_800_000).toISOString(), location: "",
      breakable: false, blocksPlanning: false, type: "fixed"
    }));
    expect(task.operation?.taskId).toBeTruthy();
    await page.evaluate(() => { localStorage.setItem("campusos.onboarding.completed", "1"); localStorage.setItem("account-private-fixture", "old account"); });
    await page.reload();
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByRole("button", { name: "账号", exact: true }).click();
    await page.evaluate(() => window.campusos.desktopPet.show());
    await expect.poll(() => app.windows().length).toBe(3);
    // Playwright owns the next process launch; production still calls relaunch.
    await app.evaluate(({ app }) => { app.relaunch = () => undefined; });
    page.once("dialog", dialog => dialog.accept());
    const exited = app.waitForEvent("close");
    await page.getByRole("button", { name: "退出当前账号", exact: true }).click();
    await exited;
    closed = true;
    const index = JSON.parse(await readFile(join(root, "account-profiles.json"), "utf8")) as { active: { kind: string } };
    expect(index.active.kind).toBe("guest");
    expect((await readFile(join(root, "campusos.sqlite"))).length).toBeGreaterThan(0);
    app = await launch(); closed = false;
    const fresh = await app.firstWindow();
    await expect(fresh.getByRole("button", { name: "开始配置", exact: true })).toBeVisible();
    expect(await fresh.evaluate(() => localStorage.getItem("account-private-fixture"))).toBeNull();
    expect((await fresh.evaluate(() => window.campusos.schedule.loadTasks())).tasks).toEqual([]);
    expect(await app.evaluate(({ app }) => app.getPath("userData"))).not.toBe(root);
    // Exercise native OS encryption across actual process/profile changes. A mock
    // cipher cannot detect Windows Local State key changes.
    expect(await app.evaluate(({ safeStorage }, ciphertext) => safeStorage.decryptString(Buffer.from(ciphertext, "base64")), encryptedBeforeLogout)).toBe("synthetic-profile-secret");
    expect(await app.evaluate(({ app, BrowserWindow }) => BrowserWindow.getAllWindows().every(window => window.webContents.session.storagePath === app.getPath("userData")))).toBe(true);
    expect(app.windows()).toHaveLength(1);
    await fresh.keyboard.press("Control+f");
    await expect(fresh.getByText("Private account fixture", { exact: true })).toHaveCount(0);
    await fresh.screenshot({ path: test.info().outputPath("signed-out-onboarding.png") });
    // The login flow encrypts in the guest process and writes to the verified
    // account's directory. Use native safeStorage, replacing only remote auth.
    const password = "synthetic-new-account-secret";
    const ciphertext = await app.evaluate(({ safeStorage }, secret) => safeStorage.encryptString(secret).toString("base64"), password);
    await app.close(); closed = true;
    const profiles = createAccountProfileStore(root);
    const identity = { username: "fixture-profile-b", program: "undergraduate" as const };
    const vaultPath = profiles.credentialPath(identity);
    await mkdir(dirname(vaultPath), { recursive: true });
    const now = new Date().toISOString();
    const payload = { ...identity, dataVersion: 4, encryptedPassword: ciphertext, savedAt: now, verifiedAt: now,
      provider: "zju-unified-auth", verifiedService: "undergraduate-academic-affairs",
      authenticatedProfile: { source: "zju-quality-development", studentId: identity.username, fetchedAt: now, secondClassPoints: 0, thirdClassPoints: 0, fourthClassPoints: 0 } };
    await writeFile(vaultPath, JSON.stringify(payload));
    profiles.activate(identity);
    app = await launch(); closed = false;
    const accountPage = await app.firstWindow();
    expect(await app.evaluate(({ safeStorage }, value) => safeStorage.decryptString(Buffer.from(value, "base64")), ciphertext)).toBe(password);
    expect(await accountPage.evaluate(() => localStorage.getItem("account-private-fixture"))).toBeNull();
    // A broken vault must fail at the real sync IPC before network fan-out.
    await writeFile(vaultPath, JSON.stringify({ ...payload, encryptedPassword: Buffer.from("invalid-ciphertext").toString("base64") }));
    await app.evaluate(() => { delete process.env.CAMPUSOS_E2E_FIXTURE; });
    await expect(accountPage.evaluate(() => window.campusos.workspace.sync())).rejects.toThrow("本地登录凭据无法解密");
  } finally {
    if (!closed) await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
