import { Component, OnInit, ViewEncapsulation, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ShopImportResult, ShopMovement, ShopProduct } from '../../gurukul-shop-client/shop-client';
import { dateTimeLabel } from '../shop.service';
import { STATUS_LINES, StaffPage } from './staff-page';

/**
 * Stock (core `stock`): goods in, adjustments and the movement history; the low-stock
 * list (core `low-stock`); the opening stock CSV import (core `opening-stock-import`).
 */
@Component({
  selector: 'app-staff-stock',
  encapsulation: ViewEncapsulation.None,
  imports: [FormsModule],
  template: `
    ${STATUS_LINES}
    <div class="two-col">
      <section class="panel">
        <h2>Goods in</h2>
        <form (ngSubmit)="goodsIn()">
          <label>
            Product
            <select name="giProduct" required [(ngModel)]="productId" (ngModelChange)="loadMovements()">
              <option [ngValue]="null" disabled>Choose a product</option>
              @for (p of products(); track p.id) { <option [ngValue]="p.id">{{ p.name }} ({{ p.stockOnHand }} on hand)</option> }
            </select>
          </label>
          <label>Quantity received <input name="giQty" type="number" min="1" max="10000" [(ngModel)]="quantity" /></label>
          <label>Delivery note (optional) <input name="giRef" [(ngModel)]="reference" /></label>
          <button type="submit" class="primary" [disabled]="busy() || !productId">Book in</button>
        </form>

        <h3>Adjust stock</h3>
        <form (ngSubmit)="adjust()">
          <label>Change (e.g. −2) <input name="adjQty" type="number" [(ngModel)]="change" /></label>
          <label>
            Reason
            <select name="adjReason" [(ngModel)]="reason">
              <option value="damaged">Damaged</option>
              <option value="expired">Expired</option>
              <option value="count-correction">Count correction</option>
            </select>
          </label>
          <label>Note (optional) <input name="adjNote" [(ngModel)]="adjustNote" /></label>
          <button type="submit" class="ghost" [disabled]="busy() || !productId || !change">Adjust</button>
        </form>

        @if (movements().length) {
          <h3>History</h3>
          <ul class="list small">
            @for (m of movements(); track m.id) {
              <li><span>{{ when(m.createdAtUtc) }} · {{ m.kind }}{{ m.reason ? ' (' + m.reason + ')' : '' }}</span><span class="num">{{ m.quantityChange > 0 ? '+' : '' }}{{ m.quantityChange }} → {{ m.stockOnHandAfter }}</span></li>
            }
          </ul>
        }
      </section>

      <section>
        <div class="head-row">
          <h2>Low stock</h2>
          <button type="button" class="ghost" [disabled]="busy()" (click)="loadLow()">Refresh</button>
        </div>
        <ul class="list">
          @for (p of low(); track p.id) {
            <li>
              <span>{{ p.name }} <span class="muted small mono">{{ p.sku }}</span></span>
              <span class="stock" [class.out]="p.stockAvailable <= 0" [class.low]="p.stockAvailable > 0">{{ p.stockAvailable }} free · reorder at {{ p.reorderLevel }}</span>
            </li>
          } @empty {
            <li class="muted">Nothing is low.</li>
          }
        </ul>
        @if (low().length && shop.has('suppliers-purchase-orders')) {
          <p class="small muted">Raise a purchase order for all of these under Suppliers.</p>
        }

        <div class="panel">
          <h2>Opening stock import</h2>
          <p class="small muted">A CSV with the header <span class="mono">sku,name,category,priceMinor,quantity,reorderLevel</span>. Quantity SETS stock on hand. At most 1,000 rows.</p>
          <label>CSV file <input type="file" accept=".csv,text/csv" (change)="pick($any($event.target).files?.[0])" /></label>
          <button type="button" class="ghost" [disabled]="busy() || !csv" (click)="importCsv()">Import</button>
          @if (imported(); as r) {
            <p class="ok">{{ r.created }} created, {{ r.updated }} updated, {{ r.rejected.length }} rejected.</p>
            @if (r.rejected.length) {
              <ul class="list small">
                @for (x of r.rejected; track x.row) { <li>Row {{ x.row }}: {{ x.reason }}</li> }
              </ul>
            }
          }
        </div>
      </section>
    </div>
  `,
})
export class StaffStockComponent extends StaffPage implements OnInit {
  protected readonly products = signal<ShopProduct[]>([]);
  protected readonly low = signal<ShopProduct[]>([]);
  protected readonly movements = signal<ShopMovement[]>([]);
  protected readonly imported = signal<ShopImportResult | null>(null);
  protected readonly when = dateTimeLabel;
  protected productId: number | null = null;
  protected quantity = 10;
  protected reference = '';
  protected change = 0;
  protected reason = 'count-correction';
  protected adjustNote = '';
  protected csv = '';

  ngOnInit(): void {
    this.loadProducts();
    this.loadLow();
  }

  private async loadProducts(): Promise<void> {
    try {
      this.products.set((await this.shop.staffProducts()).items);
    } catch (e) {
      this.error.set(this.shop.explain(e));
    }
  }

  protected async loadLow(): Promise<void> {
    try {
      this.low.set(await this.client.getStockLow());
    } catch (e) {
      this.error.set(this.shop.explain(e));
    }
  }

  protected async loadMovements(): Promise<void> {
    if (!this.productId) return;
    try {
      this.movements.set((await this.client.getStockMovements({ query: { productId: this.productId } })).items.slice(0, 10));
    } catch (e) {
      this.error.set(this.shop.explain(e));
    }
  }

  private async afterChange(): Promise<void> {
    await Promise.all([this.loadProducts(), this.loadLow(), this.loadMovements()]);
  }

  protected async goodsIn(): Promise<void> {
    const productId = this.productId;
    if (!productId) return;
    const m = await this.work(
      () => this.client.postStockGoodsIn({ body: { productId, quantity: Number(this.quantity), reference: this.reference.trim() || null } }),
      'Booked in.',
    );
    if (m) await this.afterChange();
  }

  protected async adjust(): Promise<void> {
    const productId = this.productId;
    if (!productId || !this.change) return;
    const m = await this.work(
      () => this.client.postStockAdjustments({ body: { productId, quantityChange: Number(this.change), reason: this.reason, note: this.adjustNote.trim() || null } }),
      'Stock adjusted.',
    );
    if (m) {
      this.change = 0;
      await this.afterChange();
    }
  }

  protected async pick(file: File | undefined): Promise<void> {
    this.csv = file ? await file.text() : '';
  }

  protected async importCsv(): Promise<void> {
    const r = await this.work(() => this.client.postStockImport({ raw: { contentType: 'text/csv', data: this.csv } }));
    if (r) {
      this.imported.set(r);
      await this.afterChange();
    }
  }
}
