import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
const require = createRequire(import.meta.url);
const cli = join(dirname(require.resolve("electron-vite")), "cli.mjs");
// Account changes must restart Electron and its Vite server together. electron-vite
// exits when its Electron child exits, so app.relaunch alone loses the renderer URL.
let stopping = false;
let child;
let launchArgs = process.argv.slice(2);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { stopping = true; child?.kill(); });
while (!stopping) {
  const code = await new Promise((resolve, reject) => {
    child = spawn(process.execPath, [cli, "dev", ...launchArgs], { stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", code => resolve(code ?? 1));
  });
  if (code !== 75) { process.exitCode = code; break; }
  launchArgs = launchArgs.filter(argument => argument !== "--hidden");
}
