import { randomUUID } from 'node:crypto';
import { test as base, expect, APIRequestContext } from '@playwright/test';

/**
 * The kit's one way of talking to your backend: plain HTTP against
 * SHOP_BASE_URL, with your shop key on every call. No browser, no database
 * access, nothing but the contract's own routes (and its /dev/* routes).
 */

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set. See the kit's README: SHOP_BASE_URL, SHOP_KEY and SHOP_STAFF_CODE are required.`);
  return value;
}

export const env = {
  get baseUrl(): string {
    return required('SHOP_BASE_URL').replace(/\/+$/, '');
  },
  get key(): string {
    return required('SHOP_KEY');
  },
  get staffCode(): string {
    return required('SHOP_STAFF_CODE');
  },
};

export interface Res<T = any> {
  status: number;
  body: T;
  headers: Record<string, string>;
  text: string;
}

export interface CallOptions {
  /** A staff (gkst_…) or customer (gkcu_…) token, sent as Authorization: Bearer. */
  token?: string;
  headers?: Record<string, string>;
  /** Send this instead of JSON (a CSV, an image). */
  raw?: { contentType: string; data: string | Buffer };
  /** Leave out the shop key (to test that it is required). */
  noKey?: boolean;
  /** Use this key instead of SHOP_KEY. */
  key?: string;
}

const MAX_429_RETRIES = 6;

/** A unique, short tag for this test's own data (SKUs, names, emails). */
export function uid(): string {
  return randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
}

export class Shop {
  constructor(private readonly request: APIRequestContext) {}

  get base(): string {
    return env.baseUrl;
  }

