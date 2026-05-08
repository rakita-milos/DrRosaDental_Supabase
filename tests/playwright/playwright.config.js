const path = require("path");
const { defineConfig, devices } = require("@playwright/test");

const baseURL = process.env.PLAYWRIGHT_BASE_URL || process.env.APP_BASE_URL || "http://localhost:3000";

module.exports = defineConfig({
  testDir: path.join(__dirname, "tests"),
  timeout: 30_000,
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
        ...devices["Desktop Chrome"],
        channel: "chrome"
      }
    }
  ],
  webServer: {
    command: "node server.js",
    cwd: path.join(__dirname, "../../backend"),
    url: `${baseURL}/api/health`,
    reuseExistingServer: true,
    timeout: 20_000
  }
});
