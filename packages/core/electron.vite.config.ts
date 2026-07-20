import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const rootDir = dirname(fileURLToPath(import.meta.url));
const workspaceRuntimeDependencies = [
  "@campusos/shared",
  "@campusos/plugin-academic-exams",
  "@campusos/plugin-academic-grades",
  "@campusos/plugin-academic-scraper",
  "@campusos/plugin-academic-timetable-events",
  "@campusos/plugin-calendar",
  "@campusos/plugin-deadline-assistant",
  "@campusos/plugin-dingtalk-entry",
  "@campusos/plugin-materials",
  "@campusos/plugin-zju-calendar-config",
  "@campusos/plugin-zju-graduate",
  "@campusos/plugin-zju-learning",
  "@campusos/plugin-zju-undergraduate"
];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({
      exclude: workspaceRuntimeDependencies
    })],
    build: {
      rollupOptions: {
        input: {
          main: resolve(rootDir, "src/main/main.ts"),
          headlessSandboxHost: resolve(
            rootDir,
            "src/utility/headlessSandboxHost.ts"
          )
        },
        output: {
          entryFileNames: "[name].js"
        }
      }
    },
    resolve: {
      alias: {
        "@campusos/shared": resolve(rootDir, "../shared/src/index.ts"),
        "@campusos/plugin-academic-grades/manifest": resolve(
          rootDir,
          "../../plugins/official/academic-grades/src/manifest.ts"
        ),
        "@campusos/plugin-academic-scraper/manifest": resolve(
          rootDir,
          "../../plugins/official/academic-scraper/src/manifest.ts"
        ),
        "@campusos/plugin-calendar/manifest": resolve(
          rootDir,
          "../../plugins/official/calendar/src/manifest.ts"
        ),
        "@campusos/plugin-materials/manifest": resolve(
          rootDir,
          "../../plugins/official/materials/src/manifest.ts"
        ),
        "@campusos/plugin-dingtalk-entry/manifest": resolve(
          rootDir,
          "../../plugins/official/dingtalk-entry/src/manifest.ts"
        ),
        "@campusos/plugin-zju-undergraduate/manifest": resolve(
          rootDir,
          "../../plugins/official/zju-undergraduate/src/manifest.ts"
        ),
        "@campusos/plugin-zju-undergraduate/main": resolve(
          rootDir,
          "../../plugins/official/zju-undergraduate/src/main.ts"
        ),
        "@campusos/plugin-zju-calendar-config/manifest": resolve(
          rootDir,
          "../../plugins/official/zju-calendar-config/src/manifest.ts"
        ),
        "@campusos/plugin-zju-calendar-config/main": resolve(
          rootDir,
          "../../plugins/official/zju-calendar-config/src/main.ts"
        ),
        "@campusos/plugin-zju-graduate/manifest": resolve(
          rootDir,
          "../../plugins/official/zju-graduate/src/manifest.ts"
        ),
        "@campusos/plugin-zju-graduate/main": resolve(
          rootDir,
          "../../plugins/official/zju-graduate/src/main.ts"
        ),
        "@campusos/plugin-zju-learning/manifest": resolve(
          rootDir,
          "../../plugins/official/zju-learning/src/manifest.ts"
        ),
        "@campusos/plugin-zju-learning/main": resolve(
          rootDir,
          "../../plugins/official/zju-learning/src/main.ts"
        ),
        "@campusos/plugin-academic-exams/manifest": resolve(
          rootDir,
          "../../plugins/official/academic-exams/src/manifest.ts"
        ),
        "@campusos/plugin-academic-exams/main": resolve(
          rootDir,
          "../../plugins/official/academic-exams/src/main.ts"
        ),
        "@campusos/plugin-deadline-assistant/manifest": resolve(
          rootDir,
          "../../plugins/official/deadline-assistant/src/manifest.ts"
        ),
        "@campusos/plugin-deadline-assistant/main": resolve(
          rootDir,
          "../../plugins/official/deadline-assistant/src/main.ts"
        ),
        "@campusos/plugin-academic-timetable-events/manifest": resolve(
          rootDir,
          "../../plugins/official/academic-timetable-events/src/manifest.ts"
        ),
        "@campusos/plugin-academic-timetable-events/main": resolve(
          rootDir,
          "../../plugins/official/academic-timetable-events/src/main.ts"
        )
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ["@campusos/shared"] })],
    build: {
      rollupOptions: {
        output: {
          entryFileNames: "[name].cjs",
          format: "cjs"
        }
      }
    },
    resolve: {
      alias: {
        "@campusos/shared": resolve(rootDir, "../shared/src/index.ts")
      }
    }
  },
  renderer: {
    plugins: [
      react(),
      {
        name: "campusos-development-style-csp",
        transformIndexHtml(html, context) {
          if (!context.server) return html;

          // Vite injects CSS through inline style elements while developing.
          return html.replace(
            "style-src 'self';",
            "style-src 'self' 'unsafe-inline';"
          );
        }
      }
    ],
    build: {
      rollupOptions: {
        input: resolve(rootDir, "src/renderer/index.html")
      }
    },
    resolve: {
      alias: {
        "@renderer": resolve(rootDir, "src/renderer"),
        "@campusos/shared": resolve(rootDir, "../shared/src/index.ts"),
        "@campusos/plugin-academic-grades/manifest": resolve(
          rootDir,
          "../../plugins/official/academic-grades/src/manifest.ts"
        ),
        "@campusos/plugin-academic-grades": resolve(
          rootDir,
          "../../plugins/official/academic-grades/src/index.tsx"
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
        "@campusos/plugin-academic-exams/manifest": resolve(
          rootDir,
          "../../plugins/official/academic-exams/src/manifest.ts"
        ),
        "@campusos/plugin-deadline-assistant/manifest": resolve(
          rootDir,
          "../../plugins/official/deadline-assistant/src/manifest.ts"
        ),
        "@campusos/plugin-exam-countdown/manifest": resolve(
          rootDir,
          "../../plugins/official/exam-countdown/src/manifest.ts"
        ),
        "@campusos/plugin-exam-countdown": resolve(
          rootDir,
          "../../plugins/official/exam-countdown/src/index.tsx"
        )
      }
    }
  }
});
