// Minimal Electron window used as the floor reference for the memory NFR.
//
// Launched by scripts/measure-performance.mjs: it has the same process model as CampusOS
// (main + GPU + network utility + renderer) but no CampusOS code, so the difference
// between the two measurements is what this project actually owns. Same shape as
// packages/core/out/main/main.js is launched with, so the numbers are comparable.
const { app, BrowserWindow } = require("electron");

app.whenReady().then(() => {
  const window = new BrowserWindow({ width: 1280, height: 800 });
  void window.loadURL("data:text/html,<title>floor</title><body style='font-family:sans-serif'>floor</body>");
});

app.on("window-all-closed", () => {
  // Keep the process group alive so the sampler can read it.
});
