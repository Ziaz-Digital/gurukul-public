import { Component, ViewEncapsulation, input } from '@angular/core';
import { ShopOrder } from '../../gurukul-shop-client/shop-client';
import { STATUS_TEXT, money, slotLabel } from '../shop.service';

/** The receipt: lines, discount, delivery fee and total as the SERVER priced them. */
@Component({
  selector: 'app-order-summary',
  encapsulation: ViewEncapsulation.None,
  template: `
    @let o = order();
    <section class="receipt" aria-label="Receipt">
      <dl class="facts">
        <div><dt>Order number</dt><dd class="mono">{{ o.orderNumber }}</dd></div>
        <div><dt>Status</dt><dd><span class="badge" [attr.data-status]="o.status">{{ status(o.status) }}</span></dd></div>
        <div><dt>{{ o.fulfilment === 'collection' ? 'Collect' : 'Delivery' }}</dt><dd>{{ slot(o.slot) }}</dd></div>
      </dl>
      <table>
        <caption class="sr-only">Order lines</caption>
        <thead><tr><th scope="col">Item</th><th scope="col" class="num">Qty</th><th scope="col" class="num">Price</th></tr></thead>
        <tbody>
          @for (l of o.lines; track l.productId) {
            <tr>
              <td>
                {{ l.name }}
                @if (l.substituteName) { <span class="muted small"><br />If it runs out: {{ l.substituteName }}</span> }
              </td>
              <td class="num">{{ l.quantity }}</td>
              <td class="num">{{ money(l.lineTotalMinor, o.currency) }}</td>
            </tr>
          }
        </tbody>
        <tfoot>
          @if (o.subtotalMinor !== undefined && o.subtotalMinor !== null) {
            <tr><th scope="row" colspan="2">Goods</th><td class="num">{{ money(o.subtotalMinor, o.currency) }}</td></tr>
          }
          @if (o.discountMinor) {
            <tr><th scope="row" colspan="2">Discount {{ o.discountCode }}</th><td class="num">−{{ money(o.discountMinor, o.currency) }}</td></tr>
          }
          @if (o.deliveryFeeMinor !== undefined && o.deliveryFeeMinor !== null) {
            <tr><th scope="row" colspan="2">Delivery</th><td class="num">{{ o.deliveryFeeMinor ? money(o.deliveryFeeMinor, o.currency) : 'Free' }}</td></tr>
          }
          <tr class="total"><th scope="row" colspan="2">Total</th><td class="num">{{ money(o.totalMinor, o.currency) }}</td></tr>
        </tfoot>
      </table>
    </section>
  `,
})
export class OrderSummaryComponent {
  readonly order = input.required<ShopOrder>();
  protected readonly money = money;
  protected readonly slot = slotLabel;
  protected status(s: string): string {
    return STATUS_TEXT[s] ?? s;
  }
}
