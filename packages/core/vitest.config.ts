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
      "@campusos/plugin-academic-timetable-events/manifest": resolve(
        rootDir,
        "../../plugins/official/academic-timetable-events/src/manifest.ts"
      ),
      "@campusos/plugin-academic-timetable-events/main": resolve(
        rootDir,
        "../../plugins/official/academic-timetable-events/src/main.ts"
      ),
      "@campusos/plugin-exam-countdown/manifest": resolve(
        rootDir,
        "../../plugins/official/exam-countdown/src/manifest.ts"
      ),
      "@campusos/plugin-exam-countdown/main": resolve(
        rootDir,
        "../../plugins/official/exam-countdown/src/main.ts"
      ),
      "@campusos/plugin-exam-countdown": resolve(
        rootDir,
        "../../plugins/official/exam-countdown/src/index.tsx"
      ),
      "@campusos/plugin-academic-scraper/manifest": resolve(
        rootDir,
        "../../plugins/official/academic-scraper/src/manifest.ts"
      ),
      "@campusos/plugin-academic-scraper": resolve(
        rootDir,
        "../../plugins/official/academic-scraper/src/index.tsx"
      ),
      "@campusos/plugin-calendar/manifest": resolve(
        rootDir,
        "../../plugins/official/calendar/src/manifest.ts"
      ),
      "@campusos/plugin-calendar": resolve(
        rootDir,
        "../../plugins/official/calendar/src/index.tsx"
      ),
      "@campusos/plugin-materials/manifest": resolve(
        rootDir,
        "../../plugins/official/materials/src/manifest.ts"
      ),
      "@campusos/plugin-materials": resolve(
        rootDir,
        "../../plugins/official/materials/src/index.tsx"
      ),
      "@campusos/plugin-dingtalk-entry/manifest": resolve(
        rootDir,
        "../../plugins/official/dingtalk-entry/src/manifest.ts"
      ),
      "@campusos/plugin-dingtalk-entry": resolve(
        rootDir,
        "../../plugins/official/dingtalk-entry/src/index.tsx"
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
    include: ["src/**/*.test.ts"]
  }
});
