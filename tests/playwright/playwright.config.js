const path = require("path");
const { defineConfig, devices } = require("@playwright/test");

const baseURL = process.env.PLAYWRIGHT_BASE_URL || process.env.APP_BASE_URL || "http://localhost:3000";

module.exports = defineConfig({
  testDir: path.join(__dirname, "tests"),
  timeout: 60_000,
  workers: 1,
  expect: {
    timeout: 8_000
  },
  fullyParallel: false,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }]
  ],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  projects: [
    {
      name: "chrome",
      use: {
        ...devices["Desktop Chrome"]
      }
    }
  ],
  webServer: {
    command: "node server.js",
    cwd: path.join(__dirname, "../../backend"),
    url: `${baseURL}/api/health`,
    env: {
      ...process.env,
      SQLITE_DB_PATH: "../tests/playwright/.backend-data/playwright.sqlite",
      BACKUP_DIR: "../tests/playwright/.backend-backups",
      UPLOAD_DIR: "../tests/playwright/.uploads",
      SCANNER_IMPORT_DIR: path.join(__dirname, ".scanner-inbox")
    },
    reuseExistingServer: true,
    timeout: 20_000
  }
});
