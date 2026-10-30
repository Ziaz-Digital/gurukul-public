# The reference grocery shop (Angular)

This is what a **finished** Capstone shop looks like: Gurukul's own grocery shop, built inside the Angular starter template ([`templates/grocery-angular`](../../templates/grocery-angular)) with **every one of the 12 add-ons**. "The final product should look like this" — in scope, not in looks. **Change the UI and UX as much as you like**: the colours are tokens at the top of `src/app/gk-project.component.css`, and every screen is a small component you can rewrite. What you must keep is the contract (below).

It has the template's structure and scripts unchanged (`npm run dev`, `npm run bundle`, `npm run preview`), the same `src/gurukul-shop-client/` library, untouched, and follows every rule in the template's README.

## Run it against your own shop

You need Node.js 22 (or 20.19+) and your **shop key** and **staff code** from your Capstone's **Connect your shop** page.

1. Copy `.env.example` to `.env.local` and paste your key into `SHOP_KEY` (git ignores `.env.local`; your key never leaves your machine).
2. `npm ci` then `npm run dev`, and open http://localhost:4380.
3. Your data space starts empty. Open **Staff**, sign in with your staff code, and add products (Products), book stock in (Stock → Goods in) or import a CSV (Stock → Opening stock import). Then shop as a customer.
4. Try it as Gurukul's showcase will show it: `npm run bundle` then `npm run preview`, and open http://localhost:4381/p/preview/demo/.

On your laptop, the customer sign-in code is written to your shop's outbox (`GET /dev/outbox`); the sign-in page has a "Read it from the outbox" button. In the showcase (public key) the server returns the code and the page shows it on screen.

The add-ons you did **not** choose as Product Owner answer `404 capability.not_chosen`; the shop hides that part for the rest of the visit, so it works whatever you chose. List the add-ons you built in `package.json` → `gurukul.capabilities` (this one lists all 12).

## Screens, and the contract capability behind each

Routes are relative to the base path the host gives (`/p/<college>/<project>` in the showcase).

### Shopper — your laptop and the showcase

| Route | Screen | Capability (shop-server.md) |
|---|---|---|
| `/` | Catalogue: categories, search, pages, stock states (out of stock disabled, "Only N left") | `catalogue` |
| `/` (pictures) | Product pictures, fetched with the shop key and shown through `URL.createObjectURL` | `product-images` |
| `/product/:id` | Product detail, quantity, add to basket | `catalogue` |
| `/product/:id` | "Tell me when it is back" on an out-of-stock product | `ask-unavailable-item` |
| `/basket` | Basket: change quantity, remove, busy state on every change | `checkout-reservation` |
| `/basket` | "If it runs out, replace with …" | `substitutions` |
| `/checkout` | Details, address, delivery slot, place the order with an `Idempotency-Key` | `checkout-reservation`, `payment` |
| `/checkout` | Deliver or collect | `click-and-collect` |
| `/checkout` | Delivery fee and "free delivery over …" | `delivery-fees-cutoffs` |
| `/checkout` | Discount code | `discount-codes` |
| `/checkout` | Saved addresses | `customer-accounts` |
| `/confirmation`, `/order/:orderNumber` | Reads `GET /orders/{orderNumber}` (never trusts `?result=`); the receipt; "Go to payment" while unpaid | `order-receipt`, `payment` |
| `/confirmation`, `/order/:orderNumber` | Cancel before packing | `cancel-before-packing` |
| `/track` | Order number + postcode (or email for a collection) | `track-order` |
| `/sign-in` | Email + 6-digit code | the shared customer sign-in (`customer-accounts` / `ask-unavailable-item` / `favourites-reorder`) |
| dialog after sign-in | "Still looking for X? We have it now." — add to basket or dismiss | `ask-unavailable-item` |
| `/account?tab=favourites` | Favourites (♡ on every product card) and "Order my last order again" | `favourites-reorder` |
| `/account?tab=orders`, `…addresses` | My orders, my addresses | `customer-accounts` |
| `/account?tab=requests` | What I asked for; ask for something not stocked at all | `ask-unavailable-item` |
| `/hours` | Opening hours and closures | `opening-hours` |

