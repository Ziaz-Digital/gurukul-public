import { Component, OnInit, ViewEncapsulation, signal } from '@angular/core';
import { ShopReport, ShopStaffItemRequest } from '../../gurukul-shop-client/shop-client';
import { dateTimeLabel, money } from '../shop.service';
import { STATUS_LINES, StaffPage } from './staff-page';

/** The sales and stock report (`sales-stock-report`) and what customers ask for (`ask-unavailable-item`). */
@Component({
  selector: 'app-staff-report',
  encapsulation: ViewEncapsulation.None,
  template: `
    ${STATUS_LINES}
    @if (!shop.has('sales-stock-report') && !shop.has('ask-unavailable-item')) {
      <p class="muted">Neither the report nor item requests is switched on for this shop.</p>
    }
    @if (shop.has('sales-stock-report')) {
      <section>
        <div class="head-row">
          <h2>Sales and stock</h2>
          <label class="inline">
            Last
            <select [value]="days()" (change)="days.set(+$any($event.target).value); load()">
              @for (d of [7, 14, 30, 60]; track d) { <option [value]="d">{{ d }} days</option> }
            </select>
          </label>
        </div>
        @if (report(); as r) {
          <dl class="kpis">
            <div><dt>Orders</dt><dd>{{ r.orders }}</dd></div>
            <div><dt>Revenue</dt><dd>{{ money(r.revenueMinor, r.currency) }}</dd></div>
            <div><dt>Discounts given</dt><dd>{{ money(r.discountsMinor, r.currency) }}</dd></div>
            <div><dt>Stock value</dt><dd>{{ money(r.stockValueMinor, r.currency) }}</dd></div>
          </dl>
          <div class="two-col">
            <div>
              <h3>Best sellers</h3>
              <ol class="list small">
                @for (l of r.bestSellers; track l.productId) { <li><span>{{ l.name }}</span><span class="num">{{ l.quantitySold }} sold · {{ money(l.revenueMinor, r.currency) }}</span></li> }
                @empty { <li class="muted">No sales yet.</li> }
              </ol>
            </div>
            <div>
              <h3>Slow movers</h3>
              <ol class="list small">
                @for (l of r.slowMovers; track l.productId) { <li><span>{{ l.name }}</span><span class="num">{{ l.quantitySold }} sold · {{ l.stockOnHand }} on the shelf</span></li> }
                @empty { <li class="muted">Nothing on the shelf.</li> }
              </ol>
            </div>
          </div>
        } @else {
          <p class="muted" role="status">Loading…</p>
        }
      </section>
    }
    @if (shop.has('ask-unavailable-item')) {
      <section class="panel">
        <h2>What customers are asking for</h2>
        <ul class="list">
          @for (r of requests(); track r.name) {
            <li><span>{{ r.name }}</span><span class="muted small">{{ r.openRequests }} waiting · since {{ when(r.oldestAtUtc) }}</span></li>
          } @empty {
            <li class="muted">Nobody is waiting for anything.</li>
          }
        </ul>
      </section>
    }
  `,
})
export class StaffReportComponent extends StaffPage implements OnInit {
  protected readonly money = money;
  protected readonly when = dateTimeLabel;
  protected readonly days = signal(30);
  protected readonly report = signal<ShopReport | null>(null);
  protected readonly requests = signal<ShopStaffItemRequest[]>([]);

  ngOnInit(): void {
    this.load();
    if (this.shop.has('ask-unavailable-item')) {
      this.client
        .getStaffItemRequests()
        .then((r) => this.requests.set(r))
        .catch((e) => this.error.set(this.shop.explain(e)));
    }
  }

  protected async load(): Promise<void> {
    if (!this.shop.has('sales-stock-report')) return;
    try {
      this.report.set(await this.client.getStaffReportsSalesStock({ query: { days: this.days() } }));
    } catch (e) {
      this.error.set(this.shop.explain(e));
    }
  }
}
