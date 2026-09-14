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
