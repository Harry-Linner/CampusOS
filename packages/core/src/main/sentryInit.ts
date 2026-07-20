import { init } from "@sentry/electron/main";

const SENTRY_DSN = process.env.CAMPUSOS_SENTRY_DSN ?? "";

export const initSentryMain = (): void => {
  if (!SENTRY_DSN) return;

  init({
    dsn: SENTRY_DSN,
    environment: process.env.NODE_ENV === "development" ? "development" : "production",
    release: `campusos@${process.env.npm_package_version ?? "0.1.0"}`,
    tracesSampleRate: 0.1,
    enableRendererProfiling: false
  });
};

export const initSentryRenderer = (): void => {
  if (!SENTRY_DSN) return;

  // Renderer init via main process. In electron-vite with contextIsolation,
  // the renderer imports are split. The preload doesn't need this.
  // Main process init covers both processes in v7.
};
