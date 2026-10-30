// The reference shop, walked end to end in the preview host with the API stubbed:
// browse → search → add to basket → change quantity → checkout → payment → back →
// confirmation; sign-in with the on-screen code → "we have it now" → favourites; the
// read-only staff view in the showcase; and the staff side on the laptop. It also checks
// the bundle stays frugal (the daily request budget) and inside the contract.
import { test, expect, type Page, type Route } from '@playwright/test';
import { API, HOSTED, LAPTOP } from '../playwright.config';

const API_URL = new URL(API);
const API_ORIGIN = API_URL.origin;
const API_PATH = API_URL.pathname;
const ORDER = 'GS-TESTORDER7';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A 1×1 PNG, for the product-images add-on.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

const categories = [
  { id: 1, name: 'Fruit', sortOrder: 1 },
  { id: 2, name: 'Dairy', sortOrder: 2 },
  { id: 3, name: 'Bakery', sortOrder: 3 },
];
const base = { currency: 'EUR', isActive: true };
const products = [
  { ...base, id: 1, sku: 'APL-1', name: 'Apples (1 kg)', categoryId: 1, priceMinor: 249, stockOnHand: 10, stockAvailable: 10, reorderLevel: 2, imageUrl: '/products/1/image' },
  { ...base, id: 2, sku: 'MLK-1', name: 'Milk (1 l)', categoryId: 2, priceMinor: 119, stockOnHand: 0, stockAvailable: 0, reorderLevel: 2 },
  { ...base, id: 3, sku: 'BRD-1', name: 'Sourdough bread', categoryId: 3, priceMinor: 395, stockOnHand: 2, stockAvailable: 2, reorderLevel: 3 },
];

interface Call {
  method: string;
  path: string;
  search: string;
  key?: string;
  visit?: string;
  auth?: string;
  idempotency?: string;
}

