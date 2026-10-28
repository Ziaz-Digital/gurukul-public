import { test, expect, expectProblem } from '../../src/shop';

// Payment (`payment`, the simulated hosted page) and the order number and
// receipt (`order-receipt`).

const RETURN_URL = 'http://localhost:5173/order/done';

test.describe('Payment', { tag: ['@core', '@payment'] }, () => {
  test('P-01 paying sells the reserved stock and sends you back to your page', async ({ shop, staff }) => {
    const p = await shop.newProduct(staff, { stock: 6 });
    const { order } = await shop.order(p.id, 4, { pay: false });

    const page = await shop.pay(order.paymentUrl!, 'paid', RETURN_URL).catch(() => null);
    expect(page, 'the payment page answers').not.toBeNull();
    expect(page!.status, page!.text).toBe(303);
    expect(page!.headers['location']).toBe(`${RETURN_URL}?orderNumber=${order.orderNumber}&result=paid`);

    const read = await shop.get(`/orders/${order.orderNumber}`);
    expect(read.status, read.text).toBe(200);
    expect(read.body.status).toBe('paid');
    expect(read.body.paymentUrl, 'no payment link once paid').toBeUndefined();

    const after = await shop.product(p.id);
    expect(after.stockOnHand).toBe(2);
    expect(after.stockAvailable).toBe(2);

    const movements = await shop.get(`/stock/movements?productId=${p.id}`, { token: staff });
    expect(movements.body.items[0]).toEqual(expect.objectContaining({ kind: 'sale', quantityChange: -4, stockOnHandAfter: 2 }));

    const again = await shop.pay(order.paymentUrl!, 'paid');
    expect(again.status, 'a payment link works once').toBe(409);
  });

  test('P-02 the payment page itself has Pay (test) and Decline (test)', async ({ shop, staff, request }) => {
    const p = await shop.newProduct(staff, { stock: 2 });
    const { order } = await shop.order(p.id, 1, { pay: false });
    const page = await request.get(`${order.paymentUrl}?returnUrl=${encodeURIComponent(RETURN_URL)}`, { ignoreHTTPSErrors: true });
    expect(page.status()).toBe(200);
    const html = await page.text();
    expect(html).toContain('Pay (test)');
    expect(html).toContain('Decline (test)');
  });

  test('P-03 declining fails the order and lets the reservation go', async ({ shop, staff }) => {
    const p = await shop.newProduct(staff, { stock: 3 });
    const { order } = await shop.order(p.id, 2, { pay: false });
    expect((await shop.product(p.id)).stockAvailable).toBe(1);

    const declined = await shop.pay(order.paymentUrl!, 'failed', RETURN_URL);
    expect(declined.status).toBe(303);
    expect(declined.headers['location']).toBe(`${RETURN_URL}?orderNumber=${order.orderNumber}&result=failed`);

    expect((await shop.get(`/orders/${order.orderNumber}`)).body.status).toBe('payment-failed');
    const after = await shop.product(p.id);
    expect(after.stockOnHand).toBe(3);
    expect(after.stockAvailable).toBe(3);
    const movements = await shop.get(`/stock/movements?productId=${p.id}`, { token: staff });
    expect(movements.body.items[0]).toEqual(expect.objectContaining({ kind: 'release', quantityChange: 2, stockOnHandAfter: 3 }));
  });

  test('P-04 a returnUrl that is not your local page is ignored', async ({ shop, staff }) => {
    const p = await shop.newProduct(staff, { stock: 1 });
    const { order } = await shop.order(p.id, 1, { pay: false });
    const paid = await shop.pay(order.paymentUrl!, 'paid', 'https://evil.example/steal');
    expect(paid.status).toBeLessThan(400);
    expect(paid.headers['location'] ?? '').not.toContain('evil.example');
    expect((await shop.get(`/orders/${order.orderNumber}`)).body.status).toBe('paid');
  });
});

test.describe('Order number and receipt', { tag: ['@core', '@order-receipt'] }, () => {
  test('R-01 the order reads back by its number; an unknown number is 404', async ({ shop, staff }) => {
    const p = await shop.newProduct(staff, { stock: 2 });
    const { order } = await shop.order(p.id, 1, { pay: false });
    const read = await shop.get(`/orders/${order.orderNumber}`);
    expect(read.status, read.text).toBe(200);
    expect(read.body).toEqual(
      expect.objectContaining({ orderNumber: order.orderNumber, status: 'awaiting-payment', totalMinor: order.totalMinor, lines: expect.any(Array) }),
    );
    expect(typeof read.body.paymentUrl).toBe('string');
    expectProblem(await shop.get('/orders/GS-ZZZZZZZZZZ'), 404, 'order.not_found');
  });

  test('R-02 payment writes a receipt with the order number and every line to the outbox', async ({ shop, staff }) => {
    const a = await shop.newProduct(staff, { stock: 5 });
    const b = await shop.newProduct(staff, { stock: 5 });
    const basketId = await shop.newBasket([[a.id, 2], [b.id, 1]]);
    const body = shop.orderBody(basketId, await shop.slot());
    const placed = await shop.placeOrder(body);
    expect(placed.status, placed.text).toBe(201);
    expect((await shop.pay(placed.body.paymentUrl, 'paid')).status).toBeLessThan(400);

    const outbox = await shop.get('/dev/outbox');
    expect(outbox.status, outbox.text).toBe(200);
    const receipt = (outbox.body as any[]).find((m) => m.orderNumber === placed.body.orderNumber);
    expect(receipt, 'a receipt for the order').toBeTruthy();
    expect(receipt.to).toBe(body.customer.email);
    expect(receipt.subject).toContain(placed.body.orderNumber);
    expect(receipt.bodyText).toContain(placed.body.orderNumber);
    expect(receipt.bodyText).toContain(a.name);
    expect(receipt.bodyText).toContain(b.name);
  });
});
