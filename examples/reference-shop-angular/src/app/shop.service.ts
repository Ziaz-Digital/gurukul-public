import { Injectable, computed, inject, signal } from '@angular/core';
import {
  ShopApiError,
  ShopBasket,
  ShopCategory,
  ShopClient,
  ShopCustomerProfile,
  ShopDeliveryRules,
  ShopDeliverySlot,
  ShopItemRequest,
  ShopOpeningHours,
  ShopPageOfShopProduct,
  ShopProduct,
} from '../gurukul-shop-client/shop-client';
import { AddOn, BUILT_FOR, SIGN_IN_ADD_ONS } from './capabilities';
import { GkHost } from './gk-host';
import { messageFor } from './messages';

/** How long a catalogue read is reused (product lists, search results, product details, slots). */
export const READ_TTL_MS = 60_000;
/** Read once per visit and kept (they change rarely). */
const FOREVER = Number.POSITIVE_INFINITY;

interface CachedRead {
  at: number;
  ttl: number;
  value: Promise<unknown>;
}

interface StoredCustomer {
  token: string;
  profile: ShopCustomerProfile;
}

/** The order this browser placed last, with the second detail tracking and cancelling need. */
export interface LastOrder {
  orderNumber: string;
  /** collection orders are tracked and cancelled with the buyer's email, delivery orders with the postcode. */
  fulfilment: 'delivery' | 'collection';
  second: string;
}

/**
 * The shop's shared state: the API client (from the host), which add-ons are on, the
 * basket, the signed-in customer, the staff session, and a small read cache.
 *
 * ── The daily request budget ──
 * A published project may make only a limited number of public-key API calls a day
 * (D-500 addendum 9), so this shop is frugal with READS: categories, delivery rules and
 * opening hours are read once per visit; product lists, search results, product details
 * and delivery slots are reused for READ_TTL_MS (and dropped as soon as the shopper adds
 * to the basket or places an order, so stock stays honest). Nothing polls. The basket,
 * orders, payment and everything about the customer are never cached.
 */
@Injectable({ providedIn: 'root' })
export class ShopService {
  private readonly host = inject(GkHost);

  get client(): ShopClient {
    return this.host.bridge.client;
  }
  readonly hosted = this.host.hosted;

  // ---------------------------------------------------------------- add-ons

  /** Add-ons the server said were not chosen (404 capability.not_chosen), for this visit. */
  private readonly off = signal<ReadonlySet<string>>(new Set());

  /** Is this add-on on? Built for it, and the server has not said no. */
  has(addOn: AddOn): boolean {
    return BUILT_FOR.has(addOn) && !this.off().has(addOn);
  }
  /** The shared customer sign-in: on when any of its three add-ons is. */
  readonly signInOn = computed(() => SIGN_IN_ADD_ONS.some((a) => BUILT_FOR.has(a) && !this.off().has(a)));

  /**
   * The one place an API error turns into a sentence. It also learns from it: an add-on
   * the server says is not chosen is hidden from now on, and an ended session is dropped.
   */
  explain(e: unknown): string {
    if (e instanceof ShopApiError) {
      if (e.code === 'capability.not_chosen') {
        const cap = String(e.problem['capability'] ?? '');
        if (cap) this.off.update((s) => new Set([...s, cap]));
        return 'This part of the shop is not switched on.';
      }
      if (e.code === 'customer.session_invalid' || e.code === 'customer.required') this.forgetCustomer();
      if (e.code === 'staff.session_invalid' || e.code === 'staff.required') this.forgetStaff();
    }
    return messageFor(e);
  }

  // ------------------------------------------------------------ read cache

  private readonly reads = new Map<string, CachedRead>();

