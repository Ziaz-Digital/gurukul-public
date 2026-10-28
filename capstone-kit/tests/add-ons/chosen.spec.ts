import { test, expect, Res, Shop } from '../../src/shop';
import { AddOn } from '../../src/capabilities';

// Every add-on you chose answers on its routes: none of them may say
// 404 capability.not_chosen. (Add-ons you did NOT choose are not checked —
// your backend need not have a switch for them at all.)

const probes: Record<AddOn, (shop: Shop, staff: string) => Promise<Res>> = {
  'ask-unavailable-item': (shop, staff) => shop.get('/staff/item-requests', { token: staff }),
  'favourites-reorder': (shop) => shop.get('/customers/me/favourites'),
  'cancel-before-packing': (shop) => shop.post('/orders/GS-ZZZZZZZZZZ/cancel', { postcode: '0000' }),
  'discount-codes': (shop, staff) => shop.get('/staff/discount-codes', { token: staff }),
  'delivery-fees-cutoffs': (shop) => shop.get('/delivery-rules'),
  'click-and-collect': (shop, staff) => shop.post('/staff/orders/GS-ZZZZZZZZZZ/collected', {}, { token: staff }),
  substitutions: async (shop) => {
    const basket = await shop.post('/baskets');
    return shop.delete(`/baskets/${basket.body.basketId}/lines/987654321/substitute`);
  },
  'customer-accounts': (shop) => shop.get('/customers/me/addresses'),
  'product-images': (shop) => shop.get('/products/987654321/image'),
  'sales-stock-report': (shop, staff) => shop.get('/staff/reports/sales-stock', { token: staff }),
  'suppliers-purchase-orders': (shop, staff) => shop.get('/staff/suppliers', { token: staff }),
  'opening-hours': (shop) => shop.get('/opening-hours'),
};

for (const [key, probe] of Object.entries(probes) as [AddOn, (typeof probes)[AddOn]][]) {
  test(`X-00 the add-on ${key} is switched on`, { tag: [`@${key}`] }, async ({ shop, staff }) => {
    const res = await probe(shop, staff);
    expect(res.body?.code, `${key} answered ${res.status}: ${res.text}`).not.toBe('capability.not_chosen');
    expect(res.status, `${key} answered ${res.status}: ${res.text}`).not.toBe(405);
  });
}
