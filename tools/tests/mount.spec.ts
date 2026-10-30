// Proves the project-bundle contract on both starter templates: each one's
// project-bundle.zip, served and mounted by its preview host exactly as the master
// UI will, renders the storefront inside <gk-project>'s shadow root, calls only the
// API it was given with the public key and the visit token, renews an expired
// visit through gk-visit-expired, routes under its base path, keeps its storage
// inside gk-<project-code>-, adds no global CSS, and unmounts cleanly.
import { test, expect, type Page } from '@playwright/test';
import { templates } from '../playwright.config';

const API_ORIGIN = 'https://shop.example.test';
const API_PATH = '/api/gurukul/shop/v1';
const KEY = 'gkpub_previewtestpublickey000000000000';

const products = [
  { id: 1, sku: 'APL-1', name: 'Apples (1 kg)', categoryId: 1, priceMinor: 249, currency: 'EUR', stockOnHand: 10, stockAvailable: 10, reorderLevel: 2, isActive: true },
  { id: 2, sku: 'MLK-1', name: 'Milk (1 l)', categoryId: 1, priceMinor: 119, currency: 'EUR', stockOnHand: 0, stockAvailable: 0, reorderLevel: 2, isActive: true },
];

interface Call {
  method: string;
  path: string;
  key?: string;
  visit?: string;
}

/** Stubs the master API. The first visit token is "expired" on the first catalogue read. */
async function stubApi(page: Page) {
  const calls: Call[] = [];
  let visits = 0;
  const lines: Record<number, number> = {};
  const basket = () => {
    const ls = Object.entries(lines).map(([id, quantity]) => {
      const p = products.find((x) => x.id === Number(id))!;
      return { productId: p.id, name: p.name, priceMinor: p.priceMinor, quantity, lineTotalMinor: p.priceMinor * quantity };
    });
    return { basketId: 'b-1', lines: ls, totalMinor: ls.reduce((n, l) => n + l.lineTotalMinor, 0), currency: 'EUR' };
  };
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET, POST, PUT, DELETE',
  };
  await page.route(`${API_ORIGIN}/**`, async (route) => {
    const req = route.request();
    const method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const path = new URL(req.url()).pathname.replace(API_PATH, '');
    const h = req.headers();
    calls.push({ method, path, key: h['x-shop-key'], visit: h['x-shop-visit'] });
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, headers: { ...cors, 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' }, body: JSON.stringify(body) });

    if (h['x-shop-key'] !== KEY) return json(401, { status: 401, code: 'shop.key_invalid', title: 'Unknown key' });
    if (method === 'POST' && path === '/public/visits') {
      visits++;
      return json(201, { visitToken: `gkvis_test${visits}`, expiresAtUtc: '2030-01-01T00:00:00Z', visitsToday: visits });
    }
    if (!h['x-shop-visit'] || h['x-shop-visit'] === 'gkvis_test1') {
      return json(401, { status: 401, code: 'site.visit_required', title: 'Start a new visit' });
    }
    if (method === 'GET' && path === '/products') return json(200, { items: products, page: 1, pageSize: 50, total: products.length });
    if (method === 'POST' && path === '/baskets') return json(201, { basketId: 'b-1' });
    if (method === 'GET' && path === '/baskets/b-1') return json(200, basket());
    const line = /^\/baskets\/b-1\/lines\/(\d+)$/.exec(path);
    if (line && method === 'PUT') {
      lines[Number(line[1])] = JSON.parse(req.postData() ?? '{}').quantity;
      return json(200, basket());
    }
    if (line && method === 'DELETE') {
      delete lines[Number(line[1])];
      return json(200, basket());
    }
    return json(404, { status: 404, code: 'not.stubbed', title: `${method} ${path} is not stubbed` });
  });
  return { calls, visitCount: () => visits };
}

