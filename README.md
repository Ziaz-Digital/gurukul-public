# Gurukul public

Public material for Ziaz Gurukul learners. Today it holds one thing: the **Capstone test kit**.

## The Capstone test kit

In the Capstone you build a grocery shop's backend. Every learner's API follows the same contract (the routes, the request and response shapes, the status codes and the error codes) for the capabilities they chose as Product Owner. The kit is a set of tests that call your API and check that contract.

- It runs in **your own GitHub pipeline**, on GitHub's free minutes, against **your own backend** started inside the job.
- It runs the **core** tests plus the tests for **the add-ons you chose**. Nothing else.
- It only calls your API over HTTP. It needs no browser and never touches your database.
- Gurukul only **reads the result** from GitHub, and your Capstone page shows "Test kit: passed on commit abc1234". Your code never runs anywhere but GitHub and your own machine.

## Add it to your repository in 3 steps

1. **Let your backend take its key from the environment.** When it starts, it must accept the shop key in `SHOP_KEY` (sent as the `X-Shop-Key` header) and the staff code in `SHOP_STAFF_CODE` (for `POST /staff/sessions`). Seeding them into your database at start-up is enough. The workflow makes a fresh pair for every run, so there are no secrets to set.
2. **Copy the workflow.** Copy [`examples/learner-workflow.yml`](examples/learner-workflow.yml) to `.github/workflows/gurukul-capstone-kit.yml` in your repository. Keep that file name: it is the one Gurukul reads.
3. **Fill in your details.** Put your add-ons in `capabilities` (your Capstone page shows the exact line to copy), and tell it how to start your API (`start-command`), where it answers (`wait-on-url`, `shop-base-url`) and anything it needs first, such as a database container (`setup-command`). Push to `main`.

Your repository must be **public** so that Gurukul can read the result.

## How it picks the tests

Every test is tagged: `@core` for the locked core, and `@<add-on>` for each add-on, such as `@discount-codes`. The kit runs `@core` and the tags of the add-ons you list in `capabilities`. A key it does not know is an error, so a typo never quietly skips tests. One test per chosen add-on checks that its routes are switched on. Add-ons you did not choose are not tested at all.

## Run it on your own machine

Start your API, then:

```bash
cd capstone-kit
npm ci
SHOP_BASE_URL=http://localhost:5000/api \
SHOP_KEY=gkshop_your_test_key \
SHOP_STAFF_CODE=YOURSTAFFCODE \
CAPABILITIES=discount-codes,click-and-collect \
npx playwright test
```

On Windows PowerShell, set each one first: `$env:SHOP_BASE_URL='http://localhost:5000/api'`, and so on.

`npx playwright test --list` shows which tests your capabilities select. `npx playwright show-report` opens the report after a run.

You can also point the kit at Gurukul's own shop server with the key and staff code from your "Connect your shop" page. It is how the kit itself is checked. Each full run adds about 60 products and 40 orders to your shop there, and a shop holds at most 500 products and 200 orders a day, so use it sparingly. In your own pipeline the database starts empty every run.

## What "passed" means

- Every selected test passed against your API, and the run's exit code was 0.
- The job summary says `Gurukul capstone kit: <passed>/<total> passed on <commit>`, with a line per capability, and the HTML report is kept as the run's artifact `gurukul-capstone-kit-report`.
- Gurukul reads the newest finished run of `gurukul-capstone-kit.yml` on your default branch, from a push or a manual run (pull requests do not count). Only GitHub's `success` counts as passed. A cancelled run is ignored.

It checks the contract, not your design. How you build the API (architecture, database, layers, extra routes of your own that do not clash) is yours.

## What your backend needs for the kit

Besides the contract's routes for your capabilities:

- the contract's test routes: `GET /dev/outbox` (receipts and sign-in codes, newest first) and `POST /dev/deliveries/{deliveryId}/advance` and `/fail`;
- a payment page at the order's `paymentUrl` that takes a form post of `result=paid|failed` (and an optional `returnUrl`);
- errors as problem details (`application/problem+json`) with the contract's `code`;
- CORS that lets a front end on `http://localhost:<port>` call it.

If your API limits its rate, the kit waits and tries again (it reads `Retry-After`). That makes it slower, but never makes it fail.

## License

[MIT](LICENSE).
