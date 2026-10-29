import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  workers: 1,
  timeout: 60000,
  outputDir: "work/browser-results",
  use: {
    baseURL: "http://127.0.0.1:3003",
    viewport: { width: 390, height: 844 },
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node --import tsx scripts/browser-server.ts",
    url: "http://127.0.0.1:3003/api/health",
    reuseExistingServer: false,
    env: { NODE_ENV: "test", APP_ORIGINS: "http://127.0.0.1:3003" },
    timeout: 30000,
  },
});
