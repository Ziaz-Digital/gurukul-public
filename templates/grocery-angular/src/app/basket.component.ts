import { Component, OnInit, ViewEncapsulation, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ShopService, money, problemText } from './shop.service';

/** The basket: GET /baskets/{id}. Checkout, delivery slots and payment are yours to build. */
@Component({
  selector: 'app-basket',
  encapsulation: ViewEncapsulation.None,
  imports: [RouterLink],
  template: `
    @if (error()) {
      <p class="error">{{ error() }}</p>
    } @else if (!shop.basket()?.lines?.length) {
      <p class="muted">Your basket is empty. <a routerLink="/">Go shopping</a></p>
    } @else {
      <section aria-label="Basket">
        <ul class="lines">
          @for (l of shop.basket()!.lines; track l.productId) {
            <li>
              <span>{{ l.quantity }} × {{ l.name }}</span>
              <span>{{ money(l.lineTotalMinor, shop.basket()!.currency) }}</span>
              <button type="button" (click)="remove(l.productId)">Remove</button>
            </li>
          }
        </ul>
        <p class="total">Total {{ money(shop.basket()!.totalMinor, shop.basket()!.currency) }}</p>
      </section>
    }
  `,
})
export class BasketComponent implements OnInit {
  protected readonly shop = inject(ShopService);
  protected readonly error = signal<string | null>(null);
  protected readonly money = money;

  ngOnInit(): void {
    this.shop.loadBasket().catch((e) => this.error.set(problemText(e)));
  }

  protected remove(productId: number): void {
    this.shop.removeFromBasket(productId).catch((e) => this.error.set(problemText(e)));
  }
}
