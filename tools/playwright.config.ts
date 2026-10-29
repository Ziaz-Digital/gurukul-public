import { defineConfig } from '@playwright/test';

// The mount test: each template's own preview host (npm run preview) serves its
// project-bundle.zip and mounts <gk-project> exactly as the master UI will.
// The API is stubbed in the test (page.route); no shop server runs.
const API = 'https://shop.example.test/api/gurukul/shop/v1';
const KEY = 'gkpub_previewtestpublickey000000000000';

export const templates = [
  { name: 'angular', dir: '../templates/grocery-angular', port: 4391 },
  { name: 'react', dir: '../templates/grocery-react', port: 4392 },
];

export default defineConfig({
  testDir: './tests',
  testMatch: /.*\.spec\.ts/,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : 'list',
  outputDir: 'test-results',
  // channel 'chromium': the full Chromium build in new headless mode, as a visitor's browser runs the page.
  // PW_CHANNEL=chrome (or msedge) uses an installed browser instead.
  use: { browserName: 'chromium', channel: process.env.PW_CHANNEL || 'chromium', headless: true },
  webServer: templates.map((t) => ({
    command: 'node scripts/preview.mjs',
    cwd: t.dir,
    url: `http://localhost:${t.port}/p/preview/demo/`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: { PORT: String(t.port), SHOP_API_BASE_URL: API, SHOP_KEY: KEY },
  })),
});