/** A stateful stub of the shop server. `staffView: false` = the server has no read-only staff routes yet. */
async function stubApi(page: Page, key: string, opts: { staffView?: boolean } = {}) {
  const calls: Call[] = [];
  const lines = new Map<number, number>();
  const favourites = new Set<number>();
  let orderStatus = 'none';
  let visits = 0;
  const now = Date.now();
  const slots = Array.from({ length: 6 }, (_, i) => {
    const start = new Date(Math.ceil(now / 3_600_000) * 3_600_000 + (i + 2) * 2 * 3_600_000);
    return { slotId: `s${i}`, startsAtUtc: start.toISOString(), endsAtUtc: new Date(start.getTime() + 7_200_000).toISOString(), isAvailable: i !== 1 };
  });
  const basket = () => {
    const ls = [...lines].map(([id, quantity]) => {
      const p = products.find((x) => x.id === id)!;
      return { productId: id, name: p.name, priceMinor: p.priceMinor, quantity, lineTotalMinor: p.priceMinor * quantity };
    });
    return { basketId: 'b-1', lines: ls, totalMinor: ls.reduce((n, l) => n + l.lineTotalMinor, 0), currency: 'EUR' };
  };
  const order = () => {
    const b = basket();
    return {
      orderNumber: ORDER,
      status: orderStatus,
      lines: b.lines,
      subtotalMinor: b.totalMinor,
      deliveryFeeMinor: 399,
      totalMinor: b.totalMinor + 399,
      currency: 'EUR',
      slot: slots[0],
      createdAtUtc: new Date(now).toISOString(),
      ...(orderStatus === 'awaiting-payment' ? { paymentUrl: `${API}/pay/tok1` } : {}),
    };
  };
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, PUT, DELETE' };

  await page.route(`${API_ORIGIN}/**`, async (route: Route) => {
    const req = route.request();
    const method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const url = new URL(req.url());
    const path = url.pathname.replace(API_PATH, '');
    const h = req.headers();
    const json = (status: number, body?: unknown) =>
      route.fulfill({ status, headers: { ...cors, 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' }, body: body === undefined ? '' : JSON.stringify(body) });

    // The simulated payment page: the browser opens it (no shop key), "Pay (test)" comes back with a 303.
    if (path === '/pay/tok1' && method === 'GET') {
      const back = url.searchParams.get('returnUrl') ?? '';
      return route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/html' },
        body: `<!doctype html><title>Test payment</title><form method="post"><input type="hidden" name="returnUrl" value="${back}"><button name="result" value="paid">Pay (test)</button></form>`,
      });
    }
    if (path === '/pay/tok1' && method === 'POST') {
      const form = new URLSearchParams(req.postData() ?? '');
      orderStatus = form.get('result') === 'paid' ? 'paid' : 'payment-failed';
      return route.fulfill({ status: 303, headers: { location: `${form.get('returnUrl')}?orderNumber=${ORDER}&result=${form.get('result')}` } });
    }

    calls.push({ method, path, search: url.search, key: h['x-shop-key'], visit: h['x-shop-visit'], auth: h['authorization'], idempotency: h['idempotency-key'] });
    if (h['x-shop-key'] !== key) return json(401, { status: 401, code: 'shop.key_invalid', title: 'Unknown key' });
    const hosted = key.startsWith('gkpub_');
    if (method === 'POST' && path === '/public/visits') {
      visits++;
      return json(201, { visitToken: `gkvis_ref${visits}`, expiresAtUtc: '2030-01-01T00:00:00Z', visitsToday: visits, dailyLimit: 500 });
    }
    if (hosted && !h['x-shop-visit']) return json(401, { status: 401, code: 'site.visit_required', title: 'Start a visit' });
    if (hosted && (path.startsWith('/staff') || path.startsWith('/dev'))) return json(403, { status: 403, code: 'shop.public_key', title: 'Customer side only' });

    // Catalogue
    if (method === 'GET' && path === '/categories') return json(200, categories);
    if (method === 'GET' && path === '/products') {
      const q = (url.searchParams.get('search') ?? '').toLowerCase();
      const cat = Number(url.searchParams.get('categoryId')) || 0;
      const items = products.filter((p) => (!q || p.name.toLowerCase().includes(q)) && (!cat || p.categoryId === cat));
      return json(200, { items, page: 1, pageSize: 24, total: items.length });
    }
    const productMatch = /^\/products\/(\d+)(\/image)?$/.exec(path);
    if (method === 'GET' && productMatch) {
      const p = products.find((x) => x.id === Number(productMatch[1]));
      if (!p) return json(404, { status: 404, code: 'product.not_found', title: 'Not found' });
      if (productMatch[2]) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'image/png' }, body: PNG });
      return json(200, p);
    }
    if (method === 'GET' && path === '/delivery-rules') return json(200, { feeBands: [{ minBasketMinor: 0, feeMinor: 399 }, { minBasketMinor: 4000, feeMinor: 0 }], slotCutoffMinutes: 0 });
    if (method === 'GET' && path === '/opening-hours') {
      return json(200, { week: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((day) => ({ day, opensAt: '08:00', closesAt: '20:00' })), closures: [] });
    }

    // Basket — slow on purpose: the busy state must show.
    if (method === 'POST' && path === '/baskets') return json(201, { basketId: 'b-1' });
    if (method === 'GET' && path === '/baskets/b-1') return json(200, basket());
    const lineMatch = /^\/baskets\/b-1\/lines\/(\d+)$/.exec(path);
    if (lineMatch) {
      await new Promise((r) => setTimeout(r, 400));
      if (method === 'PUT') lines.set(Number(lineMatch[1]), JSON.parse(req.postData() ?? '{}').quantity);
      if (method === 'DELETE') lines.delete(Number(lineMatch[1]));
      return json(200, basket());
    }
    if (method === 'GET' && path === '/delivery-slots') return json(200, slots);

    // Orders and payment
    if (method === 'POST' && path === '/orders') {
      if (!GUID.test(h['idempotency-key'] ?? '')) return json(400, { status: 400, code: 'idempotency.key_required', title: 'Idempotency-Key' });
      orderStatus = 'awaiting-payment';
      return json(201, order());
    }
    if (method === 'GET' && path === `/orders/${ORDER}`) return json(200, order());

    // Customer sign-in (hosted: the code comes back in the answer)
    if (method === 'POST' && path === '/customers/sign-in-codes') return json(202, { expiresAtUtc: '2030-01-01T00:00:00Z', ...(hosted ? { code: '424242' } : {}) });
    if (method === 'POST' && path === '/customers/sessions') {
      const body = JSON.parse(req.postData() ?? '{}');
      if (body.code !== '424242') return json(401, { status: 401, code: 'customer.code_invalid', title: 'Wrong code' });
      return json(201, { token: 'gkcu_test', expiresAtUtc: '2030-01-01T00:00:00Z', customer: { id: 5, email: body.email, createdAtUtc: '2026-10-01T00:00:00Z' } });
    }
    if (path.startsWith('/customers/me') && h['authorization'] !== 'Bearer gkcu_test') return json(401, { status: 401, code: 'customer.required', title: 'Sign in' });
    if (method === 'GET' && path === '/customers/me/available-requests') {
      return json(200, [{ id: 7, productId: 2, name: 'Milk (1 l)', status: 'available', createdAtUtc: '2026-10-20T00:00:00Z', product: { ...products[1], stockOnHand: 5, stockAvailable: 5 } }]);
    }
    if (method === 'DELETE' && path === '/customers/me/item-requests/7') return json(204);
    if (method === 'GET' && path === '/customers/me/favourites') return json(200, products.filter((p) => favourites.has(p.id)));
    const favMatch = /^\/customers\/me\/favourites\/(\d+)$/.exec(path);
    if (favMatch && method === 'PUT') return favourites.add(Number(favMatch[1])), json(204);
    if (favMatch && method === 'DELETE') return favourites.delete(Number(favMatch[1])), json(204);

    // The read-only staff view (public key)
    if (opts.staffView !== false && method === 'GET' && path === '/public/staff-view/inventory') {
      return json(200, { items: products.map(({ imageUrl: _, ...p }) => p), page: 1, pageSize: 25, total: products.length });
    }
    if (opts.staffView !== false && method === 'GET' && path === '/public/staff-view/orders') {
      return json(200, { items: [{ orderNumber: 'GS-PACKED0001', status: 'packed', lines: [{ productName: 'Apples (1 kg)', quantity: 3, priceMinor: 249 }], lineCount: 1, itemCount: 3, totalMinor: 747, currency: 'EUR', slot: slots[0], placedAtUtc: '2026-10-29T10:00:00Z' }], page: 1, pageSize: 25, total: 1 });
    }
    if (opts.staffView !== false && method === 'GET' && path === '/public/staff-view/low-stock') return json(200, { items: [products[1], products[2]], page: 1, pageSize: 100, total: 2 });

    // Staff (laptop only)
    if (method === 'POST' && path === '/staff/sessions') {
      return JSON.parse(req.postData() ?? '{}').staffCode === 'ABCD-EFGH-JKLM' ? json(201, { token: 'gkst_test', expiresAtUtc: '2030-01-01T00:00:00Z' }) : json(401, { status: 401, code: 'staff.code_invalid', title: 'Wrong code' });
    }
    if (path.startsWith('/staff') && h['authorization'] !== 'Bearer gkst_test') return json(401, { status: 401, code: 'staff.required', title: 'Staff only' });
    if (method === 'GET' && path === '/staff/orders') {
      return json(200, [{ ...order(), orderNumber: 'GS-PAIDORDER1', status: 'paid', customer: { name: 'Ada', email: 'ada@example.test' }, address: { line1: '1 Rue Neuve', city: 'Brussels', postcode: '1000' } }]);
    }
    if (method === 'POST' && path === '/staff/orders/GS-PAIDORDER1/packed') return json(200, { orderNumber: 'GS-PAIDORDER1', status: 'packed' });

    return json(404, { status: 404, code: 'not.stubbed', title: `${method} ${path} is not stubbed` });
  });
  return { calls, count: (method: string, path: string, search?: string) => calls.filter((c) => c.method === method && c.path === path && (search === undefined || c.search === search)).length };
}

