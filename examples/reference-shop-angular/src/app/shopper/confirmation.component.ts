import { Component, DestroyRef, OnInit, ViewEncapsulation, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ShopOrder } from '../../gurukul-shop-client/shop-client';
import { ShopService } from '../shop.service';
import { OrderSummaryComponent } from './order-summary.component';

/**
 * Where the payment page comes back to (core `order-receipt`), and an order page
 * (/order/GS-…). It NEVER trusts `?result=`: it reads GET /orders/{orderNumber}. No
 * polling — "Check again" is a button. With `cancel-before-packing`, an unpacked order
 * can be cancelled here.
 */
@Component({
  selector: 'app-confirmation',
  encapsulation: ViewEncapsulation.None,
  imports: [FormsModule, RouterLink, OrderSummaryComponent],
  template: `
    @if (!orderNumber()) {
      <h1>No order to show</h1>
      <p><a routerLink="/track">Track an order</a> with its number.</p>
    } @else if (error() && !order()) {
      <h1>Order {{ orderNumber() }}</h1>
      <p class="error" role="alert">{{ error() }}</p>
      <button type="button" class="primary" (click)="load()">Try again</button>
    } @else if (!order()) {
      <p class="muted" role="status">Checking your order…</p>
    } @else {
      @let o = order()!;
      @switch (o.status) {
        @case ('awaiting-payment') {
          <h1>Your order is waiting for payment</h1>
          <p>We hold your items for 15 minutes while you pay.</p>
        }
        @case ('payment-failed') {
          <h1>The payment was declined</h1>
          <p>Nothing was charged, and the items went back on the shelf. <a routerLink="/">Shop again</a></p>
        }
        @case ('expired') {
          <h1>This order expired</h1>
          <p>It was not paid within 15 minutes, so the items went back on the shelf.</p>
        }
        @case ('cancelled') {
          <h1>This order is cancelled</h1>
        }
        @default {
          <h1>Thank you! Your order is confirmed.</h1>
          <p>
            Keep your order number <strong class="mono">{{ o.orderNumber }}</strong> to track it.
            @if (!shop.hosted()) { <span class="muted small">(The receipt email is in your shop’s outbox, GET /dev/outbox.)</span> }
          </p>
        }
      }

      @if (o.status === 'awaiting-payment' && o.paymentUrl) {
        <p><button type="button" class="primary" (click)="shop.openPayment(o.paymentUrl)">Go to payment</button></p>
      }

      <app-order-summary [order]="o" />

      <div class="row wrap">
        <a [routerLink]="['/track']" [queryParams]="{ orderNumber: o.orderNumber }" class="button ghost">Track this order</a>
        <button type="button" class="ghost" [disabled]="busy()" [attr.aria-busy]="busy()" (click)="load()">{{ busy() ? 'Checking…' : 'Check again' }}</button>
      </div>

      @if (canCancel(o)) {
        <section class="panel" aria-labelledby="gk-cancel">
          <h2 id="gk-cancel">Changed your mind?</h2>
          <p class="muted small">You can cancel until we start packing.</p>
          @if (!second()) {
            <label>{{ o.fulfilment === 'collection' ? 'Email used for the order' : 'Delivery postcode' }}
              <input name="second" [(ngModel)]="typedSecond" />
            </label>
          }
          <button type="button" class="danger" [disabled]="busy()" (click)="cancel(o)">Cancel this order</button>
        </section>
      }
      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      }
      <p><a routerLink="/">Continue shopping</a></p>
    }
  `,
})
export class ConfirmationComponent implements OnInit {
  protected readonly shop = inject(ShopService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly orderNumber = signal<string | null>(null);
  protected readonly order = signal<ShopOrder | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  /** The second detail this browser remembers for its own last order (postcode or email). */
  protected readonly second = signal<string | null>(null);
  protected typedSecond = '';

  ngOnInit(): void {
    const sub = this.route.paramMap.subscribe((params) => {
      const query = this.route.snapshot.queryParamMap;
      const number = params.get('orderNumber') ?? query.get('orderNumber') ?? this.shop.lastOrder()?.orderNumber ?? null;
      this.orderNumber.set(number);
      const last = this.shop.lastOrder();
      this.second.set(last && last.orderNumber === number ? last.second : null);
      if (number) this.load();
    });
    this.destroyRef.onDestroy(() => sub.unsubscribe());
  }

  protected async load(): Promise<void> {
    const number = this.orderNumber();
    if (!number) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      this.order.set(await this.shop.client.getOrdersByOrderNumber(number));
    } catch (e) {
      this.error.set(this.shop.explain(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected canCancel(o: ShopOrder): boolean {
    return this.shop.has('cancel-before-packing') && (o.status === 'awaiting-payment' || o.status === 'paid');
  }

  protected async cancel(o: ShopOrder): Promise<void> {
    const second = (this.second() ?? this.typedSecond).trim();
    if (!second) {
      this.error.set(o.fulfilment === 'collection' ? 'Enter the email used for the order.' : 'Enter the delivery postcode.');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const body = o.fulfilment === 'collection' ? { email: second } : { postcode: second };
      this.order.set(await this.shop.client.postOrdersCancel(o.orderNumber, { body }));
      this.shop.refreshStock();
    } catch (e) {
      this.error.set(this.shop.explain(e));
    } finally {
      this.busy.set(false);
    }
  }
}
