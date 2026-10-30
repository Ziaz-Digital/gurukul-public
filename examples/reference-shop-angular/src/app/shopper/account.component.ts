import { Component, DestroyRef, OnInit, ViewEncapsulation, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ShopAddress, ShopItemRequest, ShopOrder, ShopProduct, ShopReorderSkipped } from '../../gurukul-shop-client/shop-client';
import { AddOn } from '../capabilities';
import { STATUS_TEXT, ShopService, dateTimeLabel, money } from '../shop.service';
import { ProductCardComponent } from './product-card.component';

type Tab = 'favourites' | 'orders' | 'addresses' | 'requests';

const TABS: Array<{ key: Tab; label: string; addOn: AddOn }> = [
  { key: 'favourites', label: 'Favourites', addOn: 'favourites-reorder' },
  { key: 'orders', label: 'My orders', addOn: 'customer-accounts' },
  { key: 'addresses', label: 'Addresses', addOn: 'customer-accounts' },
  { key: 'requests', label: 'Asked for', addOn: 'ask-unavailable-item' },
];

/**
 * The signed-in customer: favourites and "order again" (`favourites-reorder`), past
 * orders and saved addresses (`customer-accounts`), items asked for
 * (`ask-unavailable-item`). Each tab shows only when its add-on is on.
 */
