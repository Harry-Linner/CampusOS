import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const allowedKeys = new Set([
  "CAMPUSOS_ZJU_USERNAME",
  "CAMPUSOS_ZJU_PASSWORD",
  "CAMPUSOS_ZJU_PROGRAM"
]);
const requiredKeys = [...allowedKeys];

const parseLocalEnvironment = (source) => {
  const values = {};
  for (const rawLine of source.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) {
      throw new Error("live-auth.env 包含无效行。");
    }
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (!allowedKeys.has(key)) {
      throw new Error("live-auth.env 包含不允许的变量名。");
    }
    if (Object.hasOwn(values, key)) {
      throw new Error("live-auth.env 包含重复变量。");
    }
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (value === "") {
      throw new Error(`live-auth.env 缺少 ${key} 的值。`);
    }
    values[key] = value;
  }
  for (const key of requiredKeys) {
    if (!values[key]) throw new Error(`live-auth.env 缺少 ${key}。`);
  }
  if (!['undergraduate', 'graduate'].includes(values.CAMPUSOS_ZJU_PROGRAM)) {
    throw new Error("CAMPUSOS_ZJU_PROGRAM 必须是 undergraduate 或 graduate。");
  }
  return values;
};

const localEnvironmentPath = join(process.cwd(), "live-auth.env");
let localEnvironment;
try {
  localEnvironment = parseLocalEnvironment(
    await readFile(localEnvironmentPath, "utf8")
  );
} catch (error) {
  if (error && typeof error === "object" && error.code === "ENOENT") {
    throw new Error("未找到已忽略的 live-auth.env，无法运行真实账号验收。");
  }
  throw error;
}

const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const child = spawn(
  pnpmCommand,
  ["--filter", "@campusos/core", "verify:zju-auth"],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...localEnvironment
    },
    stdio: "inherit",
    windowsHide: true,
    shell: process.platform === "win32"
  }
);

const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code) => resolve(code ?? 1));
});
process.exitCode = exitCode;
