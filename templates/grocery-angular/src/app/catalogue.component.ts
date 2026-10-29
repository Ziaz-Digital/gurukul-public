import { Component, OnInit, ViewEncapsulation, inject, signal } from '@angular/core';
import { ShopProduct } from '../gurukul-shop-client/shop-client';
import { ShopService, money, problemText } from './shop.service';

/** The catalogue: GET /products. Search, categories and paging are yours to build. */
@Component({
  selector: 'app-catalogue',
  // No styles here: the shop's styles (gk-project.component.css) reach this page.
  encapsulation: ViewEncapsulation.None,
  template: `
    @if (error() && !products()) {
      <p class="error">{{ error() }}</p>
    } @else if (!products()) {
      <p class="muted">Loading the shop…</p>
    } @else if (!products()!.length) {
      <p class="muted">No products yet. Add some as staff on your machine.</p>
    } @else {
      @if (error()) {
        <p class="error">{{ error() }}</p>
      }
      <ul class="catalogue" aria-label="Products">
        @for (p of products(); track p.id) {
          <li class="product">
            <span class="name">{{ p.name }}</span>
            <span class="price">{{ money(p.priceMinor, p.currency) }}</span>
            <button type="button" [disabled]="busy() === p.id || p.stockAvailable <= 0" (click)="add(p.id)">
              {{ p.stockAvailable > 0 ? 'Add to basket' : 'Out of stock' }}
            </button>
          </li>
        }
      </ul>
    }
  `,
})
export class CatalogueComponent implements OnInit {
  private readonly shop = inject(ShopService);
  protected readonly products = signal<ShopProduct[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal<number | null>(null);
  protected readonly money = money;

  async ngOnInit(): Promise<void> {
    this.shop.loadBasket().catch(() => undefined);
    try {
      this.products.set((await this.shop.client.getProducts({ query: { pageSize: 50 } })).items);
    } catch (e) {
      this.error.set(problemText(e));
    }
  }

  protected async add(id: number): Promise<void> {
    this.busy.set(id);
    this.error.set(null);
    try {
      await this.shop.addToBasket(id);
    } catch (e) {
      this.error.set(problemText(e));
    } finally {
      this.busy.set(null);
    }
  }
}
