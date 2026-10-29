# Your grocery shop, in Angular

This is Gurukul's starter template for the Capstone's front end, Angular track (Angular 21). Build your shop inside it. When it is finished, Gurukul shows it to interviewers inside its own site, looking exactly as it does on your laptop and talking to the same shop server.

It already works: a product list with "Add to basket", and a basket page. The rest (search, checkout, delivery slots, payment, tracking, your add-ons, your design) is yours to build.

## What you need

- Node.js 22 (or 20.19 and newer).
- Your **shop key** from your Capstone's **Connect your shop** page.

## Start

1. Copy this whole folder into your Capstone repository (for example as `frontend/`).
2. Copy `.env.example` to `.env.local` and paste your shop key into `SHOP_KEY`. Git ignores `.env.local`: your key never leaves your machine.
3. Run:

   ```bash
   npm ci
   npm run dev
   ```

4. Open http://localhost:4380. You see your shop, with the products you added as staff.

## Where things are

| File | What it is |
|---|---|
| `src/app/routes.ts` | Your pages and their routes. Add pages here. |
| `src/app/catalogue.component.ts`, `basket.component.ts` | The two pages you start with. |
| `src/app/shop.service.ts` | The basket, shared by every page. |
| `src/app/gk-project.component.*` | The shop's frame (header, menu) and **all its styles** (`.css`). |
| `src/gurukul-shop-client/` | **The master API library.** Every call to the shop server goes through `ShopService.client` (for example `client.getProducts()`, `client.postOrders(…)`). Do not edit it; a newer template brings a newer copy. |
| `src/main.ts`, `src/app/gk-host.ts`, `src/app/base-path-location.ts` | Make your app the `<gk-project>` element Gurukul's site loads, and keep its routes in its place. You rarely need to touch them. |
| `src/index.html` | The dev page for `npm run dev`. Not part of your bundle. |

## The rules your shop must follow

Gurukul puts your shop inside its own page, so a few things are not allowed. The full contract is in the README of Gurukul's public repository ("Your front end in the Gurukul showcase"); the short version:

- **Call only the shop server**, always through the library. No other websites, no CDNs, no analytics.
- **Use the router for every link** (`routerLink`, `Router.navigate`). Never write to `window.location`. Gurukul gives your shop a place in the address bar, and the router keeps you inside it.
- **Styles:** put them in `gk-project.component.css`. A new component either has no styles of its own (`encapsulation: ViewEncapsulation.None`, like the pages here) or uses `ViewEncapsulation.ShadowDom`. A component with its own styles and the default setting would put them into Gurukul's page. Never style `html` or `body`.
- **No zone.js** (the app is zoneless; use signals). It would change Gurukul's page.
- **Storage keys** go through `host.bridge.storageKey('name')` (they start with `gk-<your project code>-`). No cookies. No service workers.
- **No keys in your code.** Your key lives in `.env.local` only. Staff screens work on your machine; on Gurukul's site the shop is customer-only.
- For payment, open the order's `paymentUrl` with `returnUrl` set to `host.bridge.absoluteUrl('/your-confirmation-page')`.

## Pack it and try it as Gurukul will show it

```bash
npm run bundle     # builds project-bundle.zip
npm run preview    # opens it inside a stand-in for Gurukul's site
```

Open http://localhost:4381/p/preview/demo/. If your shop works there, it will work on Gurukul's site.

## Publish it

1. Copy `examples/project-bundle-workflow.yml` from Gurukul's public repository to `.github/workflows/gurukul-project-bundle.yml` in your repository, and set `working-directory` to this folder.
2. Push to `main`: your GitHub Actions build and check the bundle.
3. When you are ready, push a tag: `git tag v1.0.0` then `git push origin v1.0.0`. The workflow attaches `project-bundle.zip` to a GitHub Release.
4. On your Capstone's **Connect your shop** page, mark that release **Ready to publish**. The Gurukul team publishes it and emails you the address of your project page.
5. Open your project page and check your shop there. In Gurukul, **Your project page** is where you choose **Show my project** and which stages the page shares.

Your code is built only in your own GitHub pipeline. Gurukul only downloads the finished zip.

In `package.json`, list the add-ons you built under `gurukul.capabilities` (for example `["discount-codes"]`).