  url(path: string): string {
    return path.startsWith('http') ? path : `${env.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
  }

  /**
   * One call. A 429 is waited out (Retry-After, at most 65 s) and retried, so
   * your rate limit never fails a test — the kit is slower instead.
   */
  async call<T = any>(method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'OPTIONS', path: string, data?: unknown, opts: CallOptions = {}): Promise<Res<T>> {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (!opts.noKey) headers['X-Shop-Key'] = opts.key ?? env.key;
    if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;

    let payload: string | Buffer | undefined;
    if (opts.raw) {
      headers['Content-Type'] = opts.raw.contentType;
      payload = opts.raw.data;
    } else if (data !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(data);
    }

    for (let attempt = 0; ; attempt++) {
      const res = await this.request.fetch(this.url(path), {
        method,
        headers,
        data: payload,
        maxRedirects: 0,
        ignoreHTTPSErrors: true,
        timeout: 30_000,
      });
      if (res.status() === 429 && attempt < MAX_429_RETRIES) {
        const after = Number(res.headers()['retry-after']);
        const seconds = Number.isFinite(after) && after > 0 ? Math.min(after, 65) : 10;
        await new Promise((r) => setTimeout(r, seconds * 1000 + 250));
        continue;
      }
      const text = await res.text();
      let body: any = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      return { status: res.status(), body, headers: res.headers(), text };
    }
  }

  get<T = any>(path: string, opts?: CallOptions) {
    return this.call<T>('GET', path, undefined, opts);
  }
  post<T = any>(path: string, data?: unknown, opts?: CallOptions) {
    return this.call<T>('POST', path, data ?? {}, opts);
  }
  put<T = any>(path: string, data?: unknown, opts?: CallOptions) {
    return this.call<T>('PUT', path, data ?? {}, opts);
  }
  delete<T = any>(path: string, opts?: CallOptions) {
    return this.call<T>('DELETE', path, undefined, opts);
  }

  /**
   * Opens the order's payment page and presses Pay (test) or Decline (test):
   * a form POST of result=paid|failed to the paymentUrl itself.
   */
  async pay(paymentUrl: string, result: 'paid' | 'failed' = 'paid', returnUrl?: string) {
    const form: Record<string, string> = { result };
    if (returnUrl) form.returnUrl = returnUrl;
    const res = await this.request.post(paymentUrl, { form, maxRedirects: 0, ignoreHTTPSErrors: true, timeout: 30_000 });
    return { status: res.status(), headers: res.headers(), text: await res.text() };
  }

  // ── staff ───────────────────────────────────────────────────────────────

  async signInStaff(): Promise<string> {
    const session = await this.post('/staff/sessions', { staffCode: env.staffCode });
    expect(session.status, `staff sign-in with SHOP_STAFF_CODE: ${session.text}`).toBe(201);
    expect(typeof session.body.token).toBe('string');
    return session.body.token as string;
  }

  // ── building blocks every test uses for its OWN data ────────────────────

  async newCategory(staff: string, name = `Kit ${uid()}`): Promise<number> {
    const category = await this.post('/categories', { name, sortOrder: 1 }, { token: staff });
    expect(category.status, category.text).toBe(201);
    return category.body.id;
  }

  /** A fresh product (unique SKU) with `stock` booked in through goods-in. */
  async newProduct(
    staff: string,
    p: { name?: string; priceMinor?: number; reorderLevel?: number; stock?: number; isActive?: boolean; categoryId?: number } = {},
  ): Promise<Product> {
    const tag = uid();
    const categoryId = p.categoryId ?? (await this.newCategory(staff));
    const created = await this.post(
      '/products',
      {
        sku: `KIT-${tag}`,
        name: p.name ?? `Kit item ${tag}`,
        categoryId,
        priceMinor: p.priceMinor ?? 100,
        reorderLevel: p.reorderLevel ?? 0,
        isActive: p.isActive ?? true,
      },
      { token: staff },
    );
    expect(created.status, created.text).toBe(201);
    if ((p.stock ?? 0) > 0) {
      const gi = await this.post('/stock/goods-in', { productId: created.body.id, quantity: p.stock }, { token: staff });
      expect(gi.status, gi.text).toBe(201);
    }
    // Customers (the shop key alone) see active products only, so an inactive one is what staff got back.
    return p.isActive === false ? (created.body as Product) : await this.product(created.body.id);
  }

  async product(id: number): Promise<Product> {
    const read = await this.get(`/products/${id}`);
    expect(read.status, read.text).toBe(200);
    return read.body;
  }

  async newBasket(lines: [productId: number, quantity: number][], token?: string): Promise<string> {
    const basket = await this.post('/baskets', {}, { token });
    expect(basket.status, basket.text).toBe(201);
    for (const [productId, quantity] of lines) {
      const line = await this.put(`/baskets/${basket.body.basketId}/lines/${productId}`, { quantity }, { token });
      expect(line.status, line.text).toBe(200);
    }
    return basket.body.basketId;
  }

  /** An available slot; `fromDay` skips that many days ahead (0 = the first available). */
  async slot(fromDay = 0): Promise<string> {
    const slots = await this.get('/delivery-slots');
    expect(slots.status, slots.text).toBe(200);
    const days = [...new Set((slots.body as Slot[]).map((s) => s.slotId.slice(0, 8)))];
    const open = (slots.body as Slot[]).filter((s) => s.isAvailable && days.indexOf(s.slotId.slice(0, 8)) >= fromDay);
    expect(open.length, 'an available delivery slot').toBeGreaterThan(0);
    return open[0].slotId;
  }

  orderBody(basketId: string, slotId: string, extra: Record<string, unknown> = {}) {
    const tag = uid().toLowerCase();
    return {
      basketId,
      customer: { name: 'Kit Buyer', email: `buyer.${tag}@example.com` },
      address: { line1: '1 Market Street', city: 'Brussels', postcode: POSTCODE },
      slotId,
      ...extra,
    };
  }

  async placeOrder(body: Record<string, unknown>, opts: { token?: string; idempotencyKey?: string } = {}) {
    return this.post('/orders', body, { token: opts.token, headers: { 'Idempotency-Key': opts.idempotencyKey ?? randomUUID() } });
  }

  /** A placed (and, unless told otherwise, paid) order of `quantity` × product. */
  async order(productId: number, quantity: number, o: { pay?: boolean; token?: string; extra?: Record<string, unknown> } = {}) {
    const basketId = await this.newBasket([[productId, quantity]]);
    const body = this.orderBody(basketId, await this.slot(), o.extra);
    const placed = await this.placeOrder(body, { token: o.token });
    expect(placed.status, placed.text).toBe(201);
    if (o.pay !== false) {
      const paid = await this.pay(placed.body.paymentUrl, 'paid');
      expect(paid.status, 'the payment page accepts Pay (test)').toBeLessThan(400);
    }
    return { order: placed.body as Order, body };
  }

  // ── shop customers (customer-accounts, ask-unavailable-item, favourites-reorder) ──

  /** Signs a new synthetic customer in with the one-time code from GET /dev/outbox. */
  async signInCustomer(email = `customer.${uid().toLowerCase()}@example.com`): Promise<{ token: string; email: string }> {
    const issued = await this.post('/customers/sign-in-codes', { email });
    expect(issued.status, issued.text).toBe(202);
    const code = await this.signInCode(email);
    const session = await this.post('/customers/sessions', { email, code });
    expect(session.status, session.text).toBe(201);
    return { token: session.body.token, email };
  }

  async signInCode(email: string): Promise<string> {
    const outbox = await this.get('/dev/outbox');
    expect(outbox.status, outbox.text).toBe(200);
    const mail = (outbox.body as OutboxMail[]).find((m) => m.to === email && m.subject === 'Your sign-in code');
    expect(mail, `a "Your sign-in code" mail to ${email} in GET /dev/outbox`).toBeTruthy();
    const match = /\b(\d{6})\b/.exec(mail!.bodyText);
    expect(match, 'a 6-digit code in the mail').toBeTruthy();
    return match![1];
  }
}

export interface Product {
  id: number;
  sku: string;
  name: string;
  categoryId: number;
  priceMinor: number;
  currency: string;
  stockOnHand: number;
  stockAvailable: number;
  reorderLevel: number;
  isActive: boolean;
  imageUrl?: string;
}

export interface Slot {
  slotId: string;
  startsAtUtc: string;
  endsAtUtc: string;
  isAvailable: boolean;
}

export interface OrderLine {
  productId: number;
  name: string;
  priceMinor: number;
  quantity: number;
  lineTotalMinor: number;
  substituteProductId?: number;
  substituteName?: string;
}

export interface Order {
  orderNumber: string;
  status: string;
  lines: OrderLine[];
  totalMinor: number;
  currency: string;
  slot: { slotId: string; startsAtUtc: string; endsAtUtc: string };
  createdAtUtc: string;
  paymentUrl?: string;
  subtotalMinor?: number;
  discountCode?: string;
  discountMinor?: number;
  deliveryFeeMinor?: number;
  fulfilment?: string;
}

export interface OutboxMail {
  id: number | string;
  to: string;
  subject: string;
  bodyText: string;
  orderNumber?: string;
  createdAtUtc: string;
}

/** The contract's error shape: RFC 9457 problem details with a stable `code`. */
export function expectProblem(res: Res, status: number, code: string) {
  expect(res.status, `${code}: ${res.text}`).toBe(status);
  expect(res.body?.code, res.text).toBe(code);
}

/** The delivery postcode every kit order uses (the second detail for tracking and cancelling). */
export const POSTCODE = '1000 AB';

/** An order number: GS- and 10 characters of the 31 without look-alikes (no 0, 1, I, L, O). */
export const ORDER_NUMBER = /^GS-[2-9A-HJKMNP-Z]{10}$/;

/** The fixtures every test gets: `shop` (your key) and `staff` (a staff token for SHOP_STAFF_CODE). */
export const test = base.extend<{ shop: Shop; staff: string }>({
  shop: async ({ request }, use) => {
    await use(new Shop(request));
  },
  staff: async ({ shop }, use) => {
    await use(await cachedStaffToken(shop));
  },
});

let staffToken: string | undefined;

/** One staff session per test worker; signed in again if it was ended. */
async function cachedStaffToken(shop: Shop): Promise<string> {
  if (staffToken) {
    const check = await shop.get('/stock/low', { token: staffToken });
    if (check.status === 200) return staffToken;
  }
  staffToken = await shop.signInStaff();
  return staffToken;
}

export { expect };
