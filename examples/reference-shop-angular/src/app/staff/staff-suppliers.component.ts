import { Component, OnInit, ViewEncapsulation, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ShopPurchaseOrder, ShopSupplier } from '../../gurukul-shop-client/shop-client';
import { dateTimeLabel } from '../shop.service';
import { STATUS_LINES, StaffPage } from './staff-page';

/** Suppliers and purchase orders (`suppliers-purchase-orders`): raise from the low-stock list, receive into stock. */
@Component({
  selector: 'app-staff-suppliers',
  encapsulation: ViewEncapsulation.None,
  imports: [FormsModule],
  template: `
    ${STATUS_LINES}
    <div class="two-col">
      <section class="panel">
        <h2>Suppliers</h2>
        <ul class="list">
          @for (s of suppliers(); track s.id) {
            <li>
              <span><strong>{{ s.name }}</strong> <span class="muted small">{{ s.email }} {{ s.phone }}</span></span>
              <button type="button" class="link" (click)="edit(s)" [attr.aria-label]="'Edit ' + s.name">Edit</button>
            </li>
          } @empty {
            <li class="muted">No suppliers yet.</li>
          }
        </ul>
        <form (ngSubmit)="save()">
          <h3>{{ form.id ? 'Edit supplier' : 'New supplier' }}</h3>
          <label>Name <input name="sName" required [(ngModel)]="form.name" /></label>
          <label>Email (optional) <input name="sEmail" type="email" [(ngModel)]="form.email" /></label>
          <label>Phone (optional) <input name="sPhone" type="tel" [(ngModel)]="form.phone" /></label>
          <button type="submit" class="ghost" [disabled]="busy() || !form.name.trim()">{{ form.id ? 'Save' : 'Add supplier' }}</button>
        </form>
      </section>

      <section>
        <div class="head-row">
          <h2>Purchase orders</h2>
        </div>
        <form class="inline-form" (ngSubmit)="raise()">
          <label>
            Supplier
            <select name="poSupplier" [(ngModel)]="supplierId">
              <option [ngValue]="null" disabled>Choose</option>
              @for (s of suppliers(); track s.id) { <option [ngValue]="s.id">{{ s.name }}</option> }
            </select>
          </label>
          <button type="submit" class="primary" [disabled]="busy() || !supplierId">Order everything that is low</button>
        </form>
        <ul class="orders">
          @for (po of orders(); track po.id) {
            <li class="panel">
              <div class="head-row">
                <strong>PO-{{ po.id }} · {{ po.supplierName }}</strong>
                <span class="badge" [attr.data-status]="po.status === 'received' ? 'delivered' : 'paid'">{{ po.status }}</span>
              </div>
              <p class="small muted">Raised {{ when(po.createdAtUtc) }}{{ po.receivedAtUtc ? ' · received ' + when(po.receivedAtUtc) : '' }}</p>
              <ul class="pick small">
                @for (l of po.lines; track l.productId) { <li>{{ l.quantity }} × {{ l.name }}</li> }
              </ul>
              @if (po.status === 'open') {
                <button type="button" class="ghost" [disabled]="busy()" (click)="receive(po)">Received — book it in</button>
              }
            </li>
          } @empty {
            <li class="muted">No purchase orders yet.</li>
          }
        </ul>
      </section>
    </div>
  `,
})
export class StaffSuppliersComponent extends StaffPage implements OnInit {
  protected readonly suppliers = signal<ShopSupplier[]>([]);
  protected readonly orders = signal<ShopPurchaseOrder[]>([]);
  protected readonly when = dateTimeLabel;
  protected form: { id: number | null; name: string; email: string; phone: string } = { id: null, name: '', email: '', phone: '' };
  protected supplierId: number | null = null;

  async ngOnInit(): Promise<void> {
    try {
      this.suppliers.set(await this.client.getStaffSuppliers());
      this.orders.set(await this.client.getStaffPurchaseOrders());
      this.supplierId = this.suppliers()[0]?.id ?? null;
    } catch (e) {
      this.error.set(this.shop.explain(e));
    }
  }

  protected edit(s: ShopSupplier): void {
    this.form = { id: s.id, name: s.name, email: s.email ?? '', phone: s.phone ?? '' };
  }

  protected async save(): Promise<void> {
    const body = { name: this.form.name.trim(), email: this.form.email.trim() || null, phone: this.form.phone.trim() || null };
    const id = this.form.id;
    const s = await this.work(() => (id ? this.client.putStaffSuppliersById(id, { body }) : this.client.postStaffSuppliers({ body })), 'Supplier saved.');
    if (s) {
      this.suppliers.update((list) => [...list.filter((x) => x.id !== s.id), s].sort((a, b) => a.name.localeCompare(b.name)));
      this.form = { id: null, name: '', email: '', phone: '' };
      this.supplierId ??= s.id;
    }
  }

  protected async raise(): Promise<void> {
    const supplierId = this.supplierId;
    if (!supplierId) return;
    const po = await this.work(() => this.client.postStaffPurchaseOrders({ body: { supplierId } }), 'Purchase order raised from the low-stock list.');
    if (po) this.orders.update((list) => [po, ...list]);
  }

  protected async receive(po: ShopPurchaseOrder): Promise<void> {
    const done = await this.work(() => this.client.postStaffPurchaseOrdersReceive(po.id), `PO-${po.id} booked into stock.`);
    if (done) this.orders.update((list) => list.map((x) => (x.id === done.id ? done : x)));
  }
}
