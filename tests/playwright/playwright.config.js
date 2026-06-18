const path = require("path");
const { defineConfig, devices } = require("@playwright/test");

const baseURL = process.env.PLAYWRIGHT_BASE_URL || process.env.APP_BASE_URL || "http://localhost:3010";

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
  ]
});
