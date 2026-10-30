import { defineConfig } from '@playwright/test';

// The reference shop's own walk-through: its project-bundle.zip (run `npm run bundle`
// first), served and mounted by the template's preview host exactly as Gurukul's
// showcase does it. The API is STUBBED in the test (page.route): no shop server runs,
// and no real key is used — the two keys below are made-up test strings.
export const API = 'https://shop.example.test/api/gurukul/shop/v1';
/** Hosted: the showcase hands the bundle a public key. */
export const HOSTED = { port: 4393, key: 'gkpub_referenceshoptestkey00000000' };
/** On the learner's laptop: their own shop key. */
export const LAPTOP = { port: 4394, key: 'gkshop_referenceshoptestkey0000000' };

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts/,
  workers: 1,
  timeout: 60_000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : 'list',
  outputDir: 'test-results',
  // channel 'chromium': the full Chromium build in new headless mode. PW_CHANNEL=chrome uses an installed browser.
  use: { browserName: 'chromium', channel: process.env.PW_CHANNEL || 'chromium', headless: true },
  webServer: [HOSTED, LAPTOP].map((s) => ({
    command: 'node scripts/preview.mjs',
    url: `http://localhost:${s.port}/p/preview/demo/`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: { PORT: String(s.port), SHOP_API_BASE_URL: API, SHOP_KEY: s.key },
  })),
});
