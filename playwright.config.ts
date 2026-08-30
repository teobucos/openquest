import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  forbidOnly: Boolean(import.meta.env.CI),
  retries: import.meta.env.CI ? 2 : 0,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "bun run build && bun run migrate:local && bun run preview",
    url: "http://127.0.0.1:4173",
    // Always apply the non-destructive migration plan and exercise a fresh Worker process.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