@Component({
  selector: 'app-account',
  encapsulation: ViewEncapsulation.None,
  imports: [FormsModule, RouterLink, ProductCardComponent],
  template: `
    @if (!shop.customer()) {
      <h1>My account</h1>
      <p><a routerLink="/sign-in" class="button primary">Sign in</a></p>
    } @else {
      <div class="head-row">
        <h1>Hello, {{ shop.customer()!.email }}</h1>
        <button type="button" class="link" (click)="signOut()">Sign out</button>
      </div>

      <div class="tabs" role="tablist" aria-label="My account">
        @for (t of tabs(); track t.key) {
          <a role="tab" [routerLink]="[]" [queryParams]="{ tab: t.key }" [attr.aria-selected]="tab() === t.key" [class.on]="tab() === t.key">{{ t.label }}</a>
        }
      </div>

      @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
      @if (note()) { <p class="ok" role="status">{{ note() }}</p> }

      <section role="tabpanel">
        @switch (tab()) {
          @case ('favourites') {
            <div class="head-row">
              <p class="muted">Your usual shop, one click away.</p>
              <button type="button" class="primary" [disabled]="busy()" [attr.aria-busy]="busy()" (click)="orderAgain()">
                {{ busy() ? 'Filling your basket…' : 'Order my last order again' }}
              </button>
            </div>
            @if (skipped().length) {
              <p class="muted small">Not sold any more, so left out: {{ skippedNames() }}</p>
            }
            @if (favourites() === null) {
              <p class="muted" role="status">Loading…</p>
            } @else if (!favourites()!.length) {
              <p class="muted">No favourites yet. Tap ♡ on a product to save it.</p>
            } @else {
              <ul class="grid" aria-label="Favourites">
                @for (p of favourites(); track p.id) {
                  <li><app-product-card [product]="p" /></li>
                }
              </ul>
            }
          }
          @case ('orders') {
            @if (orders() === null) {
              <p class="muted" role="status">Loading…</p>
            } @else if (!orders()!.length) {
              <p class="muted">No orders placed while signed in yet.</p>
            } @else {
              <ul class="list">
                @for (o of orders(); track o.orderNumber) {
                  <li>
                    <a [routerLink]="['/order', o.orderNumber]" class="mono">{{ o.orderNumber }}</a>
                    <span class="muted small">{{ when(o.createdAtUtc) }}</span>
                    <span class="badge" [attr.data-status]="o.status">{{ status(o.status) }}</span>
                    <span>{{ money(o.totalMinor, o.currency) }}</span>
                  </li>
                }
              </ul>
            }
          }
          @case ('addresses') {
            <ul class="list">
              @for (a of addresses(); track a.id) {
                <li>
                  <span><strong>{{ a.label || 'Address' }}</strong> {{ a.line1 }}{{ a.line2 ? ', ' + a.line2 : '' }}, {{ a.postcode }} {{ a.city }}</span>
                  <button type="button" class="link" [disabled]="busy()" (click)="deleteAddress(a.id)" [attr.aria-label]="'Delete address ' + a.line1">Delete</button>
                </li>
              } @empty {
                <li class="muted">No saved addresses.</li>
              }
            </ul>
            <form class="narrow panel" (ngSubmit)="addAddress()">
              <h2>Add an address</h2>
              <label>Label (optional) <input name="label" placeholder="Home" [(ngModel)]="addr.label" /></label>
              <label>Address <input name="line1" required autocomplete="address-line1" [(ngModel)]="addr.line1" /></label>
              <label>Address line 2 (optional) <input name="line2" autocomplete="address-line2" [(ngModel)]="addr.line2" /></label>
              <label>City <input name="city" required autocomplete="address-level2" [(ngModel)]="addr.city" /></label>
              <label>Postcode <input name="postcode" required autocomplete="postal-code" [(ngModel)]="addr.postcode" /></label>
              <button type="submit" class="primary" [disabled]="busy()" [attr.aria-busy]="busy()">Save address</button>
            </form>
          }
          @case ('requests') {
            <ul class="list">
              @for (r of requests(); track r.id) {
                <li>
                  <span>{{ r.product?.name ?? r.name }}</span>
                  <span class="badge" [attr.data-status]="r.status === 'available' ? 'paid' : 'awaiting-payment'">{{ r.status === 'available' ? 'In stock now' : 'Waiting' }}</span>
                  <button type="button" class="link" [disabled]="busy()" (click)="deleteRequest(r.id)" [attr.aria-label]="'Stop asking for ' + r.name">Remove</button>
                </li>
              } @empty {
                <li class="muted">You have not asked for anything.</li>
              }
            </ul>
            <form class="narrow panel" (ngSubmit)="ask()">
              <h2>Ask us to stock something</h2>
              <label>What are you looking for? <input name="ask" required [(ngModel)]="askName" /></label>
              <button type="submit" class="primary" [disabled]="busy()" [attr.aria-busy]="busy()">Ask for it</button>
            </form>
          }
        }
      </section>
    }
  `,
})
export class AccountComponent implements OnInit {
  protected readonly shop = inject(ShopService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly money = money;
  protected readonly when = dateTimeLabel;

  protected readonly tabs = computed(() => TABS.filter((t) => this.shop.has(t.addOn)));
  protected readonly tab = signal<Tab>('favourites');
  protected readonly favourites = signal<ShopProduct[] | null>(null);
  protected readonly orders = signal<ShopOrder[] | null>(null);
  protected readonly addresses = signal<ShopAddress[]>([]);
  protected readonly requests = signal<ShopItemRequest[]>([]);
  protected readonly skipped = signal<ShopReorderSkipped[]>([]);
  protected readonly skippedNames = computed(() => this.skipped().map((s) => s.name).join(', '));
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly note = signal<string | null>(null);
  protected addr = { label: '', line1: '', line2: '', city: '', postcode: '' };
  protected askName = '';

  ngOnInit(): void {
    const sub = this.route.queryParamMap.subscribe((q) => {
      const wanted = q.get('tab') as Tab | null;
      const available = this.tabs().map((t) => t.key);
      const tab = wanted && available.includes(wanted) ? wanted : available[0];
      if (!tab) return;
      this.askName = q.get('ask') ?? this.askName;
      this.tab.set(tab);
      this.error.set(null);
      this.note.set(null);
      this.load(tab);
    });
    this.destroyRef.onDestroy(() => sub.unsubscribe());
  }

  private async load(tab: Tab): Promise<void> {
    if (!this.shop.customer()) return;
    try {
      if (tab === 'favourites') {
        const list = await this.shop.loadFavourites();
        this.favourites.set(list);
        this.shop.loadImages(list);
      }
      if (tab === 'orders') this.orders.set(await this.shop.client.getCustomersMeOrders());
      if (tab === 'addresses') this.addresses.set(await this.shop.client.getCustomersMeAddresses());
      if (tab === 'requests') this.requests.set(await this.shop.client.getCustomersMeItemRequests());
    } catch (e) {
      this.error.set(this.shop.explain(e));
    }
  }

  private async work(job: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    this.note.set(null);
    try {
      await job();
    } catch (e) {
      this.error.set(this.shop.explain(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected orderAgain(): Promise<void> {
    return this.work(async () => {
      const result = await this.shop.client.postCustomersMeReorder();
      this.shop.adoptBasket(result.basket);
      this.skipped.set(result.skipped);
      if (!result.skipped.length) this.router.navigate(['/basket']);
      else this.note.set('Your basket is ready.');
    });
  }

  protected addAddress(): Promise<void> {
    if (!this.addr.line1.trim() || !this.addr.city.trim() || !this.addr.postcode.trim()) {
      this.error.set('Enter the address, city and postcode.');
      return Promise.resolve();
    }
    return this.work(async () => {
      const saved = await this.shop.client.postCustomersMeAddresses({
        body: { label: this.addr.label.trim() || null, line1: this.addr.line1.trim(), line2: this.addr.line2.trim() || null, city: this.addr.city.trim(), postcode: this.addr.postcode.trim() },
      });
      this.addresses.update((list) => [...list, saved]);
      this.addr = { label: '', line1: '', line2: '', city: '', postcode: '' };
      this.note.set('Address saved.');
    });
  }

  protected deleteAddress(id: number): Promise<void> {
    return this.work(async () => {
      await this.shop.client.deleteCustomersMeAddressesById(id);
      this.addresses.update((list) => list.filter((a) => a.id !== id));
    });
  }

  protected ask(): Promise<void> {
    if (!this.askName.trim()) return Promise.resolve();
    return this.work(async () => {
      const r = await this.shop.client.postCustomersMeItemRequests({ body: { name: this.askName.trim() } });
      this.requests.update((list) => [r, ...list.filter((x) => x.id !== r.id)]);
      this.askName = '';
      this.note.set('Saved. We will show you when it is in stock, the next time you sign in.');
    });
  }

  protected deleteRequest(id: number): Promise<void> {
    return this.work(async () => {
      await this.shop.client.deleteCustomersMeItemRequestsById(id);
      this.requests.update((list) => list.filter((r) => r.id !== id));
    });
  }

  protected async signOut(): Promise<void> {
    await this.shop.signOut();
    this.router.navigate(['/']);
  }

  protected status(s: string): string {
    return STATUS_TEXT[s] ?? s;
  }
}
