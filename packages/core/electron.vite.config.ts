import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const rootDir = dirname(fileURLToPath(import.meta.url));
const workspaceRuntimeDependencies = [
  "@campusos/shared",
  "@campusos/plugin-academic",
  "@campusos/plugin-academic-exams",
  "@campusos/plugin-academic-timetable-events",
  "@campusos/plugin-deadline-assistant",
  "@campusos/plugin-ai-assistant",
  "@campusos/plugin-materials",
  "@campusos/plugin-schedule",
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
        "@campusos/plugin-ai-assistant/manifest": resolve(
          rootDir,
          "../../plugins/official/ai-assistant/src/manifest.ts"
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
        input: {
          index: resolve(rootDir, "src/preload/index.ts"),
          deskCalendar: resolve(rootDir, "src/preload/deskCalendar.ts"),
          deskCalendarWidget: resolve(rootDir, "src/preload/deskCalendarWidget.ts")
        },
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
      tailwindcss(),
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
        input: {
          index: resolve(rootDir, "src/renderer/index.html"),
          "desk-calendar": resolve(rootDir, "src/renderer/desk-calendar.html"),
          "desk-calendar-widget": resolve(rootDir, "src/renderer/desk-calendar-widget.html")
        }
      }
    },
    resolve: {
      alias: {
        "@": resolve(rootDir, "src/renderer"),
        "@renderer": resolve(rootDir, "src/renderer"),
        "@campusos/shared": resolve(rootDir, "../shared/src/index.ts"),
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
        "@campusos/plugin-ai-assistant/manifest": resolve(
          rootDir,
          "../../plugins/official/ai-assistant/src/manifest.ts"
        ),
        "@campusos/plugin-academic": resolve(
          rootDir,
          "../../plugins/official/academic/src/index.ts"
        ),
        "@campusos/plugin-schedule": resolve(
          rootDir,
          "../../plugins/official/schedule/src/index.ts"
        ),
        "@campusos/plugin-materials": resolve(
          rootDir,
          "../../plugins/official/materials/src/index.tsx"
        ),
        "@campusos/plugin-ai-assistant": resolve(
          rootDir,
          "../../plugins/official/ai-assistant/src/index.ts"
        ),
        "@campusos/plugin-academic-exams/manifest": resolve(
          rootDir,
          "../../plugins/official/academic-exams/src/manifest.ts"
        ),
        "@campusos/plugin-deadline-assistant/manifest": resolve(
          rootDir,
          "../../plugins/official/deadline-assistant/src/manifest.ts"
        ),
      }
    }
  }
});
