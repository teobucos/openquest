import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // Worker WebSocket coverage owns its own real-Worker server on :4178.
  // The default suite deliberately uses the disposable Vite/D1 harness below.
  testIgnore: "live-worker.spec.ts",
  forbidOnly: Boolean(import.meta.env.CI),
  retries: import.meta.env.CI ? 2 : 0,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4174",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "bun run build && rm -rf .wrangler/state && bun run migrate:local && bun run --bun vite preview --configLoader native --host 127.0.0.1 --port 4174 --strictPort",
    url: "http://127.0.0.1:4174",
    // The v1 database is disposable; each run applies the additive D1 migration sequence.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