/** Errors on the page fail the test (the browser's own "Failed to load resource" lines for stubbed 4xx are expected). */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(m.text()));
  return errors;
}

test.describe('hosted in the showcase (public key)', () => {
  const origin = `http://localhost:${HOSTED.port}`;
  const home = `${origin}/p/preview/demo`;

  test('browse, search, basket, checkout, payment, confirmation', async ({ page }) => {
    const errors = watchErrors(page);
    const hosts = new Set<string>();
    page.on('request', (r) => hosts.add(new URL(r.url()).origin));
    const api = await stubApi(page, HOSTED.key);
    const shop = page.locator('gk-project');

    // Browse: categories, products with stock states, a picture through the shop key.
    await page.goto(home + '/');
    await expect(shop.getByRole('heading', { name: 'Apples (1 kg)' })).toBeVisible();
    await expect(shop.getByRole('link', { name: 'Dairy' })).toBeVisible();
    await expect(shop.locator('.card').filter({ hasText: 'Milk (1 l)' }).getByRole('button', { name: 'Out of stock' })).toBeDisabled();
    await expect(shop.locator('.card').filter({ hasText: 'Sourdough bread' }).getByText('Only 2 left')).toBeVisible();
    await expect(shop.locator('.card').filter({ hasText: 'Apples (1 kg)' }).locator('img')).toHaveAttribute('src', /^blob:/);

    // Hosted: no staff screens, the read-only view instead.
    await expect(shop.getByRole('link', { name: 'Staff', exact: true })).toHaveCount(0);
    await expect(shop.getByRole('link', { name: 'View as staff (read only)' })).toBeVisible();

    // The daily request budget: back and forth between the catalogue and a product
    // within the TTL reads each thing once.
    await shop.getByRole('link', { name: 'Apples (1 kg)' }).first().click();
    await expect(shop.getByRole('heading', { level: 1, name: 'Apples (1 kg)' })).toBeVisible();
    await page.goBack();
    await expect(shop.getByRole('heading', { name: 'Sourdough bread' })).toBeVisible();
    await shop.getByRole('link', { name: 'Apples (1 kg)' }).first().click();
    await expect(shop.getByRole('heading', { level: 1, name: 'Apples (1 kg)' })).toBeVisible();
    await shop.getByRole('link', { name: '← Back to the shop' }).click();
    await expect(shop.getByRole('heading', { name: 'Sourdough bread' })).toBeVisible();
    expect(api.count('GET', '/products')).toBe(1);
    expect(api.count('GET', '/products/1')).toBe(1);
    expect(api.count('GET', '/products/1/image')).toBe(1);
    expect(api.count('GET', '/categories')).toBe(1);

    // Search, in the address bar.
    await shop.getByRole('searchbox', { name: 'Search products' }).fill('apple');
    await shop.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page).toHaveURL(/\/p\/preview\/demo\/?\?q=apple$/);
    await expect(shop.getByText('1 result for “apple”')).toBeVisible();
    await expect(shop.locator('.card')).toHaveCount(1);

    // Add to basket, with a busy state while the (slow) call runs.
    await shop.getByRole('button', { name: 'Add Apples (1 kg) to basket' }).click();
    await expect(shop.getByRole('button', { name: 'Add Apples (1 kg) to basket' })).toHaveAttribute('aria-busy', 'true');
    await expect(shop.getByRole('link', { name: 'Basket (1)' })).toBeVisible();

    // Change the quantity in the basket.
    await shop.getByRole('link', { name: 'Basket (1)' }).click();
    await expect(page).toHaveURL(`${home}/basket`);
    await shop.getByRole('button', { name: 'One more Apples (1 kg)' }).click();
    await expect(shop.locator('.lines li.busy')).toHaveCount(1);
    await expect(shop.getByRole('link', { name: 'Basket (2)' })).toBeVisible();
    await expect(shop.locator('.lines li.busy')).toHaveCount(0);

    // Checkout: details, a slot, place the order with an Idempotency-Key.
    await shop.getByRole('link', { name: 'Go to checkout' }).click();
    await expect(page).toHaveURL(`${home}/checkout`);
    await shop.getByLabel('Name').fill('Ada Lovelace');
    await shop.getByLabel('Email').fill('ada@example.test');
    await shop.getByLabel('Address', { exact: true }).fill('1 Rue Neuve');
    await shop.getByLabel('City').fill('Brussels');
    await shop.getByLabel('Postcode').fill('1000');
    await expect(shop.getByText('Deliver to my door')).toBeVisible(); // click-and-collect
    await expect(shop.getByLabel('Code (optional)')).toBeVisible(); // discount-codes
    await shop.locator('label.slot:not(.off)').first().click();
    await shop.getByRole('button', { name: 'Place order and pay' }).click();

    // The simulated payment page on the API host, then back under the base path.
    await expect(page.getByRole('button', { name: 'Pay (test)' })).toBeVisible();
    expect(new URL(page.url()).searchParams.get('returnUrl')).toBe(`${home}/confirmation`);
    const placed = api.calls.find((c) => c.method === 'POST' && c.path === '/orders')!;
    expect(placed.idempotency).toMatch(GUID);
    await page.getByRole('button', { name: 'Pay (test)' }).click();

    // The confirmation reads the order from the server (never trusts ?result=) and shows the receipt.
    await expect(page).toHaveURL(new RegExp(`^${home}/confirmation\\?orderNumber=${ORDER}&result=paid$`));
    await expect(shop.getByRole('heading', { name: 'Thank you! Your order is confirmed.' })).toBeVisible();
    await expect(shop.locator('.receipt').getByText(ORDER)).toBeVisible();
    await expect(shop.locator('.receipt').getByText('Apples (1 kg)')).toBeVisible();
    expect(api.count('GET', `/orders/${ORDER}`)).toBeGreaterThanOrEqual(1);
    await expect(shop.getByRole('link', { name: 'Basket (0)' })).toBeVisible();

    // The contract: key and visit on every call, storage inside gk-demo-, no cookies,
    // no global styles, no service worker, no other hosts.
    expect(api.calls.every((c) => c.key === HOSTED.key)).toBe(true);
    expect(api.calls.filter((c) => c.path !== '/public/visits').every((c) => c.visit?.startsWith('gkvis_ref'))).toBe(true);
    const state = await page.evaluate(async () => ({
      keys: [...Object.keys(sessionStorage), ...Object.keys(localStorage)],
      cookie: document.cookie,
      headStyles: document.head.querySelectorAll('style, link[rel="stylesheet"]').length,
      workers: (await navigator.serviceWorker?.getRegistrations?.())?.length ?? 0,
    }));
    expect(state.keys.every((k) => k.startsWith('gk-demo-'))).toBe(true);
    expect(state.cookie).toBe('');
    expect(state.headStyles).toBe(1); // the preview page's own
    expect(state.workers).toBe(0);
    expect([...hosts].sort()).toEqual([API_ORIGIN, origin].sort());
    expect(errors).toEqual([]);
  });

  test('sign in with the on-screen code, "we have it now", favourites', async ({ page }) => {
    const errors = watchErrors(page);
    const api = await stubApi(page, HOSTED.key);
    const shop = page.locator('gk-project');
    await page.goto(home + '/');
    await shop.getByRole('link', { name: 'Sign in' }).click();
    await shop.getByLabel('Email').fill('ada@example.test');
    await shop.getByRole('button', { name: 'Get a sign-in code' }).click();

    // Hosted: the public key's answer carries the code, and the shop shows it.
    await expect(shop.getByText('424242')).toBeVisible();
    await shop.getByLabel(/6-digit code/).fill('424242');
    await shop.getByRole('button', { name: 'Sign in', exact: true }).click();

    // "Still looking for X? We have it now." after sign-in.
    const dialog = shop.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Still looking for Milk (1 l)? We have it now.' })).toBeVisible();
    await dialog.getByRole('button', { name: 'No thanks' }).click();
    await expect(dialog).toHaveCount(0);
    expect(api.count('DELETE', '/customers/me/item-requests/7')).toBe(1);

    // Favourites: save one from the shelf, see it in the account.
    await expect(page).toHaveURL(`${home}/account`);
    await expect(shop.getByText('No favourites yet.')).toBeVisible();
    await shop.getByRole('link', { name: 'Shop', exact: true }).click();
    await shop.getByRole('button', { name: 'Save Apples (1 kg) as a favourite' }).click();
    await expect(shop.getByRole('button', { name: 'Remove Apples (1 kg) from favourites' })).toBeVisible();
    await shop.getByRole('link', { name: 'My account' }).click();
    await expect(shop.getByRole('tabpanel').getByRole('heading', { name: 'Apples (1 kg)' })).toBeVisible();
    expect(api.calls.filter((c) => c.path.startsWith('/customers/me')).every((c) => c.auth === 'Bearer gkcu_test')).toBe(true);
    expect(errors).toEqual([]);
  });

  test('the read-only staff view: inventory, orders, shortages', async ({ page }) => {
    const api = await stubApi(page, HOSTED.key);
    const shop = page.locator('gk-project');
    await page.goto(home + '/');
    await shop.getByRole('link', { name: 'View as staff (read only)' }).click();
    await expect(page).toHaveURL(`${home}/staff-view`);
    await expect(shop.getByText('Read only.')).toBeVisible();
    await expect(shop.getByRole('cell', { name: 'Sourdough bread' })).toBeVisible();
    await shop.getByRole('tab', { name: 'Orders' }).click();
    await expect(shop.getByRole('cell', { name: 'GS-PACKED0001' })).toBeVisible();
    await shop.getByRole('tab', { name: 'Shortages' }).click();
    await expect(shop.getByText('Milk (1 l)')).toBeVisible();
    // Nothing to change here, and no staff route was called.
    await expect(shop.getByRole('tabpanel').getByRole('button')).toHaveCount(0);
    expect(api.calls.some((c) => c.path.startsWith('/staff'))).toBe(false);
    expect(api.calls.filter((c) => c.path.startsWith('/public/staff-view')).every((c) => c.key === HOSTED.key && c.visit?.startsWith('gkvis_ref'))).toBe(true);
  });

  test('the staff view says "Not available yet" while the server has no such routes', async ({ page }) => {
    await stubApi(page, HOSTED.key, { staffView: false });
    await page.goto(home + '/staff-view');
    await expect(page.locator('gk-project').getByText('Not available yet.')).toBeVisible();
  });
});

test.describe('on the laptop (own shop key)', () => {
  const home = `http://localhost:${LAPTOP.port}/p/preview/demo`;

  test('staff sign-in and the pick list; no read-only view', async ({ page }) => {
    const api = await stubApi(page, LAPTOP.key);
    const shop = page.locator('gk-project');
    await page.goto(home + '/');
    await expect(shop.getByRole('link', { name: 'View as staff (read only)' })).toHaveCount(0);
    await shop.getByRole('link', { name: 'Staff', exact: true }).click();
    await shop.getByLabel('Staff code').fill('ABCD-EFGH-JKLM');
    await shop.getByRole('button', { name: 'Sign in as staff' }).click();
    await expect(page).toHaveURL(`${home}/staff/orders`);
    await expect(shop.getByText('GS-PAIDORDER1')).toBeVisible();
    await shop.getByRole('button', { name: 'Mark packed' }).click();
    await expect(shop.getByText('GS-PAIDORDER1 packed.')).toBeVisible();
    expect(api.calls.filter((c) => c.path.startsWith('/staff/orders')).every((c) => c.auth === 'Bearer gkst_test')).toBe(true);
    expect(api.calls.every((c) => !c.visit)).toBe(true);
  });
});
