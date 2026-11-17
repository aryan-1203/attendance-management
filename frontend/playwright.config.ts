import { defineConfig, devices } from "@playwright/test";

const API_PORT = 8765;
const WEB_PORT = 5175;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    {
      // fresh, seeded backend on a throwaway SQLite database
      command: `rm -f storage/e2e.db && DATABASE_URL=sqlite:///./storage/e2e.db ENABLE_SCHEDULER=false .venv/bin/python -m app.seed --reset && DATABASE_URL=sqlite:///./storage/e2e.db ENABLE_SCHEDULER=false .venv/bin/uvicorn app.main:app --port ${API_PORT}`,
      cwd: "../backend",
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `API_PROXY=http://localhost:${API_PORT} npx vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
