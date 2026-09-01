import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "live-worker.spec.ts",
  forbidOnly: Boolean(import.meta.env.CI),
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4178",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "bun run build && bun scripts/start-live-test-worker.mjs",
    url: "http://127.0.0.1:4178/",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
