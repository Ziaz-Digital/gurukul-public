import { Component, OnInit, ViewEncapsulation, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ShopAddress, ShopApiError, ShopDeliveryRules, ShopDeliverySlot } from '../../gurukul-shop-client/shop-client';
import { fieldErrors } from '../messages';
import { ShopService, dayLabel, money, timeLabel } from '../shop.service';

interface SlotDay {
  label: string;
  slots: ShopDeliverySlot[];
}

/**
 * Checkout (core `checkout-reservation` + `payment`): delivery or collection
 * (`click-and-collect`), a slot, the address (saved ones with `customer-accounts`),
 * a discount code (`discount-codes`), the delivery fee (`delivery-fees-cutoffs`).
 * "Place order" sends ONE Idempotency-Key per basket, then opens the payment page.
 */
@Component({
  selector: 'app-checkout',
  encapsulation: ViewEncapsulation.None,
  imports: [FormsModule, RouterLink],
  template: `
    <p><a routerLink="/basket" class="back">← Back to your basket</a></p>
    <h1>Checkout</h1>
    @if (!shop.basket()?.lines?.length) {
      <div class="empty">
        <p>Your basket is empty.</p>
        <p><a routerLink="/" class="button primary">Go shopping</a></p>
      </div>
    } @else {
      @let b = shop.basket()!;
      <form class="checkout" (ngSubmit)="place()" novalidate>
        @if (shop.has('click-and-collect')) {
          <fieldset>
            <legend>How do you want it?</legend>
            <div class="choice">
              <label><input type="radio" name="fulfilment" value="delivery" [(ngModel)]="fulfilment" /> Deliver to my door</label>
              <label><input type="radio" name="fulfilment" value="collection" [(ngModel)]="fulfilment" /> I will collect it from the shop</label>
            </div>
          </fieldset>
        }

        <fieldset>
          <legend>Your details</legend>
          <div class="fields">
            <label>Name <input name="name" autocomplete="name" required [(ngModel)]="name" [attr.aria-invalid]="!!errors()['customer.name']" /></label>
            @if (errors()['customer.name']) { <span class="error small">{{ errors()['customer.name'] }}</span> }
            <label>Email <input name="email" type="email" autocomplete="email" required [(ngModel)]="email" [attr.aria-invalid]="!!errors()['customer.email']" /></label>
            @if (errors()['customer.email']) { <span class="error small">{{ errors()['customer.email'] }}</span> }
            <label>Phone (optional) <input name="phone" type="tel" autocomplete="tel" [(ngModel)]="phone" /></label>
          </div>
        </fieldset>

        @if (fulfilment === 'delivery') {
          <fieldset>
            <legend>Delivery address</legend>
            @if (addresses().length) {
              <label>
                Saved addresses
                <select name="saved" (change)="useAddress($any($event.target).value)">
                  <option value="">Type a new address</option>
                  @for (a of addresses(); track a.id) {
                    <option [value]="a.id">{{ a.label ? a.label + ': ' : '' }}{{ a.line1 }}, {{ a.city }}</option>
                  }
                </select>
              </label>
            }
            <div class="fields">
              <label>Address <input name="line1" autocomplete="address-line1" required [(ngModel)]="line1" [attr.aria-invalid]="!!errors()['address.line1']" /></label>
              <label>Address line 2 (optional) <input name="line2" autocomplete="address-line2" [(ngModel)]="line2" /></label>
              <label>City <input name="city" autocomplete="address-level2" required [(ngModel)]="city" [attr.aria-invalid]="!!errors()['address.city']" /></label>
              <label>Postcode <input name="postcode" autocomplete="postal-code" required [(ngModel)]="postcode" [attr.aria-invalid]="!!errors()['address.postcode']" /></label>
            </div>
          </fieldset>
        }

        <fieldset>
          <legend>{{ fulfilment === 'collection' ? 'Collection time' : 'Delivery slot' }}</legend>
          @if (!days().length) {
            <p class="muted" role="status">{{ slotsError() || 'Loading the slots…' }}</p>
          }
          @for (d of days(); track d.label) {
            <div class="slot-day">
              <h3>{{ d.label }}</h3>
              <div class="slots">
                @for (s of d.slots; track s.slotId) {
                  <label class="slot" [class.off]="!s.isAvailable" [class.on]="slotId === s.slotId">
                    <input type="radio" name="slot" [value]="s.slotId" [(ngModel)]="slotId" [disabled]="!s.isAvailable" />
                    {{ time(s.startsAtUtc) }}–{{ time(s.endsAtUtc) }}
                  </label>
                }
              </div>
            </div>
          }
          @if (errors()['slotid']) { <p class="error small">{{ errors()['slotid'] }}</p> }
          @if (shop.has('opening-hours')) {
            <p class="muted small">Slots outside our <a routerLink="/hours">opening hours</a> cannot be chosen.</p>
          }
        </fieldset>

        @if (shop.has('discount-codes')) {
          <fieldset>
            <legend>Discount code</legend>
            <label>Code (optional) <input name="discount" autocomplete="off" [(ngModel)]="discountCode" [attr.aria-invalid]="!!errors()['discountcode']" /></label>
            <p class="muted small">One code per order. It comes off the goods, never the delivery fee.</p>
          </fieldset>
        }

        <section class="summary" aria-label="Order summary">
          <p>Goods <span>{{ money(b.totalMinor, b.currency) }}</span></p>
          @if (shop.has('delivery-fees-cutoffs') && fulfilment === 'delivery') {
            <p>Delivery <span>{{ fee() === 0 ? 'Free' : money(fee(), b.currency) }}</span></p>
          }
          @if (discountCode.trim()) {
            <p class="muted small">Your discount is worked out when you place the order.</p>
          }
          <p class="total">To pay <span>{{ money(b.totalMinor + (fulfilment === 'delivery' ? fee() : 0), b.currency) }}</span></p>
        </section>

        @if (error()) {
          <p class="error" role="alert">{{ error() }}</p>
        }
        <button type="submit" class="primary wide" [disabled]="busy() || shop.busyLine() !== null" [attr.aria-busy]="busy()">
          {{ busy() ? 'Placing your order…' : 'Place order and pay' }}
        </button>
        <p class="muted small">You go to a test payment page. Nothing is charged.</p>
      </form>
    }
  `,
})
export class CheckoutComponent implements OnInit {
  protected readonly shop = inject(ShopService);
  private readonly router = inject(Router);
  protected readonly money = money;
  protected readonly time = timeLabel;

