import { Component, OnInit, ViewEncapsulation, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ShopTracking } from '../../gurukul-shop-client/shop-client';
import { STATUS_TEXT, ShopService, dateTimeLabel, slotLabel } from '../shop.service';

const STEPS = ['paid', 'packed', 'out-for-delivery', 'delivered'];
const COLLECT_STEPS = ['paid', 'packed', 'collected'];

/**
 * Track my order (core `track-order`): the order number plus a second detail — the
 * delivery postcode, or the buyer's email for a collection order (`click-and-collect`).
 * Status only: no name, address or lines. No polling: "Check again" is a button.
 */
@Component({
  selector: 'app-track',
  encapsulation: ViewEncapsulation.None,
  imports: [FormsModule, RouterLink],
  template: `
    <h1>Track your order</h1>
    <form class="narrow" (ngSubmit)="track()">
      <label>Order number <input name="orderNumber" required autocomplete="off" placeholder="GS-…" [(ngModel)]="orderNumber" /></label>
      @if (shop.has('click-and-collect')) {
        <fieldset class="inline">
          <legend class="sr-only">Delivery or collection</legend>
          <label><input type="radio" name="by" value="postcode" [(ngModel)]="by" /> Delivered</label>
          <label><input type="radio" name="by" value="email" [(ngModel)]="by" /> I collect it</label>
        </fieldset>
      }
      @if (by === 'email') {
        <label>Email used for the order <input name="email" type="email" required autocomplete="email" [(ngModel)]="second" /></label>
      } @else {
        <label>Delivery postcode <input name="postcode" required autocomplete="postal-code" [(ngModel)]="second" /></label>
      }
      <button type="submit" class="primary" [disabled]="busy()" [attr.aria-busy]="busy()">{{ busy() ? 'Looking…' : 'Track' }}</button>
    </form>

    @if (error()) {
      <p class="error" role="alert">{{ error() }}</p>
    }
    @if (result(); as r) {
      <section class="panel" aria-live="polite">
        <h2>{{ statusText(r.status) }}</h2>
        <p class="muted">Order <span class="mono">{{ r.orderNumber }}</span> · {{ slot(r.slot) }}</p>
        @if (steps(r.status).length) {
          <ol class="steps">
            @for (s of steps(r.status); track s.key) {
              <li [class.done]="s.done" [attr.aria-current]="s.current ? 'step' : null">{{ statusText(s.key) }}</li>
            }
          </ol>
        }
        <p class="muted small">Updated {{ when(r.updatedAtUtc) }}</p>
        <div class="row wrap">
          <button type="button" class="ghost" [disabled]="busy()" (click)="track()">Check again</button>
          <a [routerLink]="['/order', r.orderNumber]" class="button ghost">See the order</a>
        </div>
      </section>
    }
  `,
})
export class TrackComponent implements OnInit {
  protected readonly shop = inject(ShopService);
  private readonly route = inject(ActivatedRoute);
  protected orderNumber = '';
  protected second = '';
  protected by: 'postcode' | 'email' = 'postcode';
  protected readonly result = signal<ShopTracking | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly slot = slotLabel;
  protected readonly when = dateTimeLabel;

  ngOnInit(): void {
    const last = this.shop.lastOrder();
    this.orderNumber = this.route.snapshot.queryParamMap.get('orderNumber') ?? last?.orderNumber ?? '';
    if (last && last.orderNumber === this.orderNumber) {
      this.second = last.second;
      this.by = last.fulfilment === 'collection' ? 'email' : 'postcode';
    }
  }

  protected async track(): Promise<void> {
    if (!this.orderNumber.trim() || !this.second.trim()) {
      this.error.set('Enter the order number and the second detail.');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const query = this.by === 'email' ? { orderNumber: this.orderNumber.trim(), email: this.second.trim() } : { orderNumber: this.orderNumber.trim(), postcode: this.second.trim() };
      this.result.set(await this.shop.client.getTrack({ query }));
    } catch (e) {
      this.result.set(null);
      this.error.set(this.shop.explain(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected statusText(s: string): string {
    return STATUS_TEXT[s] ?? s;
  }

  protected steps(status: string): Array<{ key: string; done: boolean; current: boolean }> {
    const list = this.by === 'email' ? COLLECT_STEPS : STEPS;
    const at = list.indexOf(status);
    if (at < 0) return [];
    return list.map((key, i) => ({ key, done: i <= at, current: i === at }));
  }
}
