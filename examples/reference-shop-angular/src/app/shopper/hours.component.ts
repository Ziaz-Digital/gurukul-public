import { Component, OnInit, ViewEncapsulation, inject, signal } from '@angular/core';
import { ShopOpeningHours } from '../../gurukul-shop-client/shop-client';
import { ShopService } from '../shop.service';

/** Opening hours and closures (`opening-hours`), read once per visit. */
@Component({
  selector: 'app-hours',
  encapsulation: ViewEncapsulation.None,
  template: `
    <h1>Opening hours</h1>
    @if (!shop.has('opening-hours')) {
      <p class="muted">We are open every day, 08:00–20:00.</p>
    } @else if (!hours()) {
      <p class="muted" role="status">Loading…</p>
    } @else {
      <table class="hours">
        <caption class="sr-only">Opening hours, in the shop’s time zone</caption>
        <tbody>
          @for (d of hours()!.week; track d.day) {
            <tr>
              <th scope="row">{{ cap(d.day) }}</th>
              <td>{{ d.opensAt && d.closesAt ? d.opensAt + '–' + d.closesAt : 'Closed' }}</td>
            </tr>
          }
        </tbody>
      </table>
      @if (hours()!.closures.length) {
        <h2>Closed on</h2>
        <ul class="list">
          @for (c of hours()!.closures; track c.date) {
            <li><span>{{ date(c.date) }}</span><span class="muted">{{ c.note }}</span></li>
          }
        </ul>
      }
    }
  `,
})
export class HoursComponent implements OnInit {
  protected readonly shop = inject(ShopService);
  protected readonly hours = signal<ShopOpeningHours | null>(null);

  async ngOnInit(): Promise<void> {
    this.hours.set(await this.shop.openingHours());
  }

  protected cap(day: string): string {
    return day.charAt(0).toUpperCase() + day.slice(1);
  }

  protected date(iso: string): string {
    return new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(iso + 'T12:00:00Z'));
  }
}