  protected fulfilment: 'delivery' | 'collection' = 'delivery';
  protected name = '';
  protected email = '';
  protected phone = '';
  protected line1 = '';
  protected line2 = '';
  protected city = '';
  protected postcode = '';
  protected slotId = '';
  protected discountCode = '';

  protected readonly days = signal<SlotDay[]>([]);
  protected readonly slotsError = signal<string | null>(null);
  protected readonly addresses = signal<ShopAddress[]>([]);
  protected readonly rules = signal<ShopDeliveryRules | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly errors = signal<Record<string, string>>({});

  /** The fee band with the highest minimum at or below the goods (shop-server.md). */
  protected readonly fee = computed(() => {
    const r = this.rules();
    const goods = this.shop.basket()?.totalMinor ?? 0;
    if (!r) return 0;
    const band = [...r.feeBands].filter((x) => x.minBasketMinor <= goods).sort((x, y) => y.minBasketMinor - x.minBasketMinor)[0];
    return band?.feeMinor ?? 0;
  });

  async ngOnInit(): Promise<void> {
    const me = this.shop.customer();
    if (me) this.email = me.email;
    this.shop.loadBasket().catch((e) => this.error.set(this.shop.explain(e)));
    this.shop.deliveryRules().then((r) => this.rules.set(r));
    if (me && this.shop.has('customer-accounts')) {
      this.shop.client
        .getCustomersMeAddresses()
        .then((list) => {
          this.addresses.set(list);
          if (list.length === 1) this.useAddress(String(list[0].id));
        })
        .catch((e) => this.shop.explain(e));
    }
    try {
      const slots = await this.shop.slots();
      const days: SlotDay[] = [];
      for (const s of slots) {
        const label = dayLabel(s.startsAtUtc);
        const day = days.find((d) => d.label === label) ?? days[days.push({ label, slots: [] }) - 1];
        day.slots.push(s);
      }
      this.days.set(days.filter((d) => d.slots.some((s) => s.isAvailable)));
      if (!this.days().length) this.slotsError.set('No slots are free this week. Please try again later.');
    } catch (e) {
      this.slotsError.set(this.shop.explain(e));
    }
  }

