import { gurukul } from '../../package.json';

/**
 * The add-ons this shop was BUILT for: package.json → gurukul.capabilities (the same
 * list make-bundle writes into gk-project.json). The core is always on.
 *
 * What is actually switched on is the shop server's decision (your Product Owner
 * choice): a route of an add-on you did not choose answers
 * 404 { code: "capability.not_chosen", capability }. ShopService turns such an add-on
 * off for the rest of the visit, and every screen hides what is off.
 */
export type AddOn =
  | 'customer-accounts'
  | 'ask-unavailable-item'
  | 'favourites-reorder'
  | 'cancel-before-packing'
  | 'discount-codes'
  | 'delivery-fees-cutoffs'
  | 'click-and-collect'
  | 'substitutions'
  | 'product-images'
  | 'sales-stock-report'
  | 'suppliers-purchase-orders'
  | 'opening-hours';

export const BUILT_FOR: ReadonlySet<string> = new Set<string>(gurukul.capabilities);

/** The shared customer sign-in is on when ANY of these three is (shop-server.md). */
export const SIGN_IN_ADD_ONS: readonly AddOn[] = ['customer-accounts', 'ask-unavailable-item', 'favourites-reorder'];
