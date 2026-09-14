// Registers the Windows shell identity CampusOS needs for branded taskbar
// buttons and desktop notifications.
//
// Windows resolves a window's taskbar button and toast branding through the
// Start Menu shortcut whose AppUserModelID matches the process AppUserModelID.
// The NSIS installer creates that shortcut for installed builds; development
// runs (and un-packed `dist/win-unpacked` runs) need the same registration, or
// Windows silently drops their toasts. This script creates or updates that one
// shortcut and nothing else.
//
// Usage: pnpm register:windows-identity
const { app, shell } = require("electron");
const { existsSync, mkdirSync } = require("node:fs");
const { dirname, join } = require("node:path");

const APP_ID = "io.github.harry-linner.campusos";
// Must stay in sync with CAMPUSOS_TOAST_ACTIVATOR_CLSID in
// packages/core/src/main/main.ts. Windows accepts a toast without a matching
// activator CLSID but never shows its banner, so the value has to be stable
// across runs and identical in the app and in the shortcut registration.
const TOAST_ACTIVATOR_CLSID = "{7C4E1F62-9A31-4B58-9E7D-2B6E3F5A81C4}";
const repoRoot = join(__dirname, "..");
const packagedExecutable = join(repoRoot, "dist", "win-unpacked", "CampusOS.exe");
const developmentExecutable = join(
  repoRoot,
  "packages",
  "core",
  "node_modules",
  "electron",
  "dist",
  "electron.exe"
);
const iconPath = join(repoRoot, "build", "icon.ico");

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  app.exit(1);
};

app.whenReady().then(() => {
  if (process.platform !== "win32") fail("register-windows-identity 只在 Windows 上运行。");

  const usePackagedExecutable = existsSync(packagedExecutable);
  const target = usePackagedExecutable ? packagedExecutable : developmentExecutable;
  if (!existsSync(target)) fail(`找不到可执行文件：${target}`);
  if (!existsSync(iconPath)) fail(`找不到图标：${iconPath}`);

  const shortcutPath = join(
    app.getPath("appData"),
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    "CampusOS.lnk"
  );
  mkdirSync(dirname(shortcutPath), { recursive: true });

  const created = shell.writeShortcutLink(shortcutPath, existsSync(shortcutPath) ? "update" : "create", {
    target,
    args: usePackagedExecutable ? "" : repoRoot,
    icon: iconPath,
    iconIndex: 0,
    appUserModelId: APP_ID,
    toastActivatorClsid: TOAST_ACTIVATOR_CLSID,
    description: "CampusOS"
  });
  if (!created) fail(`写入快捷方式失败：${shortcutPath}`);

  const details = shell.readShortcutLink(shortcutPath);
  process.stdout.write(`shortcut=${shortcutPath}\n`);
  process.stdout.write(`target=${details.target}\n`);
  process.stdout.write(`appUserModelId=${details.appUserModelId}\n`);
  process.stdout.write(`toastActivatorClsid=${details.toastActivatorClsid}\n`);
  process.stdout.write(`icon=${details.icon}\n`);
  app.exit(0);
});
