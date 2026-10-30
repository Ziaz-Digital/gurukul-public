import { Component, OnInit, ViewEncapsulation, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ShopCategory, ShopProduct } from '../../gurukul-shop-client/shop-client';
import { money, toMinor } from '../shop.service';
import { STATUS_LINES, StaffPage } from './staff-page';

interface ProductForm {
  id: number | null;
  sku: string;
  name: string;
  categoryId: number | null;
  price: string;
  reorderLevel: number;
  isActive: boolean;
}

const EMPTY: ProductForm = { id: null, sku: '', name: '', categoryId: null, price: '', reorderLevel: 5, isActive: true };

/** Products and categories (core `catalogue`), product pictures (`product-images`). */
@Component({
  selector: 'app-staff-products',
  encapsulation: ViewEncapsulation.None,
  imports: [FormsModule],
  template: `
    <div class="two-col">
      <section>
        <div class="head-row">
          <h2>Products</h2>
          <button type="button" class="ghost" (click)="edit(null)">New product</button>
        </div>
        <form class="search compact" role="search" (ngSubmit)="load()">
          <label for="gk-st-search" class="sr-only">Search products</label>
          <input id="gk-st-search" name="q" type="search" placeholder="Search" [(ngModel)]="query" />
          <button type="submit" class="ghost">Search</button>
        </form>
        <div class="table-wrap">
          <table>
            <caption class="sr-only">Products</caption>
            <thead><tr><th scope="col">SKU</th><th scope="col">Name</th><th scope="col" class="num">Price</th><th scope="col" class="num">Stock</th><th scope="col">On sale</th><th scope="col"><span class="sr-only">Edit</span></th></tr></thead>
            <tbody>
              @for (p of products(); track p.id) {
                <tr [class.warn]="p.stockAvailable <= p.reorderLevel">
                  <td class="mono">{{ p.sku }}</td>
                  <td>{{ p.name }}</td>
                  <td class="num">{{ money(p.priceMinor, p.currency) }}</td>
                  <td class="num">{{ p.stockOnHand }} <span class="muted small">({{ p.stockAvailable }} free)</span></td>
                  <td>{{ p.isActive ? 'Yes' : 'No' }}</td>
                  <td><button type="button" class="link" (click)="edit(p)" [attr.aria-label]="'Edit ' + p.name">Edit</button></td>
                </tr>
              } @empty {
                <tr><td colspan="6" class="muted">No products yet. Add one, or import a CSV under Stock.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel">
        <h2>{{ form.id ? 'Edit ' + form.name : 'New product' }}</h2>
        <form (ngSubmit)="save()">
          <label>SKU <input name="sku" required [(ngModel)]="form.sku" /></label>
          <label>Name <input name="name" required [(ngModel)]="form.name" /></label>
          <label>
            Category
            <select name="categoryId" required [(ngModel)]="form.categoryId">
              <option [ngValue]="null" disabled>Choose a category</option>
              @for (c of categories(); track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }
            </select>
          </label>
          <label>Price (e.g. 2.49) <input name="price" inputmode="decimal" required [(ngModel)]="form.price" /></label>
          <label>Reorder at (stock level) <input name="reorderLevel" type="number" min="0" [(ngModel)]="form.reorderLevel" /></label>
          <label class="check"><input name="isActive" type="checkbox" [(ngModel)]="form.isActive" /> On sale (customers can see it)</label>
          ${STATUS_LINES}
          <button type="submit" class="primary" [disabled]="busy()" [attr.aria-busy]="busy()">{{ busy() ? 'Saving…' : form.id ? 'Save changes' : 'Create product' }}</button>
        </form>

        @if (form.id && shop.has('product-images')) {
          <div class="image-tools">
            <h3>Picture</h3>
            <label>PNG, JPEG or WebP, up to 512 KB <input type="file" accept="image/png,image/jpeg,image/webp" (change)="upload($any($event.target).files?.[0])" /></label>
            <button type="button" class="link" [disabled]="busy()" (click)="removeImage()">Remove the picture</button>
          </div>
        }

        <form class="inline-form" (ngSubmit)="addCategory()">
          <h3>Categories</h3>
          <p class="small muted">{{ categoryNames() }}</p>
          <label>New category <input name="newCategory" [(ngModel)]="newCategory" /></label>
          <button type="submit" class="ghost" [disabled]="busy() || !newCategory.trim()">Add category</button>
        </form>
      </section>
    </div>
  `,
})
export class StaffProductsComponent extends StaffPage implements OnInit {
  protected readonly products = signal<ShopProduct[]>([]);
  protected readonly categories = signal<ShopCategory[]>([]);
  protected readonly money = money;
  protected form: ProductForm = { ...EMPTY };
  protected query = '';
  protected newCategory = '';

  async ngOnInit(): Promise<void> {
    await this.loadCategories();
    await this.load();
  }

  protected categoryNames(): string {
    return this.categories().map((c) => c.name).join(' · ') || 'None yet.';
  }

  private async loadCategories(): Promise<void> {
    try {
      this.categories.set(await this.client.getCategories());
    } catch (e) {
      this.error.set(this.shop.explain(e));
    }
  }

  protected async load(): Promise<void> {
    try {
      this.products.set((await this.shop.staffProducts(this.query.trim())).items);
    } catch (e) {
      this.error.set(this.shop.explain(e));
    }
  }

  protected edit(p: ShopProduct | null): void {
    this.error.set(null);
    this.note.set(null);
    this.form = p
      ? { id: p.id, sku: p.sku, name: p.name, categoryId: p.categoryId, price: (p.priceMinor / 100).toFixed(2), reorderLevel: p.reorderLevel, isActive: p.isActive }
      : { ...EMPTY, categoryId: this.categories()[0]?.id ?? null };
  }

  protected async save(): Promise<void> {
    const priceMinor = toMinor(this.form.price);
    if (!this.form.sku.trim() || !this.form.name.trim() || !this.form.categoryId || priceMinor === null) {
      this.error.set('Fill in the SKU, name, category and a price.');
      return;
    }
    const body = { sku: this.form.sku.trim(), name: this.form.name.trim(), categoryId: this.form.categoryId, priceMinor, reorderLevel: Number(this.form.reorderLevel) || 0, isActive: this.form.isActive };
    const id = this.form.id;
    const saved = await this.work(() => (id ? this.client.putProductsById(id, { body }) : this.client.postProducts({ body })), id ? 'Saved.' : 'Created. Book stock in under Stock.');
    if (saved) {
      this.edit(saved);
      this.load();
    }
  }

  protected async upload(file: File | undefined): Promise<void> {
    if (!file || !this.form.id) return;
    const id = this.form.id;
    await this.work(() => this.client.putProductsImage(id, { raw: { contentType: file.type || 'application/octet-stream', data: file } }), 'Picture saved.');
  }

  protected async removeImage(): Promise<void> {
    const id = this.form.id;
    if (id) await this.work(() => this.client.deleteProductsImage(id), 'Picture removed.');
  }

  protected async addCategory(): Promise<void> {
    const name = this.newCategory.trim();
    if (!name) return;
    const c = await this.work(() => this.client.postCategories({ body: { name, sortOrder: this.categories().length } }), `Category ${name} added.`);
    if (c) {
      this.newCategory = '';
      await this.loadCategories();
    }
  }
}
