import { ShopApiError } from '../gurukul-shop-client/shop-client';

/**
 * ONE mapping from the contract's error codes to sentences a shopper can act on
 * (shop-server.md lists every code). Anything not here falls back to the server's
 * own title with the code, so nothing is ever silent.
 */
const MESSAGES: Record<string, string> = {
  'shop.key_missing': 'This shop is not connected to its server.',
  'shop.key_invalid': 'This shop key is not valid any more. Make a new one on Connect your shop.',
  'shop.locked': 'This shop is closed right now.',
  'shop.public_key': 'That part of the shop is for staff, on the shop owner’s own computer.',
  'site.daily_limit': 'This shop has had all the visits it can take today. Please come back tomorrow.',
  'site.visit_required': 'Your visit ran out. Reload the page to start a new one.',
  'rate.limited': 'Lots of clicks at once. Wait a few seconds and try again.',
  'staff.code_invalid': 'That staff code is not right.',
  'staff.locked_out': 'Too many wrong staff codes. Wait ten minutes and try again.',
  'staff.required': 'Sign in as staff first.',
  'staff.session_invalid': 'Your staff session ended. Sign in again.',
  'customer.required': 'Sign in first.',
  'customer.session_invalid': 'You were signed out. Sign in again.',
  'customer.code_invalid': 'That code is not right, or it has expired. Ask for a new one.',
  'product.not_found': 'That product is not in the shop any more.',
  'basket.not_found': 'Your basket expired. Start a new one.',
  'basket.empty': 'Your basket is empty.',
  'basket.full': 'A basket holds at most 50 different products.',
  'stock.insufficient': 'Sorry, we do not have enough of one product any more.',
  'discount.invalid': 'That discount code is not valid or has ended.',
  'idempotency.key_required': 'Something went wrong placing the order. Try again.',
  'order.not_found': 'We could not find that order. Check the order number and the second detail.',
  'track.not_found': 'We could not find that order. Check the order number and the second detail.',
  'order.status': 'That cannot be done at this point of the order.',
  'order.none': 'You have no paid order to repeat yet.',
  'item_request.in_stock': 'Good news: that product is in stock now. Add it to your basket.',
  'quota.orders': 'This shop has taken all the orders it can today.',
  'quota.item_requests': 'You have 20 open requests already.',
  'quota.favourites': 'You have 100 favourites already.',
  'quota.addresses': 'You have 10 addresses already. Delete one first.',
  'stock.negative': 'That would take stock on hand below zero.',
  'stock.reserved': 'That stock is reserved by unpaid orders.',
  'product.sku_taken': 'Another product already has that SKU.',
  'category.name_taken': 'A category with that name already exists.',
  'discount.code_taken': 'That code already exists.',
  'supplier.name_taken': 'A supplier with that name already exists.',
  'purchase_order.nothing_low': 'Nothing is low on stock, so there is nothing to order.',
  'image.too_large': 'Images can be at most 512 KB.',
  'image.unsupported': 'Use a PNG, JPEG or WebP image.',
  'import.invalid': 'That file is not a stock CSV (header: sku,name,category,priceMinor,quantity,reorderLevel).',
  'import.too_large': 'The file is over 256 KB.',
  'validation.failed': 'Please check the highlighted details.',
};

export function messageFor(e: unknown): string {
  if (e instanceof ShopApiError) {
    const known = e.code ? MESSAGES[e.code] : undefined;
    if (e.code === 'site.daily_limit' && e.problem.detail) return String(e.problem.detail);
    if (known) {
      const fields = Array.isArray(e.problem['errors']) ? (e.problem['errors'] as Array<{ message: string }>).map((x) => x.message) : [];
      return fields.length ? `${known} ${fields.join(' ')}` : known;
    }
    if (e.status === 0 || e.status >= 500) return 'The shop server did not answer. Try again in a moment.';
    return `${e.message} (${e.code ?? e.status})`;
  }
  if (e instanceof TypeError) return 'The shop server could not be reached. Check your connection and try again.';
  return e instanceof Error ? e.message : String(e);
}

/** Field-level errors from 400 validation.failed, by field name (lower case). */
export function fieldErrors(e: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (e instanceof ShopApiError && Array.isArray(e.problem['errors'])) {
    for (const x of e.problem['errors'] as Array<{ field: string; message: string }>) out[(x.field ?? '').toLowerCase()] = x.message;
  }
  return out;
}
