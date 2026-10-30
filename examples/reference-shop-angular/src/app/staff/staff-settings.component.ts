import { Component, OnInit, ViewEncapsulation, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ShopClosure, ShopDiscountCode, ShopOpeningDay } from '../../gurukul-shop-client/shop-client';
import { money, toMinor } from '../shop.service';
import { STATUS_LINES, StaffPage } from './staff-page';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

/**
 * Shop settings, one section per add-on: discount codes (`discount-codes`), delivery
 * fees and cut-off (`delivery-fees-cutoffs`), opening hours and closures (`opening-hours`).
 */
@Component({
  selector: 'app-staff-settings',
  encapsulation: ViewEncapsulation.None,
  imports: [FormsModule],
  template: `
    ${STATUS_LINES}
    @if (!shop.has('discount-codes') && !shop.has('delivery-fees-cutoffs') && !shop.has('opening-hours')) {
      <p class="muted">None of the settings add-ons is switched on for this shop.</p>
    }

    @if (shop.has('discount-codes')) {
      <section class="panel">
        <h2>Discount codes</h2>
        <ul class="list">
          @for (d of codes(); track d.id) {
            <li>
              <span class="mono">{{ d.code }}</span>
              <span>{{ d.kind === 'percent' ? d.value + '% off' : money(d.value, 'EUR') + ' off' }}</span>
              <span class="muted small">until {{ d.endsAtUtc.slice(0, 10) }}</span>
              <button type="button" class="link" [disabled]="busy()" (click)="deleteCode(d.id)" [attr.aria-label]="'Delete code ' + d.code">Delete</button>
            </li>
          } @empty {
            <li class="muted">No codes yet.</li>
          }
        </ul>
        <form class="inline-form" (ngSubmit)="addCode()">
          <label>Code <input name="code" required maxlength="20" [(ngModel)]="code.code" /></label>
          <label>
            Kind
            <select name="kind" [(ngModel)]="code.kind">
              <option value="percent">Percent</option>
              <option value="amount">Amount</option>
            </select>
          </label>
          <label>{{ code.kind === 'percent' ? 'Percent (1–100)' : 'Amount (e.g. 5.00)' }} <input name="value" required inputmode="decimal" [(ngModel)]="code.value" /></label>
          <label>Ends on <input name="ends" type="date" required [(ngModel)]="code.ends" /></label>
          <button type="submit" class="ghost" [disabled]="busy()">Add code</button>
        </form>
      </section>
    }

    @if (shop.has('delivery-fees-cutoffs')) {
      <section class="panel">
        <h2>Delivery fees and cut-off</h2>
        <p class="small muted">The fee is the band with the highest minimum at or below the basket. A band with fee 0 is “free delivery over …”.</p>
        <form (ngSubmit)="saveRules()">
          @for (b of bands; track $index) {
            <div class="inline-form">
              <label>Basket from <input [name]="'min' + $index" inputmode="decimal" [(ngModel)]="b.min" /></label>
              <label>Fee <input [name]="'fee' + $index" inputmode="decimal" [(ngModel)]="b.fee" /></label>
              <button type="button" class="link" (click)="bands.splice($index, 1)">Remove</button>
            </div>
          }
          @if (bands.length < 5) {
            <button type="button" class="link" (click)="bands.push({ min: '0', fee: '0' })">Add a band</button>
          }
          <label>Cut-off before a slot (minutes) <input name="cutoff" type="number" min="0" max="2880" [(ngModel)]="cutoff" /></label>
          <button type="submit" class="ghost" [disabled]="busy()">Save delivery rules</button>
        </form>
      </section>
    }

    @if (shop.has('opening-hours')) {
      <section class="panel">
        <h2>Opening hours</h2>
        <form (ngSubmit)="saveHours()">
          <div class="table-wrap">
            <table>
              <caption class="sr-only">Opening hours per day</caption>
              <thead><tr><th scope="col">Day</th><th scope="col">Open</th><th scope="col">Opens</th><th scope="col">Closes</th></tr></thead>
              <tbody>
                @for (d of week; track d.day) {
                  <tr>
                    <th scope="row">{{ d.day }}</th>
                    <td><input type="checkbox" [name]="'open-' + d.day" [(ngModel)]="d.open" [attr.aria-label]="'Open on ' + d.day" /></td>
                    <td><input type="time" [name]="'opens-' + d.day" [(ngModel)]="d.opensAt" [disabled]="!d.open" [attr.aria-label]="'Opens on ' + d.day" /></td>
                    <td><input type="time" [name]="'closes-' + d.day" [(ngModel)]="d.closesAt" [disabled]="!d.open" [attr.aria-label]="'Closes on ' + d.day" /></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <button type="submit" class="ghost" [disabled]="busy()">Save opening hours</button>
        </form>
        <h3>Closures</h3>
        <ul class="list">
          @for (c of closures(); track c.date) {
            <li><span>{{ c.date }}</span><span class="muted">{{ c.note }}</span><button type="button" class="link" [disabled]="busy()" (click)="deleteClosure(c.date)">Delete</button></li>
          } @empty {
            <li class="muted">No closures planned.</li>
          }
        </ul>
        <form class="inline-form" (ngSubmit)="addClosure()">
          <label>Date <input name="closureDate" type="date" required [(ngModel)]="closureDate" /></label>
          <label>Note (optional) <input name="closureNote" [(ngModel)]="closureNote" /></label>
          <button type="submit" class="ghost" [disabled]="busy() || !closureDate">Add closure</button>
        </form>
      </section>
    }
  `,
})
export class StaffSettingsComponent extends StaffPage implements OnInit {
  protected readonly money = money;
  protected readonly codes = signal<ShopDiscountCode[]>([]);
  protected readonly closures = signal<ShopClosure[]>([]);
  protected code = { code: '', kind: 'percent', value: '10', ends: '' };
  protected bands: Array<{ min: string; fee: string }> = [];
  protected cutoff = 0;
  protected week: Array<{ day: string; open: boolean; opensAt: string; closesAt: string }> = DAYS.map((day) => ({ day, open: true, opensAt: '08:00', closesAt: '20:00' }));
  protected closureDate = '';
  protected closureNote = '';

