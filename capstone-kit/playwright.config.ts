import { defineConfig } from '@playwright/test';
import { grepFor, parseCapabilities } from './src/capabilities';

/**
 * Gurukul's Capstone test kit: API contract tests for YOUR shop backend
 * (docs: ../README.md). Configured only by environment variables:
 *
 *   SHOP_BASE_URL    your API's base, e.g. http://localhost:5000/api — the contract's routes are relative to it
 *   SHOP_KEY         a shop key your backend accepts in X-Shop-Key
 *   SHOP_STAFF_CODE  the staff code your backend accepts in POST /staff/sessions
 *   CAPABILITIES     your chosen add-ons, comma-separated (the core always runs)
 *
 * One worker, in file order: the tests share your one shop, and a few of them
 * change shop-wide settings (delivery rules, opening hours) and put them back.
 * Each test still creates its own data, so any one of them can run alone.
 */
const addOns = parseCapabilities(process.env.CAPABILITIES);

export default defineConfig({
  testDir: './tests',
  grep: grepFor(addOns),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  // Generous: a rate-limited backend makes the kit wait, never fail.
  timeout: 240_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'results/results.json' }],
  ],
  metadata: { capabilities: ['core', ...addOns].join(', ') },
  use: {
    extraHTTPHeaders: { Accept: 'application/json' },
  },
});
