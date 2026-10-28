import { randomUUID } from 'node:crypto';
import { test, expect, expectProblem, ORDER_NUMBER, Slot } from '../../src/shop';

// Basket and checkout (`checkout-reservation`): an idempotent place-order that
// reserves stock and never oversells.

test.describe('Basket and checkout', { tag: ['@core', '@checkout-reservation'] }, () => {
  test('CH-01 a basket holds lines and totals them', async ({ shop, staff }) => {
    const a = await shop.newProduct(staff, { priceMinor: 120, stock: 10 });
    const b = await shop.newProduct(staff, { priceMinor: 35, stock: 10 });

    const basket = await shop.post('/baskets');
    expect(basket.status, basket.text).toBe(201);
    const id = basket.body.basketId;
    expect(typeof id === 'string' || typeof id === 'number').toBe(true);

    await shop.put(`/baskets/${id}/lines/${a.id}`, { quantity: 2 });
    const two = await shop.put(`/baskets/${id}/lines/${b.id}`, { quantity: 3 });
    expect(two.status, two.text).toBe(200);
    expect(two.body.totalMinor).toBe(2 * 120 + 3 * 35);
    expect(two.body.lines).toEqual(
      expect.arrayContaining([expect.objectContaining({ productId: a.id, name: a.name, priceMinor: 120, quantity: 2, lineTotalMinor: 240 })]),
    );
    expect(two.body.currency).toMatch(/^[A-Z]{3}$/);

    const changed = await shop.put(`/baskets/${id}/lines/${a.id}`, { quantity: 1 });
    expect(changed.body.totalMinor).toBe(120 + 105);

    const removed = await shop.delete(`/baskets/${id}/lines/${a.id}`);
    expect(removed.status, removed.text).toBe(200);
    expect(removed.body.lines.map((l: any) => l.productId)).toEqual([b.id]);

    const read = await shop.get(`/baskets/${id}`);
    expect(read.status).toBe(200);
    expect(read.body.totalMinor).toBe(105);

    expectProblem(await shop.put(`/baskets/${id}/lines/${b.id}`, { quantity: 0 }), 400, 'validation.failed');
    expectProblem(await shop.put(`/baskets/${id}/lines/${b.id}`, { quantity: 100 }), 400, 'validation.failed');
    expect((await shop.get(`/baskets/${randomUUID()}`)).body?.code).toBe('basket.not_found');
  });

  test('CH-02 delivery slots: seven days of 2-hour slots, 08:00–20:00', async ({ shop }) => {
    const slots = await shop.get('/delivery-slots');
    expect(slots.status, slots.text).toBe(200);
    const list = slots.body as Slot[];
    expect(list.length).toBe(42);
    for (const s of list) {
      expect(s.slotId).toMatch(/^\d{8}-(08|10|12|14|16|18)$/);
      expect(new Date(s.endsAtUtc).getTime() - new Date(s.startsAtUtc).getTime()).toBe(2 * 3600_000);
      expect(typeof s.isAvailable).toBe('boolean');
      if (new Date(s.startsAtUtc).getTime() <= Date.now()) expect(s.isAvailable, `${s.slotId} has started`).toBe(false);
    }
    expect(new Set(list.map((s) => s.slotId)).size).toBe(42);
  });

  test('CH-03 placing an order needs an Idempotency-Key that is a GUID', async ({ shop, staff }) => {
    const p = await shop.newProduct(staff, { stock: 5 });
    const body = shop.orderBody(await shop.newBasket([[p.id, 1]]), await shop.slot());
    expectProblem(await shop.post('/orders', body), 400, 'idempotency.key_required');
    expectProblem(await shop.post('/orders', body, { headers: { 'Idempotency-Key': 'not-a-guid' } }), 400, 'idempotency.key_required');
    expect((await shop.product(p.id)).stockAvailable, 'nothing reserved').toBe(5);
  });

  test('CH-04 an order reserves its stock, and the same key returns the same order', async ({ shop, staff }) => {
    const p = await shop.newProduct(staff, { priceMinor: 50, stock: 5 });
    const body = shop.orderBody(await shop.newBasket([[p.id, 4]]), await shop.slot());
    const key = randomUUID();

    const placed = await shop.placeOrder(body, { idempotencyKey: key });
    expect(placed.status, placed.text).toBe(201);
    const order = placed.body;
    expect(order.orderNumber).toMatch(ORDER_NUMBER);
    expect(order.status).toBe('awaiting-payment');
    expect(typeof order.paymentUrl).toBe('string');
    expect(order.lines).toEqual([expect.objectContaining({ productId: p.id, quantity: 4, priceMinor: 50, lineTotalMinor: 200 })]);
    expect(order.totalMinor).toBe(200 + (order.deliveryFeeMinor ?? 0) - (order.discountMinor ?? 0));
    expect(order.slot.slotId).toBe(body.slotId);

    const after = await shop.product(p.id);
    expect(after.stockOnHand, 'on hand is unchanged until payment').toBe(5);
    expect(after.stockAvailable, 'reserved').toBe(1);

    const replay = await shop.placeOrder(body, { idempotencyKey: key });
    expect(replay.status, replay.text).toBe(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body.orderNumber).toBe(order.orderNumber);
    expect((await shop.product(p.id)).stockAvailable, 'reserved once, not twice').toBe(1);
  });

  test('CH-05 an order for more than is available → 409 stock.insufficient, nothing reserved', async ({ shop, staff }) => {
    const p = await shop.newProduct(staff, { stock: 2 });
    const plenty = await shop.newProduct(staff, { stock: 10 });
    const body = shop.orderBody(await shop.newBasket([[plenty.id, 1], [p.id, 3]]), await shop.slot());
    const short = await shop.placeOrder(body);
    expectProblem(short, 409, 'stock.insufficient');
    expect(short.body.productId).toBe(p.id);
    expect((await shop.product(p.id)).stockAvailable).toBe(2);
    expect((await shop.product(plenty.id)).stockAvailable, 'no line is reserved').toBe(10);
  });

  test('CH-06 an order without the buyer and address details → 400 validation.failed', async ({ shop, staff }) => {
    const p = await shop.newProduct(staff, { stock: 3 });
    const body = shop.orderBody(await shop.newBasket([[p.id, 1]]), await shop.slot());
    const noEmail = await shop.placeOrder({ ...body, customer: { name: 'Kit Buyer' } });
    expectProblem(noEmail, 400, 'validation.failed');
    expect(Array.isArray(noEmail.body.errors)).toBe(true);
    expectProblem(await shop.placeOrder({ ...body, slotId: '19990101-08' }), 400, 'validation.failed');
    expect((await shop.product(p.id)).stockAvailable).toBe(3);
  });
});
