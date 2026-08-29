import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "list",
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
    command:
      "corepack pnpm run migrate:local && corepack pnpm exec vite --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    // Always apply the non-destructive migration plan and exercise a fresh Worker process.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
