import { Injectable, inject } from '@angular/core';
import {
  ShopPageOfShopStaffViewOrder,
  ShopPageOfShopStaffViewProduct,
  ShopStaffViewOrder,
  ShopStaffViewProduct,
} from '../../gurukul-shop-client/shop-client';
import { READ_TTL_MS, ShopService } from '../shop.service';

/**
 * The read-only "view as staff" routes for a PUBLISHED project (D-500 addendum 9 §3):
 * GET /public/staff-view/inventory | orders | low-stock, through the shop library like
 * every other call. Orders carry no personal data (no email, address or customer id).
 */

export type StaffViewProduct = ShopStaffViewProduct;
export type StaffViewOrder = ShopStaffViewOrder;

@Injectable({ providedIn: 'root' })
export class StaffViewApi {
  private readonly shop = inject(ShopService);
  /** Read-only data, reused for READ_TTL_MS like the catalogue (the daily request budget). */
  private readonly cache = new Map<string, { at: number; value: Promise<unknown> }>();

  inventory(query: { search?: string; page?: number; pageSize?: number } = {}): Promise<ShopPageOfShopStaffViewProduct> {
    return this.cached('inventory' + JSON.stringify(query), () => this.shop.client.getPublicStaffViewInventory({ query }));
  }

  orders(query: { status?: string; page?: number; pageSize?: number } = {}): Promise<ShopPageOfShopStaffViewOrder> {
    return this.cached('orders' + JSON.stringify(query), () => this.shop.client.getPublicStaffViewOrders({ query }));
  }

  async lowStock(): Promise<StaffViewProduct[]> {
    const page = await this.cached('low', () => this.shop.client.getPublicStaffViewLowStock({ query: { pageSize: 100 } }));
    return page.items;
  }

  private cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < READ_TTL_MS) return hit.value as Promise<T>;
    const value = load();
    this.cache.set(key, { at: Date.now(), value });
    value.catch(() => this.cache.delete(key));
    return value;
  }
}