for (const t of templates) {
  test.describe(`${t.name} template`, () => {
    const origin = `http://localhost:${t.port}`;

    test('mounts <gk-project> and renders the storefront inside its shadow root', async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      // The browser logs the stub's deliberate 401 (the expired visit); any other console error fails.
      page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(m.text()));
      const hosts = new Set<string>();
      page.on('request', (r) => hosts.add(new URL(r.url()).origin));
      const api = await stubApi(page);

      await page.goto(origin + '/');
      // The host owns the address bar and puts the project under its base path.
      await expect(page).toHaveURL(`${origin}/p/preview/demo/`);

      const project = page.locator('gk-project');
      await expect(project.locator('.product')).toHaveCount(2);
      await expect(project.getByText('Apples (1 kg)')).toBeVisible();

      // Rendered INSIDE the shadow root, not in the page's own DOM.
      const where = await page.evaluate(() => {
        const el = document.querySelector('gk-project')!;
        return {
          inShadow: !!el.shadowRoot?.querySelector('.product'),
          inLight: !!document.querySelector('.product'),
          headStyles: document.head.querySelectorAll('style, link[rel="stylesheet"]').length,
        };
      });
      expect(where).toEqual({ inShadow: true, inLight: false, headStyles: 1 /* the preview page's own */ });

      // The visit: started by the host, renewed once through gk-visit-expired, sent on every call.
      expect(api.visitCount()).toBe(2);
      const reads = api.calls.filter((c) => c.path === '/products');
      expect(reads.map((r) => r.visit)).toEqual(['gkvis_test1', 'gkvis_test2']);
      expect(api.calls.every((c) => c.key === KEY)).toBe(true);

      // Basket, through the router, under the base path.
      await project.getByRole('button', { name: 'Add to basket' }).click();
      await expect(project.getByRole('link', { name: 'Basket (1)' })).toBeVisible();
      await project.getByRole('link', { name: 'Basket (1)' }).click();
      await expect(page).toHaveURL(`${origin}/p/preview/demo/basket`);
      await expect(project.getByText('1 × Apples (1 kg)')).toBeVisible();
      // After the renewal, every call carries the new visit token.
      const afterRenewal = api.calls.slice(api.calls.findIndex((c) => c.visit === 'gkvis_test2'));
      expect(afterRenewal.filter((c) => c.path !== '/public/visits').map((c) => c.visit)).not.toContain('gkvis_test1');
      expect(afterRenewal.some((c) => c.method === 'PUT' && c.path === '/baskets/b-1/lines/1' && c.visit === 'gkvis_test2')).toBe(true);

      // Storage stays inside gk-<project-code>-; no cookies; no service worker.
      const state = await page.evaluate(async () => ({
        keys: [...Object.keys(sessionStorage), ...Object.keys(localStorage)],
        cookie: document.cookie,
        workers: (await navigator.serviceWorker?.getRegistrations?.())?.length ?? 0,
      }));
      expect(state.keys.length).toBeGreaterThan(0);
      expect(state.keys.every((k) => k.startsWith('gk-demo-'))).toBe(true);
      expect(state.cookie).toBe('');
      expect(state.workers).toBe(0);

      // Only the host's own origin and the API were contacted.
      expect([...hosts].sort()).toEqual([API_ORIGIN, origin].sort());

      // Unmount: the host removes the element; nothing breaks, nothing is left behind.
      await page.evaluate(() => document.querySelector('gk-project')!.remove());
      await page.waitForTimeout(100);
      expect(await page.locator('gk-project').count()).toBe(0);
      expect(errors).toEqual([]);
    });

    test('a deep link under the base path opens that page', async ({ page }) => {
      await stubApi(page);
      await page.goto(origin + '/p/preview/demo/basket');
      await expect(page.locator('gk-project').getByText('Your basket is empty.')).toBeVisible();
      await expect(page).toHaveURL(`${origin}/p/preview/demo/basket`);
    });
  });
}