  async ngOnInit(): Promise<void> {
    try {
      if (this.shop.has('discount-codes')) this.codes.set(await this.client.getStaffDiscountCodes());
      if (this.shop.has('delivery-fees-cutoffs')) {
        const r = await this.client.getDeliveryRules();
        this.bands = r.feeBands.map((b) => ({ min: (b.minBasketMinor / 100).toFixed(2), fee: (b.feeMinor / 100).toFixed(2) }));
        this.cutoff = r.slotCutoffMinutes;
      }
      if (this.shop.has('opening-hours')) this.applyHours(await this.client.getOpeningHours());
    } catch (e) {
      this.error.set(this.shop.explain(e));
    }
  }

  private applyHours(h: { week: ShopOpeningDay[]; closures: ShopClosure[] }): void {
    this.week = DAYS.map((day) => {
      const d = h.week.find((x) => x.day === day);
      return { day, open: !!d?.opensAt, opensAt: d?.opensAt ?? '08:00', closesAt: d?.closesAt ?? '20:00' };
    });
    this.closures.set(h.closures);
  }

  protected async addCode(): Promise<void> {
    const value = this.code.kind === 'percent' ? Math.round(Number(this.code.value)) : toMinor(this.code.value);
    if (!this.code.code.trim() || !value || !this.code.ends) {
      this.error.set('Fill in the code, a value and the end date.');
      return;
    }
    const body = { code: this.code.code.trim().toUpperCase(), kind: this.code.kind, value, endsAtUtc: new Date(this.code.ends + 'T23:59:00Z').toISOString() };
    const d = await this.work(() => this.client.postStaffDiscountCodes({ body }), `Code ${body.code} added.`);
    if (d) {
      this.codes.update((list) => [d, ...list]);
      this.code = { code: '', kind: 'percent', value: '10', ends: '' };
    }
  }

  protected async deleteCode(id: number): Promise<void> {
    await this.work(() => this.client.deleteStaffDiscountCodesById(id));
    if (!this.error()) this.codes.update((list) => list.filter((d) => d.id !== id));
  }

  protected async saveRules(): Promise<void> {
    const feeBands = this.bands.map((b) => ({ minBasketMinor: toMinor(b.min) ?? 0, feeMinor: toMinor(b.fee) ?? 0 }));
    await this.work(() => this.client.putStaffDeliveryRules({ body: { feeBands, slotCutoffMinutes: Number(this.cutoff) || 0 } }), 'Delivery rules saved.');
  }

  protected async saveHours(): Promise<void> {
    const week = this.week.map((d) => (d.open ? { day: d.day, opensAt: d.opensAt, closesAt: d.closesAt } : { day: d.day }));
    const h = await this.work(() => this.client.putStaffOpeningHours({ body: { week } }), 'Opening hours saved.');
    if (h) this.applyHours({ week: h.week, closures: this.closures() });
  }

  protected async addClosure(): Promise<void> {
    const date = this.closureDate;
    const c = await this.work(() => this.client.putStaffClosuresByDate(date, { body: { note: this.closureNote.trim() || null } }), 'Closure added.');
    if (c) {
      this.closures.update((list) => [...list.filter((x) => x.date !== c.date), c].sort((a, b) => a.date.localeCompare(b.date)));
      this.closureDate = '';
      this.closureNote = '';
    }
  }

  protected async deleteClosure(date: string): Promise<void> {
    await this.work(() => this.client.deleteStaffClosuresByDate(date));
    if (!this.error()) this.closures.update((list) => list.filter((c) => c.date !== date));
  }
}
