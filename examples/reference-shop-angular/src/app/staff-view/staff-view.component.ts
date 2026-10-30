import { Component, DestroyRef, OnInit, ViewEncapsulation, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ShopApiError } from '../../gurukul-shop-client/shop-client';
import { STATUS_TEXT, ShopService, money, slotLabel } from '../shop.service';
import { StaffViewApi, StaffViewOrder, StaffViewProduct } from './staff-view.api';

type Tab = 'inventory' | 'orders' | 'shortages';
const PAGE_SIZE = 25;

/**
 * "View as staff (read only)" — shown only in Gurukul's showcase (the public key),
 * D-500 addendum 9 §3. A recruiter sees the shop's inventory, its orders (no personal
 * data) and its shortages. Nothing here can change anything: there are no write
 * controls, and the public key could not use them anyway.
 */
@Component({
  selector: 'app-staff-view',
  encapsulation: ViewEncapsulation.None,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="readonly-banner" role="note">
      <strong>Read only.</strong> This is what the shop’s staff see, for visitors to look at. Nothing here can be changed, and no shopper’s personal details are shown.
    </div>
    <h1>View as staff</h1>
    @if (!shop.hosted()) {
      <p class="muted">This read-only view is for the published project. On your own machine, use the <a routerLink="/staff">staff screens</a>.</p>
    } @else {
      <div class="tabs" role="tablist" aria-label="Staff view">
        <a role="tab" [routerLink]="[]" [queryParams]="{ tab: 'inventory' }" [attr.aria-selected]="tab() === 'inventory'" [class.on]="tab() === 'inventory'">Inventory</a>
        <a role="tab" [routerLink]="[]" [queryParams]="{ tab: 'orders' }" [attr.aria-selected]="tab() === 'orders'" [class.on]="tab() === 'orders'">Orders</a>
        <a role="tab" [routerLink]="[]" [queryParams]="{ tab: 'shortages' }" [attr.aria-selected]="tab() === 'shortages'" [class.on]="tab() === 'shortages'">Shortages</a>
      </div>

      <section role="tabpanel">
        @if (notAvailable()) {
          <p class="muted" role="status">Not available yet.</p>
        } @else {
          @if (error()) { <p class="error" role="alert">{{ error() }}</p> }

          @switch (tab()) {
            @case ('inventory') {
              <form class="search compact" role="search" (ngSubmit)="search()">
                <label for="gk-sv-search" class="sr-only">Search the inventory</label>
                <input id="gk-sv-search" name="q" type="search" placeholder="Search by name or SKU" [(ngModel)]="query" />
                <button type="submit" class="ghost">Search</button>
              </form>
              @if (inventory(); as list) {
                <div class="table-wrap">
                  <table>
                    <caption class="sr-only">Inventory</caption>
                    <thead><tr><th scope="col">SKU</th><th scope="col">Product</th><th scope="col" class="num">Price</th><th scope="col" class="num">On hand</th><th scope="col" class="num">Available</th><th scope="col" class="num">Reorder at</th></tr></thead>
                    <tbody>
                      @for (p of list; track p.id) {
                        <tr [class.warn]="isLow(p)">
                          <td class="mono">{{ p.sku }}</td>
                          <td>{{ p.name }} @if (p.isActive === false) { <span class="badge">Not on sale</span> }</td>
                          <td class="num">{{ p.priceMinor !== undefined ? money(p.priceMinor, p.currency ?? 'EUR') : '' }}</td>
                          <td class="num">{{ p.stockOnHand }}</td>
                          <td class="num">{{ p.stockAvailable }}</td>
                          <td class="num">{{ p.reorderLevel }}</td>
                        </tr>
                      } @empty {
                        <tr><td colspan="6" class="muted">No products.</td></tr>
                      }
                    </tbody>
                  </table>
                </div>
                @if (pages() > 1) {
                  <nav class="pager" aria-label="Pages">
                    <button type="button" class="ghost" [disabled]="page() <= 1" (click)="go(page() - 1)">Previous</button>
                    <span>Page {{ page() }} of {{ pages() }}</span>
                    <button type="button" class="ghost" [disabled]="page() >= pages()" (click)="go(page() + 1)">Next</button>
                  </nav>
                }
              } @else {
                <p class="muted" role="status">Loading…</p>
              }
            }
            @case ('orders') {
              <label class="inline">
                Status
                <select [value]="status()" (change)="filter($any($event.target).value)">
                  <option value="">Open (paid and packed)</option>
                  @for (s of statuses; track s) {
                    <option [value]="s">{{ statusText(s) }}</option>
                  }
                </select>
              </label>
              @if (orders(); as list) {
                <div class="table-wrap">
                  <table>
                    <caption class="sr-only">Orders</caption>
                    <thead><tr><th scope="col">Order</th><th scope="col">Status</th><th scope="col">Slot</th><th scope="col">Items</th><th scope="col" class="num">Total</th></tr></thead>
                    <tbody>
                      @for (o of list; track o.orderNumber) {
                        <tr>
                          <td class="mono">{{ o.orderNumber }}</td>
                          <td><span class="badge" [attr.data-status]="o.status">{{ statusText(o.status) }}</span> @if (o.fulfilment === 'collection') { <span class="muted small">collect</span> }</td>
                          <td>{{ o.slot ? slot(o.slot) : '' }}</td>
                          <td>{{ items(o) }}</td>
                          <td class="num">{{ o.totalMinor !== undefined ? money(o.totalMinor, o.currency ?? 'EUR') : '' }}</td>
                        </tr>
                      } @empty {
                        <tr><td colspan="5" class="muted">No orders with this status.</td></tr>
                      }
                    </tbody>
                  </table>
                </div>
                @if (pages() > 1) {
                  <nav class="pager" aria-label="Pages">
                    <button type="button" class="ghost" [disabled]="page() <= 1" (click)="go(page() - 1)">Previous</button>
                    <span>Page {{ page() }} of {{ pages() }}</span>
                    <button type="button" class="ghost" [disabled]="page() >= pages()" (click)="go(page() + 1)">Next</button>
                  </nav>
                }
              } @else {
                <p class="muted" role="status">Loading…</p>
              }
            }
            @case ('shortages') {
              @if (shortages(); as list) {
                <p class="muted small">Products at or below their reorder level, lowest first.</p>
                <ul class="list">
                  @for (p of list; track p.id) {
                    <li>
                      <span>{{ p.name }} <span class="muted small mono">{{ p.sku }}</span></span>
                      <span class="stock" [class.out]="(p.stockAvailable ?? 0) <= 0" [class.low]="(p.stockAvailable ?? 0) > 0">{{ p.stockAvailable }} available · reorder at {{ p.reorderLevel }}</span>
                    </li>
                  } @empty {
                    <li class="muted">Nothing is short. Every product is above its reorder level.</li>
                  }
                </ul>
              } @else {
                <p class="muted" role="status">Loading…</p>
              }
            }
          }
        }
      </section>
    }
  `,
})
export class StaffViewComponent implements OnInit {
  protected readonly shop = inject(ShopService);
  private readonly api = inject(StaffViewApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly money = money;
  protected readonly slot = slotLabel;
  protected readonly statuses = ['awaiting-payment', 'paid', 'packed', 'out-for-delivery', 'delivered', 'collected', 'cancelled'];

  protected readonly tab = signal<Tab>('inventory');
  protected readonly page = signal(1);
  protected readonly pages = signal(1);
  protected readonly status = signal('');
  protected readonly inventory = signal<StaffViewProduct[] | null>(null);
  protected readonly orders = signal<StaffViewOrder[] | null>(null);
  protected readonly shortages = signal<StaffViewProduct[] | null>(null);
  protected readonly notAvailable = signal(false);
  protected readonly error = signal<string | null>(null);
  protected query = '';

  ngOnInit(): void {
    const sub = this.route.queryParamMap.subscribe((q) => {
      const tab = q.get('tab');
      this.tab.set(tab === 'orders' || tab === 'shortages' ? tab : 'inventory');
      this.page.set(Math.max(1, Number(q.get('page')) || 1));
      this.status.set(q.get('status') ?? '');
      this.query = q.get('q') ?? '';
      if (this.shop.hosted()) this.load();
    });
    this.destroyRef.onDestroy(() => sub.unsubscribe());
  }

  private async load(): Promise<void> {
    this.error.set(null);
    this.notAvailable.set(false);
    try {
      if (this.tab() === 'inventory') {
        const r = await this.api.inventory({ search: this.query || undefined, page: this.page(), pageSize: PAGE_SIZE });
        this.inventory.set(r.items ?? []);
        this.pages.set(Math.max(1, Math.ceil((r.total ?? 0) / (r.pageSize || PAGE_SIZE))));
      } else if (this.tab() === 'orders') {
        const r = await this.api.orders({ status: this.status() || undefined, page: this.page(), pageSize: PAGE_SIZE });
        this.orders.set(r.items ?? []);
        this.pages.set(Math.max(1, Math.ceil((r.total ?? 0) / (r.pageSize || PAGE_SIZE))));
      } else {
        this.shortages.set(await this.api.lowStock());
      }
    } catch (e) {
      // The server does not have these routes yet (or not in this environment).
      if (e instanceof ShopApiError && e.status === 404) this.notAvailable.set(true);
      else this.error.set(this.shop.explain(e));
    }
  }

  protected search(): void {
    this.router.navigate([], { queryParams: { tab: 'inventory', q: this.query.trim() || null } });
  }
  protected filter(status: string): void {
    this.router.navigate([], { queryParams: { tab: 'orders', status: status || null } });
  }
  protected go(page: number): void {
    this.router.navigate([], { queryParams: { page }, queryParamsHandling: 'merge' });
  }

  protected isLow(p: StaffViewProduct): boolean {
    return (p.stockAvailable ?? 0) <= (p.reorderLevel ?? -1);
  }
  protected statusText(s: string): string {
    return STATUS_TEXT[s] ?? s;
  }
  protected items(o: StaffViewOrder): string {
    if (o.lines?.length) return o.lines.map((l) => `${l.quantity} × ${l.productName}`).join(', ');
    return o.itemCount !== undefined ? `${o.itemCount} items` : '';
  }
}
