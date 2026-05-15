// Playwright config for the picker integration test.
// Run with: npx playwright test
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.mjs',
  timeout: 30_000,
  fullyParallel: false, // single shared HTTP server on a fixed port
  reporter: 'list',
  use: {
    headless: true,
    viewport: { width: 1440, height: 900 },
  },
});
