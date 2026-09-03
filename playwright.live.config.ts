import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results/runs",
  testMatch: ["live-worker.spec.ts", "realtime-core.spec.ts"],
  forbidOnly: Boolean(process.env.CI),
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
    command: "bun run build && bun scripts/start-local-worker.mjs",
    url: "http://127.0.0.1:4178/",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
