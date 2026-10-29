import { Injectable, computed, inject, signal } from '@angular/core';
import { ShopApiError, ShopBasket, ShopClient } from '../gurukul-shop-client/shop-client';
import { GkHost } from './gk-host';

/** The shop's shared state: the API client (from the host) and the basket. */
@Injectable({ providedIn: 'root' })
export class ShopService {
  private readonly host = inject(GkHost);
  readonly basket = signal<ShopBasket | null>(null);
  readonly count = computed(() => this.basket()?.lines.reduce((n, l) => n + l.quantity, 0) ?? 0);

  get client(): ShopClient {
    return this.host.bridge.client;
  }

  // Your storage keys must start with gk-<project-code>- (project-bundle.md).
  private get storageKey(): string {
    return this.host.bridge.storageKey('basket');
  }
  private savedId(): string | null {
    try {
      return sessionStorage.getItem(this.storageKey);
    } catch {
      return null;
    }
  }
  private saveId(id: string | null): void {
    try {
      if (id) sessionStorage.setItem(this.storageKey, id);
      else sessionStorage.removeItem(this.storageKey);
    } catch {
      /* storage blocked: the basket lasts until the page closes */
    }
  }

  async loadBasket(): Promise<void> {
    const id = this.savedId();
    if (!id) return this.basket.set(null);
    try {
      this.basket.set(await this.client.getBasketsByBasketId(id));
    } catch (e) {
      if (e instanceof ShopApiError && e.status === 404) {
        this.saveId(null);
        this.basket.set(null);
      } else throw e;
    }
  }

  async addToBasket(productId: number): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      let id = this.savedId();
      if (!id) {
        id = (await this.client.postBaskets()).basketId;
        this.saveId(id);
      }
      const current = this.basket();
      const quantity = current?.basketId === id ? (current.lines.find((l) => l.productId === productId)?.quantity ?? 0) : 0;
      try {
        this.basket.set(await this.client.putBasketsLinesByProductId(id, productId, { body: { quantity: quantity + 1 } }));
        return;
      } catch (e) {
        // The basket expired (24 hours idle): start a new one once.
        if (e instanceof ShopApiError && e.code === 'basket.not_found') this.saveId(null);
        else throw e;
      }
    }
  }

  async removeFromBasket(productId: number): Promise<void> {
    const id = this.savedId();
    if (id) this.basket.set(await this.client.deleteBasketsLinesByProductId(id, productId));
  }
}

/** Money is integer minor units (shop-server.md). */
export function money(minor: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(minor / 100);
}

/** A sentence for an API error, with the contract's code. */
export function problemText(e: unknown): string {
  if (e instanceof ShopApiError) return `${e.message} (${e.code ?? e.status})`;
  return e instanceof Error ? e.message : String(e);
}
