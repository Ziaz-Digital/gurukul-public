import { Component, ViewEncapsulation, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ShopProduct } from '../../gurukul-shop-client/shop-client';
import { ShopService, money } from '../shop.service';

/** One product on the shelf: picture, price, stock state, add to basket, favourite. */
@Component({
  selector: 'app-product-card',
  encapsulation: ViewEncapsulation.None,
  imports: [RouterLink],
  template: `
    @let p = product();
    <article class="card" [attr.aria-labelledby]="'gk-p-' + p.id">
      <a class="pic" [routerLink]="['/product', p.id]" tabindex="-1" aria-hidden="true">
        @if (shop.images()[p.id]; as src) {
          <img [src]="src" alt="" loading="lazy" />
        } @else {
          <span class="initial">{{ p.name.charAt(0) }}</span>
        }
      </a>
      <div class="body">
        @if (categoryName()) {
          <span class="cat">{{ categoryName() }}</span>
        }
        <h3 [id]="'gk-p-' + p.id"><a [routerLink]="['/product', p.id]">{{ p.name }}</a></h3>
        <span class="price">{{ money(p.priceMinor, p.currency) }}</span>
        @if (p.stockAvailable <= 0) {
          <span class="stock out">Out of stock</span>
        } @else if (p.stockAvailable <= p.reorderLevel) {
          <span class="stock low">Only {{ p.stockAvailable }} left</span>
        }
      </div>
      <div class="row">
        @if (p.stockAvailable > 0) {
          <button
            type="button"
            class="primary"
            [disabled]="shop.busyLine() === p.id"
            [attr.aria-busy]="shop.busyLine() === p.id"
            (click)="add()"
            [attr.aria-label]="'Add ' + p.name + ' to basket'"
          >
            {{ shop.busyLine() === p.id ? 'Adding…' : shop.quantityOf(p.id) ? 'Add another (' + shop.quantityOf(p.id) + ')' : 'Add to basket' }}
          </button>
        } @else {
          <button type="button" disabled>Out of stock</button>
        }
        @if (shop.customer() && shop.has('favourites-reorder')) {
          <button
            type="button"
            class="fav"
            [class.on]="shop.favouriteIds().has(p.id)"
            [attr.aria-pressed]="shop.favouriteIds().has(p.id)"
            [attr.aria-label]="(shop.favouriteIds().has(p.id) ? 'Remove ' : 'Save ') + p.name + (shop.favouriteIds().has(p.id) ? ' from favourites' : ' as a favourite')"
            [disabled]="favBusy()"
            (click)="favourite()"
          >
            {{ shop.favouriteIds().has(p.id) ? '♥' : '♡' }}
          </button>
        }
      </div>
      @if (error()) {
        <p class="error small" role="alert">{{ error() }}</p>
      }
    </article>
  `,
})
export class ProductCardComponent {
  readonly product = input.required<ShopProduct>();
  readonly categoryName = input('');
  protected readonly shop = inject(ShopService);
  protected readonly money = money;
  protected readonly error = signal<string | null>(null);
  protected readonly favBusy = signal(false);

  protected async add(): Promise<void> {
    this.error.set(null);
    try {
      await this.shop.add(this.product().id);
    } catch (e) {
      this.error.set(this.shop.explain(e));
    }
  }

  protected async favourite(): Promise<void> {
    this.favBusy.set(true);
    this.error.set(null);
    try {
      await this.shop.toggleFavourite(this.product().id);
    } catch (e) {
      this.error.set(this.shop.explain(e));
    } finally {
      this.favBusy.set(false);
    }
  }
}
