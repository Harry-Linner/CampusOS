import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";

const requireFromCore = createRequire(join(process.cwd(), "package.json"));
const electronBinary = requireFromCore("electron");
const smokeScript = join(
  process.cwd(),
  "..",
  "..",
  "scripts",
  "headless-sandbox-smoke"
);

const child = spawn(electronBinary, [smokeScript], {
  cwd: process.cwd(),
  stdio: "inherit",
  windowsHide: true
});

child.on("error", (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.stderr.write(`Electron smoke exited with signal ${signal}.\n`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
