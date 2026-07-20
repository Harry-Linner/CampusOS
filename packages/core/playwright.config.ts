import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  timeout: 60_000,
  retries: 0,
  use: {
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  }
});
