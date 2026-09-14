import { readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2] ?? "packages/core";
const pnpmDir = resolve(rootDir, "node_modules", ".pnpm");

const eslintEntry = (
  await readdir(pnpmDir)
).find((entry) => entry.startsWith("eslint@"));

if (!eslintEntry) {
  throw new Error("Could not locate eslint inside node_modules/.pnpm");
}

const eslintApiPath = resolve(
  rootDir,
  "node_modules",
  ".pnpm",
  eslintEntry,
  "node_modules",
  "eslint",
  "lib",
  "api.js"
);

const { ESLint } = await import(pathToFileURL(eslintApiPath).href);

const eslint = new ESLint({
  cwd: rootDir
});

const results = await eslint.lintFiles([`${target}/**/*.{ts,tsx}`]);
const formatter = await eslint.loadFormatter("stylish");
const output = formatter.format(results);

if (output) {
  process.stdout.write(output);
}

const hasErrors = results.some(
  (result) => result.errorCount > 0 || result.fatalErrorCount > 0
);

if (hasErrors) {
  process.exitCode = 1;
}
