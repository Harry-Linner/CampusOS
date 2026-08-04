import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  esbuild: {
    jsx: "automatic"
  },
  resolve: {
    alias: {
      "/@vite/env": resolve(rootDir, "test/vite-env.ts"),
      "@vite/env": resolve(rootDir, "test/vite-env.ts"),
      "@renderer": resolve(rootDir, "src/renderer"),
      "@campusos/shared": resolve(rootDir, "../shared/src/index.ts"),
      "@campusos/plugin-academic/gradesModel": resolve(
        rootDir,
        "../../plugins/official/academic/src/gradesModel.ts"
      ),
      "@campusos/plugin-academic/manifest": resolve(
        rootDir,
        "../../plugins/official/academic/src/manifest.ts"
      ),
      "@campusos/plugin-schedule/manifest": resolve(
        rootDir,
        "../../plugins/official/schedule/src/manifest.ts"
      ),
      "@campusos/plugin-materials/manifest": resolve(
        rootDir,
        "../../plugins/official/materials/src/manifest.ts"
      ),
      "@campusos/plugin-academic": resolve(
        rootDir,
        "../../plugins/official/academic/src/index.ts"
      ),
      "@campusos/plugin-schedule": resolve(
        rootDir,
        "../../plugins/official/schedule/src/index.ts"
      ),
      "@campusos/plugin-academic-timetable-events/manifest": resolve(
        rootDir,
        "../../plugins/official/academic-timetable-events/src/manifest.ts"
      ),
      "@campusos/plugin-academic-timetable-events/main": resolve(
        rootDir,
        "../../plugins/official/academic-timetable-events/src/main.ts"
      ),
      "@campusos/plugin-materials": resolve(
        rootDir,
        "../../plugins/official/materials/src/index.tsx"
      ),
      "@campusos/plugin-zju-undergraduate/manifest": resolve(
        rootDir,
        "../../plugins/official/zju-undergraduate/src/manifest.ts"
      ),
      "@campusos/plugin-zju-undergraduate/main": resolve(
        rootDir,
        "../../plugins/official/zju-undergraduate/src/main.ts"
      )
    }
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"]
  }
});
