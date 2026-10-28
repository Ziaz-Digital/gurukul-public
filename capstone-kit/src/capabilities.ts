/**
 * The capability keys of the Gurukul Capstone shop (D-500). They never change:
 * your choice on the Product Owner stage, the shop contract and this kit all
 * hang on them.
 */
export const CORE = [
  'catalogue',
  'stock',
  'low-stock',
  'checkout-reservation',
  'payment',
  'order-receipt',
  'pick-pack',
  'delivery-booking',
  'track-order',
  'staff-sign-in',
  'opening-stock-import',
] as const;

export const ADD_ONS = [
  'ask-unavailable-item',
  'favourites-reorder',
  'cancel-before-packing',
  'discount-codes',
  'delivery-fees-cutoffs',
  'click-and-collect',
  'substitutions',
  'customer-accounts',
  'product-images',
  'sales-stock-report',
  'suppliers-purchase-orders',
  'opening-hours',
] as const;

export type AddOn = (typeof ADD_ONS)[number];

/**
 * Reads CAPABILITIES ("discount-codes,click-and-collect"; commas, spaces or
 * new lines between keys). Core keys are accepted and ignored: the core always
 * runs. An unknown key is an error, so a typo never silently skips tests.
 */
export function parseCapabilities(raw: string | undefined): AddOn[] {
  const keys = (raw ?? '')
    .split(/[\s,]+/)
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.length > 0);

  const unknown = keys.filter(
    (k) => !(ADD_ONS as readonly string[]).includes(k) && !(CORE as readonly string[]).includes(k),
  );
  if (unknown.length > 0) {
    throw new Error(
      `CAPABILITIES has unknown key(s): ${unknown.join(', ')}. ` +
        `Add-ons are: ${ADD_ONS.join(', ')}. Core keys may be listed but always run.`,
    );
  }
  return ADD_ONS.filter((a) => keys.includes(a));
}

/** The tests to run: every @core test, plus each chosen add-on's tag. */
export function grepFor(addOns: readonly string[]): RegExp {
  const tags = ['core', ...addOns].map((t) => t.replace(/[-]/g, '\\-'));
  // A tag ends at a space, a quote or the end of the title, so @stock never matches @stock-x.
  return new RegExp(`@(${tags.join('|')})(?![\\w-])`);
}
