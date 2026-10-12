const { defineConfig } = require('@playwright/test');

// Browser-only session tests use synthetic responses and never connect to a database.
module.exports = defineConfig({
  testDir: './tests',
  testMatch: 'session-navigation.spec.js',
  outputDir: './test-results/session-ui',
  workers: 1,
  timeout: 15000,
  use: { baseURL: 'http://drrosa.test' },
});
