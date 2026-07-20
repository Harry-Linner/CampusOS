import { access, readdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pnpmDir = resolve(rootDir, "node_modules", ".pnpm");
const stubModules = ["branding.js", "overloads.js"];
const stubSource = `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
`;

const fileExists = async (path) => {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const repairExpectType = async () => {
  if (!(await fileExists(pnpmDir))) {
    return;
  }

  const candidates = (await readdir(pnpmDir)).filter((entry) =>
    entry.startsWith("expect-type@")
  );

  for (const candidate of candidates) {
    const distDir = resolve(
      pnpmDir,
      candidate,
      "node_modules",
      "expect-type",
      "dist"
    );

    if (!(await fileExists(distDir))) {
      continue;
    }

    for (const moduleName of stubModules) {
      const targetPath = resolve(distDir, moduleName);

      if (!(await fileExists(targetPath))) {
        await writeFile(targetPath, stubSource, "utf8");
      }
    }
  }
};

await repairExpectType();
