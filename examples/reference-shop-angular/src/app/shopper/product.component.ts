import { Component, DestroyRef, OnInit, ViewEncapsulation, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ShopApiError, ShopProduct } from '../../gurukul-shop-client/shop-client';
import { ShopService, money } from '../shop.service';

/** Product detail (core `catalogue`), with "ask for it" when it is out of stock (`ask-unavailable-item`). */
@Component({
  selector: 'app-product',
  encapsulation: ViewEncapsulation.None,
  imports: [RouterLink],
  template: `
    <p><a routerLink="/" class="back">← Back to the shop</a></p>
    @if (error() && !product()) {
      <p class="error" role="alert">{{ error() }}</p>
    } @else if (!product()) {
      <p class="muted" role="status">Loading…</p>
    } @else {
      @let p = product()!;
      <article class="detail">
        <div class="pic big">
          @if (shop.images()[p.id]; as src) {
            <img [src]="src" [alt]="p.name" />
          } @else {
            <span class="initial" aria-hidden="true">{{ p.name.charAt(0) }}</span>
          }
        </div>
        <div class="info">
          @if (categoryName()) {
            <span class="cat">{{ categoryName() }}</span>
          }
          <h1>{{ p.name }}</h1>
          <p class="price big">{{ money(p.priceMinor, p.currency) }}</p>
          <p class="muted small">SKU {{ p.sku }}</p>
          @if (p.stockAvailable <= 0) {
            <p class="stock out">Out of stock</p>
          } @else if (p.stockAvailable <= p.reorderLevel) {
            <p class="stock low">Only {{ p.stockAvailable }} left</p>
          } @else {
            <p class="stock ok">In stock</p>
          }
          @if (error()) {
            <p class="error" role="alert">{{ error() }}</p>
          }
          @if (note()) {
            <p class="ok" role="status">{{ note() }}</p>
          }

          @if (p.stockAvailable > 0) {
            <div class="row">
              <label for="gk-qty" class="sr-only">Quantity</label>
              <select id="gk-qty" [value]="qty()" (change)="qty.set(+$any($event.target).value)">
                @for (n of quantities; track n) {
                  <option [value]="n">{{ n }}</option>
                }
              </select>
              <button type="button" class="primary" [disabled]="shop.busyLine() === p.id" [attr.aria-busy]="shop.busyLine() === p.id" (click)="add()">
                {{ shop.busyLine() === p.id ? 'Adding…' : 'Add to basket' }}
              </button>
            </div>
            @if (shop.quantityOf(p.id)) {
              <p class="muted small">{{ shop.quantityOf(p.id) }} in your basket · <a routerLink="/basket">Go to basket</a></p>
            }
          } @else if (shop.has('ask-unavailable-item')) {
            @if (shop.customer()) {
              <button type="button" class="primary" [disabled]="busy()" [attr.aria-busy]="busy()" (click)="ask()">
                {{ busy() ? 'Saving…' : 'Tell me when it is back' }}
              </button>
            } @else {
              <p><a routerLink="/sign-in" [queryParams]="{ returnTo: '/product/' + p.id }">Sign in</a> and we will tell you when it is back.</p>
            }
          }

          @if (shop.customer() && shop.has('favourites-reorder')) {
            <p>
              <button type="button" class="ghost" [disabled]="busy()" [attr.aria-pressed]="shop.favouriteIds().has(p.id)" (click)="favourite()">
                {{ shop.favouriteIds().has(p.id) ? '♥ In your favourites' : '♡ Save as a favourite' }}
              </button>
            </p>
          }
        </div>
      </article>
    }
  `,
})
export class ProductComponent implements OnInit {
  protected readonly shop = inject(ShopService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly money = money;
  protected readonly quantities = Array.from({ length: 10 }, (_, i) => i + 1);
  protected readonly product = signal<ShopProduct | null>(null);
  protected readonly categoryName = signal('');
  protected readonly qty = signal(1);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly note = signal<string | null>(null);

  ngOnInit(): void {
    this.shop.ensureFavouriteIds();
    const sub = this.route.paramMap.subscribe((m) => this.load(Number(m.get('id'))));
    this.destroyRef.onDestroy(() => sub.unsubscribe());
  }

  private async load(id: number): Promise<void> {
    this.product.set(null);
    this.error.set(null);
    this.note.set(null);
    try {
      const p = await this.shop.product(id);
      this.product.set(p);
      this.shop.loadImages([p]);
      const cats = await this.shop.categories();
      this.categoryName.set(cats.find((c) => c.id === p.categoryId)?.name ?? '');
    } catch (e) {
      this.error.set(e instanceof ShopApiError && e.status === 404 ? 'That product is not in the shop.' : this.shop.explain(e));
    }
  }

  protected async add(): Promise<void> {
    this.error.set(null);
    try {
      await this.shop.add(this.product()!.id, this.qty());
      this.note.set('Added to your basket.');
    } catch (e) {
      this.error.set(this.shop.explain(e));
    }
  }

  protected async ask(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.shop.client.postCustomersMeItemRequests({ body: { productId: this.product()!.id } });
      this.note.set('Saved. When it is back in stock, we will show you the next time you sign in.');
    } catch (e) {
      this.error.set(this.shop.explain(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async favourite(): Promise<void> {
    this.busy.set(true);
    try {
      await this.shop.toggleFavourite(this.product()!.id);
    } catch (e) {
      this.error.set(this.shop.explain(e));
    } finally {
      this.busy.set(false);
    }
  }
}