  protected useAddress(id: string): void {
    const a = this.addresses().find((x) => String(x.id) === id);
    if (!a) return;
    this.line1 = a.line1;
    this.line2 = a.line2 ?? '';
    this.city = a.city;
    this.postcode = a.postcode;
  }

  protected async place(): Promise<void> {
    const basket = this.shop.basket();
    if (!basket || this.busy()) return;
    const missing: Record<string, string> = {};
    if (!this.name.trim()) missing['customer.name'] = 'Enter your name.';
    if (!/^\S+@\S+\.\S+$/.test(this.email.trim())) missing['customer.email'] = 'Enter an email address.';
    if (this.fulfilment === 'delivery') {
      if (!this.line1.trim()) missing['address.line1'] = 'Enter the address.';
      if (!this.city.trim()) missing['address.city'] = 'Enter the city.';
      if (!this.postcode.trim()) missing['address.postcode'] = 'Enter the postcode.';
    }
    if (!this.slotId) missing['slotid'] = 'Choose a slot.';
    this.errors.set(missing);
    if (Object.keys(missing).length) {
      this.error.set('Please check the highlighted details.');
      return;
    }

    this.busy.set(true);
    this.error.set(null);
    try {
      const collection = this.fulfilment === 'collection';
      const order = await this.shop.client.postOrders({
        headers: { 'Idempotency-Key': this.shop.idempotencyKey(basket.basketId) },
        body: {
          basketId: basket.basketId,
          customer: { name: this.name.trim(), email: this.email.trim(), phone: this.phone.trim() || null },
          address: collection ? null : { line1: this.line1.trim(), line2: this.line2.trim() || null, city: this.city.trim(), postcode: this.postcode.trim() },
          slotId: this.slotId,
          ...(this.shop.has('discount-codes') && this.discountCode.trim() ? { discountCode: this.discountCode.trim() } : {}),
          ...(this.shop.has('click-and-collect') ? { fulfilment: this.fulfilment } : {}),
        },
      });
      this.shop.saveLastOrder({
        orderNumber: order.orderNumber,
        fulfilment: collection ? 'collection' : 'delivery',
        second: collection ? this.email.trim() : this.postcode.trim(),
      });
      this.shop.basketOrdered();
      if (order.paymentUrl) this.shop.openPayment(order.paymentUrl);
      else this.router.navigate(['/confirmation'], { queryParams: { orderNumber: order.orderNumber } });
    } catch (e) {
      this.busy.set(false);
      if (e instanceof ShopApiError && e.status >= 400 && e.status < 500) this.shop.forgetCheckoutKey();
      const fields = fieldErrors(e);
      this.errors.set(fields);
      if (e instanceof ShopApiError && e.code === 'stock.insufficient') {
        const line = basket.lines.find((l) => l.productId === Number(e.problem['productId']));
        this.error.set(`Sorry, we do not have enough ${line?.name ?? 'of one product'} any more. Change the basket and try again.`);
        this.shop.refreshStock();
      } else if (e instanceof ShopApiError && e.code === 'basket.not_found') {
        this.shop.basketOrdered();
        this.error.set('Your basket expired. Please fill it again.');
      } else {
        this.error.set(this.shop.explain(e));
      }
    }
  }
}