  private cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
    const hit = this.reads.get(key);
    if (hit && Date.now() - hit.at < hit.ttl) return hit.value as Promise<T>;
    const value = load();
    this.reads.set(key, { at: Date.now(), ttl, value });
    value.catch(() => this.reads.delete(key));
    return value;
  }

  /** Stock may have moved: the next product read goes to the server. */
  refreshStock(): void {
    for (const key of [...this.reads.keys()]) if (key.startsWith('products') || key === 'slots') this.reads.delete(key);
  }

  categories(): Promise<ShopCategory[]> {
    return this.cached('categories', FOREVER, () => this.client.getCategories());
  }

  products(query: { search?: string; categoryId?: number; page?: number; pageSize?: number }): Promise<ShopPageOfShopProduct> {
    return this.cached(`products?${JSON.stringify(query)}`, READ_TTL_MS, () => this.client.getProducts({ query }));
  }

  product(id: number): Promise<ShopProduct> {
    return this.cached(`products/${id}`, READ_TTL_MS, () => this.client.getProductsById(id));
  }

  slots(): Promise<ShopDeliverySlot[]> {
    return this.cached('slots', READ_TTL_MS, () => this.client.getDeliverySlots());
  }

  /** Delivery fee bands, or null when the add-on is off. */
  async deliveryRules(): Promise<ShopDeliveryRules | null> {
    if (!this.has('delivery-fees-cutoffs')) return null;
    try {
      return await this.cached('delivery-rules', FOREVER, () => this.client.getDeliveryRules());
    } catch (e) {
      this.explain(e);
      return null;
    }
  }

  /** Opening hours and closures, or null when the add-on is off. */
  async openingHours(): Promise<ShopOpeningHours | null> {
    if (!this.has('opening-hours')) return null;
    try {
      return await this.cached('opening-hours', FOREVER, () => this.client.getOpeningHours());
    } catch (e) {
      this.explain(e);
      return null;
    }
  }

  // ----------------------------------------------------------- product images

  /** Object URLs of product images, by product id (an <img src> cannot send the shop key). */
  readonly images = signal<Record<number, string>>({});
  private readonly imageAsked = new Set<number>();

  loadImages(products: ShopProduct[]): void {
    if (!this.has('product-images')) return;
    for (const p of products) {
      if (!p.imageUrl || this.imageAsked.has(p.id)) continue;
      this.imageAsked.add(p.id);
      this.client
        .getProductsImage(p.id)
        .then((blob) => this.images.update((m) => ({ ...m, [p.id]: URL.createObjectURL(blob) })))
        .catch((e) => this.explain(e));
    }
  }

  releaseImages(): void {
    for (const url of Object.values(this.images())) URL.revokeObjectURL(url);
    this.images.set({});
    this.imageAsked.clear();
  }

  // ------------------------------------------------------------------ storage

  /** Every key starts with gk-<project-code>- (project-bundle.md §5). */
  private read(name: string): string | null {
    try {
      return sessionStorage.getItem(this.host.bridge.storageKey(name));
    } catch {
      return null;
    }
  }
  private write(name: string, value: string | null): void {
    try {
      const key = this.host.bridge.storageKey(name);
      if (value === null) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, value);
    } catch {
      /* storage blocked: it lasts until the page closes */
    }
  }

  // ------------------------------------------------------------------- basket

  readonly basket = signal<ShopBasket | null>(null);
  readonly count = computed(() => this.basket()?.lines.reduce((n, l) => n + l.quantity, 0) ?? 0);
  /** The product whose basket line is being changed right now (the server can take a few seconds). */
  readonly busyLine = signal<number | null>(null);
  private basketLoaded = false;

  private get basketId(): string | null {
    return this.read('basket');
  }

  /** Reads the basket once per visit; after that the signal is the truth (every change returns the basket). */
  async loadBasket(force = false): Promise<void> {
    if (this.basketLoaded && !force) return;
    const id = this.basketId;
    if (!id) {
      this.basketLoaded = true;
      return this.basket.set(null);
    }
    try {
      this.basket.set(await this.client.getBasketsByBasketId(id));
      this.basketLoaded = true;
    } catch (e) {
      if (e instanceof ShopApiError && e.status === 404) {
        this.write('basket', null);
        this.basket.set(null);
        this.basketLoaded = true;
      } else throw e;
    }
  }

  quantityOf(productId: number): number {
    return this.basket()?.lines.find((l) => l.productId === productId)?.quantity ?? 0;
  }

  private async withLine<T>(productId: number, work: () => Promise<T>): Promise<T> {
    this.busyLine.set(productId);
    try {
      return await work();
    } finally {
      this.busyLine.set(null);
    }
  }

  /** Adds `quantity` more of a product (a new basket when there is none or it expired). */
  add(productId: number, quantity = 1): Promise<void> {
    return this.withLine(productId, async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        let id = this.basketId;
        if (!id) {
          id = (await this.client.postBaskets()).basketId;
          this.write('basket', id);
        }
        const current = this.basket()?.basketId === id ? this.quantityOf(productId) : 0;
        try {
          this.basket.set(await this.client.putBasketsLinesByProductId(id, productId, { body: { quantity: Math.min(99, current + quantity) } }));
          this.refreshStock();
          return;
        } catch (e) {
          if (e instanceof ShopApiError && e.code === 'basket.not_found') this.write('basket', null);
          else throw e;
        }
      }
    });
  }

  setQuantity(productId: number, quantity: number): Promise<void> {
    const id = this.basketId;
    if (!id) return Promise.resolve();
    if (quantity < 1) return this.remove(productId);
    return this.withLine(productId, async () => {
      this.basket.set(await this.client.putBasketsLinesByProductId(id, productId, { body: { quantity: Math.min(99, quantity) } }));
    });
  }

  remove(productId: number): Promise<void> {
    const id = this.basketId;
    if (!id) return Promise.resolve();
    return this.withLine(productId, async () => {
      this.basket.set(await this.client.deleteBasketsLinesByProductId(id, productId));
    });
  }

  setSubstitute(productId: number, substituteProductId: number | null): Promise<void> {
    const id = this.basketId;
    if (!id) return Promise.resolve();
    return this.withLine(productId, async () => {
      this.basket.set(
        substituteProductId
          ? await this.client.putBasketsLinesSubstitute(id, productId, { body: { substituteProductId } })
          : await this.client.deleteBasketsLinesSubstitute(id, productId),
      );
    });
  }

  /** A basket made by the server (order again) becomes this browser's basket. */
  adoptBasket(basket: ShopBasket): void {
    this.write('basket', basket.basketId);
    this.basket.set(basket);
    this.basketLoaded = true;
  }

  /** The basket became an order (the server consumed it). */
  basketOrdered(): void {
    this.write('basket', null);
    this.write('checkout-key', null);
    this.basket.set(null);
    this.refreshStock();
  }

  /**
   * The Idempotency-Key for checking out THIS basket: the same key on every retry, so a
   * double click or a slow answer can never make two orders (shop-server.md).
   */
  idempotencyKey(basketId: string): string {
    const saved = this.read('checkout-key');
    const [forBasket, key] = (saved ?? '').split('|');
    if (forBasket === basketId && key) return key;
    const fresh = crypto.randomUUID();
    this.write('checkout-key', `${basketId}|${fresh}`);
    return fresh;
  }

  /**
   * The ONE full-page navigation a bundle may make (project-bundle.md §4): to the order's
   * simulated payment page, which comes back to /confirmation?orderNumber=…&result=…
   * under our base path. The confirmation page never trusts `result`; it reads the order.
   */
  openPayment(paymentUrl: string): void {
    const url = new URL(paymentUrl);
    url.searchParams.set('returnUrl', this.host.bridge.absoluteUrl('/confirmation'));
    window.location.assign(url.toString());
  }

  /** The server refused the order (4xx): the next attempt is a new request with a new key. */
  forgetCheckoutKey(): void {
    this.write('checkout-key', null);
  }

  // --------------------------------------------------------------- last order

  saveLastOrder(order: LastOrder): void {
    this.write('last-order', JSON.stringify(order));
  }
  lastOrder(): LastOrder | null {
    try {
      return JSON.parse(this.read('last-order') ?? 'null') as LastOrder | null;
    } catch {
      return null;
    }
  }

  // ----------------------------------------------------------------- customer

  readonly customer = signal<ShopCustomerProfile | null>(null);
  readonly favouriteIds = signal<ReadonlySet<number>>(new Set());
  /** "Still looking for X? We have it now." — what the dialog shows after sign-in. */
  readonly availableRequests = signal<ShopItemRequest[]>([]);
  private favouritesLoaded = false;

  /** Picks up a session kept in this tab (no API call: a stale token shows itself on first use). */
  restoreSessions(): void {
    try {
      const saved = JSON.parse(this.read('customer') ?? 'null') as StoredCustomer | null;
      if (saved?.token) {
        this.client.customerToken = saved.token;
        this.customer.set(saved.profile);
      }
    } catch {
      this.write('customer', null);
    }
    const staff = this.read('staff');
    if (staff && !this.hosted()) {
      this.client.staffToken = staff;
      this.staffSignedIn.set(true);
    }
  }

  requestSignInCode(email: string) {
    return this.client.postCustomersSignInCodes({ body: { email } });
  }

  async signIn(email: string, code: string): Promise<void> {
    const session = await this.client.postCustomersSessions({ body: { email, code } });
    this.client.customerToken = session.token;
    this.customer.set(session.customer);
    this.write('customer', JSON.stringify({ token: session.token, profile: session.customer } satisfies StoredCustomer));
    this.favouritesLoaded = false;
    await this.checkAvailableRequests();
  }

  async signOut(): Promise<void> {
    try {
      await this.client.deleteCustomersSessionsCurrent();
    } catch {
      /* already ended: nothing to do */
    }
    this.forgetCustomer();
  }

  private forgetCustomer(): void {
    if (this.host.ready()) this.client.customerToken = null;
    this.write('customer', null);
    this.customer.set(null);
    this.favouriteIds.set(new Set());
    this.availableRequests.set([]);
    this.favouritesLoaded = false;
  }

  /** The dialog's read, made once after sign-in. */
  async checkAvailableRequests(): Promise<void> {
    if (!this.customer() || !this.has('ask-unavailable-item')) return;
    try {
      this.availableRequests.set(await this.client.getCustomersMeAvailableRequests());
    } catch (e) {
      this.explain(e);
    }
  }

  async dismissRequest(id: number): Promise<void> {
    this.availableRequests.update((list) => list.filter((r) => r.id !== id));
    try {
      await this.client.deleteCustomersMeItemRequestsById(id);
    } catch (e) {
      this.explain(e);
    }
  }

  async loadFavourites(): Promise<ShopProduct[]> {
    const list = await this.client.getCustomersMeFavourites();
    this.favouriteIds.set(new Set(list.map((p) => p.id)));
    this.favouritesLoaded = true;
    return list;
  }

  /** Favourite ids for the hearts on product cards, read once per sign-in. */
  async ensureFavouriteIds(): Promise<void> {
    if (this.favouritesLoaded || !this.customer() || !this.has('favourites-reorder')) return;
    try {
      await this.loadFavourites();
    } catch (e) {
      this.explain(e);
    }
  }

  async toggleFavourite(productId: number): Promise<void> {
    const on = this.favouriteIds().has(productId);
    if (on) await this.client.deleteCustomersMeFavouritesByProductId(productId);
    else await this.client.putCustomersMeFavouritesByProductId(productId);
    this.favouriteIds.update((s) => {
      const next = new Set(s);
      if (on) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }

  // -------------------------------------------------------------------- staff

  readonly staffSignedIn = signal(false);

  async staffSignIn(staffCode: string): Promise<void> {
    await this.client.signInStaff(staffCode);
    this.write('staff', this.client.staffToken);
    this.staffSignedIn.set(true);
  }

  async staffSignOut(): Promise<void> {
    try {
      await this.client.deleteStaffSessionsCurrent();
    } catch {
      /* already ended */
    }
    this.forgetStaff();
  }

  private forgetStaff(): void {
    if (this.host.ready()) this.client.staffToken = null;
    this.write('staff', null);
    this.staffSignedIn.set(false);
  }

  /** Staff read every product, active or not (the staff token on GET /products). */
  staffProducts(search = ''): Promise<ShopPageOfShopProduct> {
    return this.client.getProducts({ query: { search, pageSize: 100 }, token: this.client.staffToken ?? undefined });
  }
}

// ------------------------------------------------------------------- helpers

/** The shop's time zone (fixed to Europe/Brussels per data space, shop-server.md). */
export const SHOP_TIME_ZONE = 'Europe/Brussels';

/** Money is integer minor units (shop-server.md). */
export function money(minor: number | null | undefined, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format((minor ?? 0) / 100);
}

export function dayLabel(utc: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', timeZone: SHOP_TIME_ZONE }).format(new Date(utc));
}

export function timeLabel(utc: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', timeZone: SHOP_TIME_ZONE }).format(new Date(utc));
}

export function slotLabel(slot: { startsAtUtc: string; endsAtUtc: string }): string {
  return `${dayLabel(slot.startsAtUtc)}, ${timeLabel(slot.startsAtUtc)}–${timeLabel(slot.endsAtUtc)}`;
}

export function dateTimeLabel(utc: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: SHOP_TIME_ZONE }).format(new Date(utc));
}

/** What an order status means to a shopper. */
export const STATUS_TEXT: Record<string, string> = {
  'awaiting-payment': 'Waiting for payment',
  paid: 'Paid — we are getting it ready',
  packed: 'Packed',
  'out-for-delivery': 'Out for delivery',
  delivered: 'Delivered',
  collected: 'Collected',
  'payment-failed': 'Payment declined',
  expired: 'Expired (not paid in time)',
  'delivery-failed': 'Delivery failed',
  cancelled: 'Cancelled',
};

/** "12.50" → 1250; null when it is not a price. */
export function toMinor(text: string): number | null {
  const v = Number(String(text).replace(',', '.'));
  return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) : null;
}
