import { Component, DestroyRef, OnInit, ViewEncapsulation, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ShopCategory, ShopProduct } from '../../gurukul-shop-client/shop-client';
import { ShopService, money } from '../shop.service';
import { ProductCardComponent } from './product-card.component';

const PAGE_SIZE = 24;

/**
 * The catalogue (core `catalogue`): categories, search and pages, all in the address
 * (?q=&cat=&page=) so the back button and deep links work. Reads go through the
 * shop's read cache: going back and forth costs no new calls within a minute.
 */
@Component({
  selector: 'app-catalogue',
  encapsulation: ViewEncapsulation.None,
  imports: [FormsModule, RouterLink, ProductCardComponent],
  template: `
    <section class="hero">
      <h1>Fresh groceries, delivered or ready to collect</h1>
      <form class="search" role="search" (ngSubmit)="search()">
        <label for="gk-search" class="sr-only">Search products</label>
        <input id="gk-search" name="q" type="search" placeholder="Search apples, bread, milk…" [(ngModel)]="query" autocomplete="off" />
        <button type="submit" class="primary">Search</button>
      </form>
    </section>

    @if (categories().length) {
      <nav class="chips" aria-label="Categories">
        <a [routerLink]="[]" [queryParams]="{ q: activeQuery() || null }" [class.on]="!categoryId()" [attr.aria-current]="!categoryId() ? 'page' : null">All</a>
        @for (c of categories(); track c.id) {
          <a
            [routerLink]="[]"
            [queryParams]="{ cat: c.id, q: activeQuery() || null }"
            [class.on]="categoryId() === c.id"
            [attr.aria-current]="categoryId() === c.id ? 'page' : null"
            >{{ c.name }}</a
          >
        }
      </nav>
    }

    @if (error()) {
      <p class="error" role="alert">{{ error() }}</p>
    }
    @if (loading() && !products()) {
      <p class="muted" role="status">Loading the shop…</p>
    } @else if (products(); as list) {
      @if (activeQuery()) {
        <p class="muted" role="status">{{ total() }} {{ total() === 1 ? 'result' : 'results' }} for “{{ activeQuery() }}”</p>
      }
      @if (!list.length) {
        <div class="empty">
          <p>{{ activeQuery() ? 'Nothing matches “' + activeQuery() + '”.' : 'No products here yet.' }}</p>
          @if (activeQuery() && shop.has('ask-unavailable-item')) {
            <p><a routerLink="/account" [queryParams]="{ tab: 'requests', ask: activeQuery() }">Ask us to stock “{{ activeQuery() }}”</a></p>
          }
        </div>
      } @else {
        <ul class="grid" aria-label="Products">
          @for (p of list; track p.id) {
            <li><app-product-card [product]="p" [categoryName]="categoryName(p.categoryId)" /></li>
          }
        </ul>
        @if (pages() > 1) {
          <nav class="pager" aria-label="Pages">
            <a [routerLink]="[]" [queryParams]="{ page: page() - 1 }" queryParamsHandling="merge" [class.disabled]="page() <= 1" [attr.aria-disabled]="page() <= 1">Previous</a>
            <span>Page {{ page() }} of {{ pages() }}</span>
            <a [routerLink]="[]" [queryParams]="{ page: page() + 1 }" queryParamsHandling="merge" [class.disabled]="page() >= pages()" [attr.aria-disabled]="page() >= pages()">Next</a>
          </nav>
        }
      }
    }
  `,
})
export class CatalogueComponent implements OnInit {
  protected readonly shop = inject(ShopService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly money = money;

  protected readonly categories = signal<ShopCategory[]>([]);
  protected readonly products = signal<ShopProduct[] | null>(null);
  protected readonly total = signal(0);
  protected readonly pages = signal(1);
  protected readonly page = signal(1);
  protected readonly categoryId = signal<number | null>(null);
  protected readonly activeQuery = signal('');
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected query = '';

  ngOnInit(): void {
    this.shop
      .categories()
      .then((c) => this.categories.set([...c].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))))
      .catch((e) => this.error.set(this.shop.explain(e)));
    this.shop.ensureFavouriteIds();
    const sub = this.route.queryParamMap.subscribe((q) => {
      const cat = Number(q.get('cat'));
      this.categoryId.set(Number.isInteger(cat) && cat > 0 ? cat : null);
      this.activeQuery.set(q.get('q') ?? '');
      this.query = this.activeQuery();
      this.page.set(Math.max(1, Number(q.get('page')) || 1));
      this.load();
    });
    this.destroyRef.onDestroy(() => sub.unsubscribe());
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const result = await this.shop.products({
        search: this.activeQuery() || undefined,
        categoryId: this.categoryId() ?? undefined,
        page: this.page(),
        pageSize: PAGE_SIZE,
      });
      this.products.set(result.items);
      this.total.set(result.total);
      this.pages.set(Math.max(1, Math.ceil(result.total / (result.pageSize || PAGE_SIZE))));
      this.shop.loadImages(result.items);
    } catch (e) {
      this.error.set(this.shop.explain(e));
    } finally {
      this.loading.set(false);
    }
  }

  protected search(): void {
    this.router.navigate([], { queryParams: { q: this.query.trim() || null, cat: this.categoryId(), page: null } });
  }

  protected categoryName(id: number): string {
    return this.categories().find((c) => c.id === id)?.name ?? '';
  }
}
