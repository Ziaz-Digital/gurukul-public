import { Component, OnInit, ViewEncapsulation, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ShopDeliveryRules, ShopProduct } from '../../gurukul-shop-client/shop-client';
import { ShopService, money } from '../shop.service';

/**
 * The basket (core `checkout-reservation`): change quantities, remove, and — with
 * `substitutions` — say what may replace a product that runs out. Every change shows a
 * busy state: the server can take a few seconds, and a silent button looks broken.
 */
@Component({
  selector: 'app-basket',
  encapsulation: ViewEncapsulation.None,
  imports: [RouterLink],
  template: `
    <h1>Your basket</h1>
    @if (error()) {
      <p class="error" role="alert">{{ error() }}</p>
    }
    <p class="sr-only" role="status" aria-live="polite">{{ shop.busyLine() !== null ? 'Updating your basket…' : '' }}</p>
    @if (!shop.basket()?.lines?.length) {
      <div class="empty">
        <p>Your basket is empty.</p>
        <p><a routerLink="/" class="button primary">Go shopping</a></p>
      </div>
    } @else {
      @let b = shop.basket()!;
      <ul class="lines" aria-label="Basket lines">
        @for (l of b.lines; track l.productId) {
          <li [class.busy]="shop.busyLine() === l.productId">
            <div class="what">
              <a [routerLink]="['/product', l.productId]">{{ l.name }}</a>
              <span class="muted small">{{ money(l.priceMinor, b.currency) }} each</span>
              @if (shop.has('substitutions')) {
                <label class="small">
                  If it runs out
                  <select
                    [value]="l.substituteProductId ?? ''"
                    [disabled]="shop.busyLine() !== null"
                    (change)="substitute(l.productId, $any($event.target).value)"
                    [attr.aria-label]="'If ' + l.name + ' runs out'"
                  >
                    <option value="">No substitute</option>
                    @for (s of substitutesFor(l.productId); track s.id) {
                      <option [value]="s.id">Replace with {{ s.name }}</option>
                    }
                  </select>
                </label>
              }
            </div>
            <div class="qty" role="group" [attr.aria-label]="'Quantity of ' + l.name">
              <button type="button" class="icon" [disabled]="shop.busyLine() !== null" (click)="change(l.productId, l.quantity - 1)" [attr.aria-label]="'One less ' + l.name">−</button>
              <span class="n" aria-live="polite">{{ shop.busyLine() === l.productId ? '…' : l.quantity }}</span>
              <button type="button" class="icon" [disabled]="shop.busyLine() !== null || l.quantity >= 99" (click)="change(l.productId, l.quantity + 1)" [attr.aria-label]="'One more ' + l.name">+</button>
            </div>
            <span class="amount">{{ money(l.lineTotalMinor, b.currency) }}</span>
            <button type="button" class="link" [disabled]="shop.busyLine() !== null" (click)="remove(l.productId)" [attr.aria-label]="'Remove ' + l.name">Remove</button>
          </li>
        }
      </ul>
      <div class="summary">
        <p class="total">Total {{ money(b.totalMinor, b.currency) }}</p>
        @if (freeOver(); as hint) {
          <p class="muted small">{{ hint }}</p>
        }
        <a routerLink="/checkout" class="button primary" [class.disabled]="shop.busyLine() !== null">Go to checkout</a>
      </div>
    }
  `,
})
export class BasketComponent implements OnInit {
  protected readonly shop = inject(ShopService);
  protected readonly money = money;
  protected readonly error = signal<string | null>(null);
  private readonly catalogue = signal<ShopProduct[]>([]);
  private readonly rules = signal<ShopDeliveryRules | null>(null);

  /** "Free delivery over €40" from the fee bands (`delivery-fees-cutoffs`). */
  protected readonly freeOver = computed(() => {
    const r = this.rules();
    const b = this.shop.basket();
    if (!r?.feeBands.length || !b) return '';
    const free = [...r.feeBands].sort((x, y) => x.minBasketMinor - y.minBasketMinor).find((x) => x.feeMinor === 0 && x.minBasketMinor > 0);
    if (!free) return 'Delivery fee is added at checkout.';
    return b.totalMinor >= free.minBasketMinor ? 'Free delivery on this basket.' : `Free delivery over ${money(free.minBasketMinor, b.currency)}.`;
  });

  async ngOnInit(): Promise<void> {
    try {
      await this.shop.loadBasket();
    } catch (e) {
      this.error.set(this.shop.explain(e));
    }
    this.shop.deliveryRules().then((r) => this.rules.set(r));
    if (this.shop.has('substitutions') && this.shop.basket()?.lines.length) {
      this.shop
        .products({ pageSize: 100 })
        .then((page) => this.catalogue.set(page.items))
        .catch((e) => this.error.set(this.shop.explain(e)));
    }
  }

  protected substitutesFor(productId: number): ShopProduct[] {
    const self = this.catalogue().find((p) => p.id === productId);
    const list = this.catalogue().filter((p) => p.id !== productId && p.stockAvailable > 0);
    // Same category first: the likeliest replacement.
    return self ? [...list.filter((p) => p.categoryId === self.categoryId), ...list.filter((p) => p.categoryId !== self.categoryId)] : list;
  }

  protected async change(productId: number, quantity: number): Promise<void> {
    this.error.set(null);
    try {
      await this.shop.setQuantity(productId, quantity);
    } catch (e) {
      this.error.set(this.shop.explain(e));
    }
  }

  protected async remove(productId: number): Promise<void> {
    this.error.set(null);
    try {
      await this.shop.remove(productId);
    } catch (e) {
      this.error.set(this.shop.explain(e));
    }
  }

  protected async substitute(productId: number, value: string): Promise<void> {
    this.error.set(null);
    try {
      await this.shop.setSubstitute(productId, value ? Number(value) : null);
    } catch (e) {
      this.error.set(this.shop.explain(e));
    }
  }
}
