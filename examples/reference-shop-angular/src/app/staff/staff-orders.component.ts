import { Component, OnInit, ViewEncapsulation, signal } from '@angular/core';
import { ShopStaffOrder } from '../../gurukul-shop-client/shop-client';
import { STATUS_TEXT, money, slotLabel } from '../shop.service';
import { STATUS_LINES, StaffPage } from './staff-page';

/**
 * Orders to pick and pack (core `pick-pack`), courier booking (core `delivery-booking`),
 * collection (`click-and-collect`), substitutes on the pick list (`substitutions`).
 */
@Component({
  selector: 'app-staff-orders',
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="head-row">
      <h2>Orders to pick and pack</h2>
      <label class="inline">
        Show
        <select [value]="status()" (change)="status.set($any($event.target).value); load()">
          <option value="">Open (paid and packed)</option>
          @for (s of statuses; track s) { <option [value]="s">{{ text(s) }}</option> }
        </select>
      </label>
      <button type="button" class="ghost" [disabled]="busy()" (click)="load()">Refresh</button>
    </div>
    ${STATUS_LINES}
    @if (orders() === null) {
      <p class="muted" role="status">Loading…</p>
    }
    <ul class="orders">
      @for (o of orders(); track o.orderNumber) {
        <li class="panel">
          <div class="head-row">
            <strong class="mono">{{ o.orderNumber }}</strong>
            <span class="badge" [attr.data-status]="o.status">{{ text(o.status) }}</span>
            @if (o.fulfilment === 'collection') { <span class="badge">Collect</span> }
            @if (o.deliveryStatus) { <span class="muted small">Courier: {{ o.deliveryStatus }}</span> }
          </div>
          <p class="small">{{ slot(o.slot) }} · {{ o.customer.name }} · {{ o.customer.email }}{{ o.customer.phone ? ' · ' + o.customer.phone : '' }}</p>
          @if (o.address) {
            <p class="small muted">{{ o.address.line1 }}{{ o.address.line2 ? ', ' + o.address.line2 : '' }}, {{ o.address.postcode }} {{ o.address.city }}</p>
          }
          <ul class="pick">
            @for (l of o.lines; track l.productId) {
              <li>
                <label><input type="checkbox" /> {{ l.quantity }} × {{ l.name }}</label>
                @if (l.substituteName) { <span class="muted small">— if out: {{ l.substituteName }}</span> }
              </li>
            }
          </ul>
          <p class="small">Total {{ money(o.totalMinor, o.currency) }}</p>
          <div class="row wrap">
            @if (o.status === 'paid') {
              <button type="button" class="primary" [disabled]="busy()" (click)="packed(o)">Mark packed</button>
            }
            @if (o.status === 'packed' && o.fulfilment !== 'collection' && !o.deliveryId) {
              <button type="button" class="primary" [disabled]="busy()" (click)="book(o)">Book the courier</button>
            }
            @if (o.status === 'packed' && o.fulfilment === 'collection') {
              <button type="button" class="primary" [disabled]="busy()" (click)="collected(o)">Mark collected</button>
            }
            @if (o.deliveryId && o.status !== 'delivered' && o.status !== 'delivery-failed') {
              <button type="button" class="ghost" [disabled]="busy()" (click)="advance(o)" title="Moves the simulated courier on (a /dev route, your machine only)">Advance courier (test)</button>
            }
          </div>
        </li>
      } @empty {
        @if (orders() !== null) { <li class="muted">No orders here.</li> }
      }
    </ul>
  `,
})
export class StaffOrdersComponent extends StaffPage implements OnInit {
  protected readonly orders = signal<ShopStaffOrder[] | null>(null);
  protected readonly status = signal('');
  protected readonly statuses = ['awaiting-payment', 'paid', 'packed', 'out-for-delivery', 'delivered', 'collected', 'cancelled'];
  protected readonly money = money;
  protected readonly slot = slotLabel;

  ngOnInit(): void {
    this.load();
  }

  protected async load(): Promise<void> {
    // Not through work(): a reload keeps the note of what was just done.
    try {
      this.orders.set(await this.client.getStaffOrders({ query: { status: this.status() || undefined } }));
    } catch (e) {
      this.error.set(this.shop.explain(e));
    }
  }

  protected text(s: string): string {
    return STATUS_TEXT[s] ?? s;
  }

  protected async packed(o: ShopStaffOrder): Promise<void> {
    await this.work(() => this.client.postStaffOrdersPacked(o.orderNumber), `${o.orderNumber} packed.`);
    if (!this.error()) this.load();
  }
  protected async book(o: ShopStaffOrder): Promise<void> {
    await this.work(() => this.client.postStaffOrdersDelivery(o.orderNumber), `Courier booked for ${o.orderNumber}.`);
    if (!this.error()) this.load();
  }
  protected async collected(o: ShopStaffOrder): Promise<void> {
    await this.work(() => this.client.postStaffOrdersCollected(o.orderNumber), `${o.orderNumber} collected.`);
    if (!this.error()) this.load();
  }
  protected async advance(o: ShopStaffOrder): Promise<void> {
    await this.work(() => this.client.postDevDeliveriesAdvance(o.deliveryId!), 'Courier moved on.');
    if (!this.error()) this.load();
  }
}