### Staff — your laptop only

Hidden in the showcase (`client.hosted`): the public key answers 403 `shop.public_key` on every staff route.

| Route | Screen | Capability |
|---|---|---|
| `/staff` | Staff sign-in with the staff code | `staff-sign-in` |
| `/staff/orders` | Orders to pick and pack: packed, book the courier, collected, substitutes on the pick list, advance the test courier | `pick-pack`, `delivery-booking`, `click-and-collect`, `substitutions` |
| `/staff/products` | Products (create, edit, on sale or not), categories, pictures | `catalogue`, `product-images` |
| `/staff/stock` | Goods in, adjustments, movement history, low-stock list, opening stock CSV import | `stock`, `low-stock`, `opening-stock-import` |
| `/staff/suppliers` | Suppliers; purchase orders raised from the low-stock list; receive into stock | `suppliers-purchase-orders` |
| `/staff/settings` | Discount codes, delivery fees and cut-off, opening hours and closures | `discount-codes`, `delivery-fees-cutoffs`, `opening-hours` |
| `/staff/report` | Sales and stock report; what customers are asking for | `sales-stock-report`, `ask-unavailable-item` |

### View as staff (read only) — the showcase only

| Route | Screen | API |
|---|---|---|
| `/staff-view?tab=inventory` | Every product's stock and price, search, pages | `GET /public/staff-view/inventory` |
| `/staff-view?tab=orders` | Orders by status, **no personal data** | `GET /public/staff-view/orders` |
| `/staff-view?tab=shortages` | Products at or below their reorder level | `GET /public/staff-view/low-stock` |

These three routes are newer than this copy of the library, so `src/app/staff-view/staff-view.api.ts` calls them with the same headers the library sends; until the server has them, the tab says "Not available yet". Nothing there can be changed.

## The daily request budget

A published project may make only a limited number of **API calls a day** (all its visitors together), on top of the per-minute rate limit. Past it, the API answers `429 site.daily_limit` until the next UTC day. So the shop is careful with what it reads (`src/app/shop.service.ts`):

- Categories, delivery rules and opening hours are read **once per visit** and kept.
- Product lists, search results, product details and delivery slots are reused for **60 seconds**, so going back and forth between pages costs nothing; they are dropped as soon as the shopper adds to the basket or places an order, so stock stays honest.
- The basket is read once per visit; after that, every change returns the new basket.
- **Nothing polls.** The confirmation and tracking pages refresh only when the shopper presses "Check again".
- The basket, orders, payment and anything about the signed-in customer are never cached.

Do the same in your own shop: a page that re-reads everything on every route change, or polls an order every few seconds, can use up a day's budget for everyone in a few visits.

## The rules it keeps (project-bundle.md)

Zoneless signals; every link through the router under the base path; all styles in the one Shadow DOM stylesheet (no global CSS); storage keys through `host.bridge.storageKey` (`sessionStorage` only, no cookies, no service worker); calls only to the API it was given, always through the library (plus the one temporary staff-view wrapper); no keys in the code; the only full-page navigation is to the order's `paymentUrl`, with `returnUrl = host.bridge.absoluteUrl('/confirmation')`.

## Its own test

`e2e/reference-shop.spec.ts` mounts the bundle in the preview host with the API **stubbed** (no server, no real key) and walks: browse → search → add to basket → change quantity → checkout → payment → back → confirmation; sign-in with the on-screen code → "we have it now" → favourites; the read-only staff view (and "Not available yet" without its routes); staff sign-in and the pick list on the laptop. It also checks that browsing back and forth does not repeat the same read within a minute, and the bundle contract (key and visit on every call, storage prefix, no cookies, no global styles, no other hosts).

```bash
npm run bundle
npx playwright install chromium   # once
npm run test:e2e                  # PW_CHANNEL=msedge or chrome uses an installed browser instead
```
