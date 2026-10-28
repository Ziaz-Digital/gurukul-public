import { test, expect, expectProblem, uid, POSTCODE, Slot } from '../../src/shop';

// The add-ons that change an order: cancel-before-packing, discount-codes,
// delivery-fees-cutoffs, click-and-collect and substitutions.

const inAWeek = () => new Date(Date.now() + 7 * 86400_000).toISOString();

test.describe('Cancel before packing', { tag: ['@cancel-before-packing'] }, () => {
  test('CB-01 an unpaid order is cancelled and its reservation let go', async ({ shop, staff }) => {
    const p = await shop.newProduct(staff, { stock: 4 });
    const { order } = await shop.order(p.id, 3, { pay: false });
    expect((await shop.product(p.id)).stockAvailable).toBe(1);

    expectProblem(await shop.post(`/orders/${order.orderNumber}/cancel`, { postcode: '9999 ZZ' }), 404, 'order.not_found');
    expectProblem(await shop.post('/orders/GS-ZZZZZZZZZZ/cancel', { postcode: POSTCODE }), 404, 'order.not_found');

    const cancelled = await shop.post(`/orders/${order.orderNumber}/cancel`, { postcode: POSTCODE });
    expect(cancelled.status, cancelled.text).toBe(200);
    expect(cancelled.body.status).toBe('cancelled');
    const after = await shop.product(p.id);
    expect(after.stockAvailable).toBe(4);
    expect(after.stockOnHand).toBe(4);
    expect((await shop.pay(order.paymentUrl!, 'paid')).status, 'a cancelled order cannot be paid').toBe(409);
  });

  test('CB-02 a paid order is cancelled and its stock goes back on the shelf', async ({ shop, staff }) => {
    const p = await shop.newProduct(staff, { stock: 5 });
    const { order } = await shop.order(p.id, 2);
    expect((await shop.product(p.id)).stockOnHand).toBe(3);

    const cancelled = await shop.post(`/orders/${order.orderNumber}/cancel`, { postcode: POSTCODE });
    expect(cancelled.status, cancelled.text).toBe(200);
    expect(cancelled.body.status).toBe('cancelled');
    expect((await shop.product(p.id)).stockOnHand).toBe(5);
    const movements = await shop.get(`/stock/movements?productId=${p.id}`, { token: staff });
    expect(movements.body.items[0]).toEqual(expect.objectContaining({ kind: 'return', quantityChange: 2, stockOnHandAfter: 5 }));

    expectProblem(await shop.post(`/orders/${order.orderNumber}/cancel`, { postcode: POSTCODE }), 409, 'order.status');
  });

  test('CB-03 a packed order can no longer be cancelled', async ({ shop, staff }) => {
    const p = await shop.newProduct(staff, { stock: 2 });
    const { order } = await shop.order(p.id, 1);
    expect((await shop.post(`/staff/orders/${order.orderNumber}/packed`, {}, { token: staff })).status).toBe(200);
    expectProblem(await shop.post(`/orders/${order.orderNumber}/cancel`, { postcode: POSTCODE }), 409, 'order.status');
  });
});

test.describe('Discount codes', { tag: ['@discount-codes'] }, () => {
  test('DC-01 staff keep codes: upper case, unique, deletable', async ({ shop, staff }) => {
    const code = `kit-${uid().slice(0, 8)}`;
    const created = await shop.post('/staff/discount-codes', { code, kind: 'percent', value: 10, endsAtUtc: inAWeek() }, { token: staff });
    expect(created.status, created.text).toBe(201);
    expect(created.body).toEqual(expect.objectContaining({ id: expect.anything(), code: code.toUpperCase(), kind: 'percent', value: 10 }));

    expectProblem(
      await shop.post('/staff/discount-codes', { code: code.toUpperCase(), kind: 'amount', value: 5, endsAtUtc: inAWeek() }, { token: staff }),
      409,
      'discount.code_taken',
    );
    expectProblem(await shop.post('/staff/discount-codes', { code: 'no spaces!', kind: 'percent', value: 10, endsAtUtc: inAWeek() }, { token: staff }), 400, 'validation.failed');
    expectProblem(await shop.post('/staff/discount-codes', { code: `K${uid().slice(0, 6)}`, kind: 'percent', value: 101, endsAtUtc: inAWeek() }, { token: staff }), 400, 'validation.failed');
    expectProblem(
      await shop.post('/staff/discount-codes', { code: `K${uid().slice(0, 6)}`, kind: 'percent', value: 5, endsAtUtc: new Date(Date.now() - 3600_000).toISOString() }, { token: staff }),
      400,
      'validation.failed',
    );

    const list = await shop.get('/staff/discount-codes', { token: staff });
    expect((list.body as any[]).map((d) => d.id)).toContain(created.body.id);
    expect((await shop.delete(`/staff/discount-codes/${created.body.id}`, { token: staff })).status).toBe(204);
    expectProblem(await shop.delete(`/staff/discount-codes/${created.body.id}`, { token: staff }), 404, 'discount.not_found');
  });

  test('DC-02 checkout takes one code: percent rounds down, an amount never goes below zero', async ({ shop, staff }) => {
    const percent = `KIT${uid().slice(0, 8)}`;
    const amount = `KIT${uid().slice(0, 8)}`;
    await shop.post('/staff/discount-codes', { code: percent, kind: 'percent', value: 15, endsAtUtc: inAWeek() }, { token: staff });
    await shop.post('/staff/discount-codes', { code: amount, kind: 'amount', value: 1_000_000, endsAtUtc: inAWeek() }, { token: staff });
    const p = await shop.newProduct(staff, { priceMinor: 333, stock: 10 });

    const unknown = await shop.placeOrder(shop.orderBody(await shop.newBasket([[p.id, 1]]), await shop.slot(), { discountCode: 'NOPE-NOPE' }));
    expectProblem(unknown, 400, 'discount.invalid');
    expect((await shop.product(p.id)).stockAvailable, 'nothing reserved').toBe(10);

    const withPercent = await shop.placeOrder(
      shop.orderBody(await shop.newBasket([[p.id, 1]]), await shop.slot(), { discountCode: percent.toLowerCase() }),
    );
    expect(withPercent.status, withPercent.text).toBe(201);
    expect(withPercent.body).toEqual(expect.objectContaining({ subtotalMinor: 333, discountCode: percent, discountMinor: 49 }));
    expect(withPercent.body.totalMinor).toBe(333 - 49 + (withPercent.body.deliveryFeeMinor ?? 0));

    const withAmount = await shop.placeOrder(shop.orderBody(await shop.newBasket([[p.id, 2]]), await shop.slot(), { discountCode: amount }));
    expect(withAmount.status, withAmount.text).toBe(201);
    expect(withAmount.body.discountMinor, 'capped at the goods').toBe(666);
    expect(withAmount.body.totalMinor).toBe(withAmount.body.deliveryFeeMinor ?? 0);
  });
});

test.describe('Delivery fees and cut-off times', { tag: ['@delivery-fees-cutoffs'] }, () => {
  const none = { feeBands: [], slotCutoffMinutes: 0 };

  test('DF-01 the fee comes from the highest band at or below the basket', async ({ shop, staff }) => {
    try {
      const rules = { feeBands: [{ minBasketMinor: 0, feeMinor: 499 }, { minBasketMinor: 1000, feeMinor: 199 }, { minBasketMinor: 5000, feeMinor: 0 }], slotCutoffMinutes: 0 };
      const put = await shop.put('/staff/delivery-rules', rules, { token: staff });
      expect(put.status, put.text).toBe(200);
      const read = await shop.get('/delivery-rules');
      expect(read.status).toBe(200);
      expect(read.body.feeBands).toEqual(expect.arrayContaining(rules.feeBands));
      expect(read.body.slotCutoffMinutes).toBe(0);

      const p = await shop.newProduct(staff, { priceMinor: 500, stock: 30 });
      for (const [qty, fee] of [[1, 499], [2, 199], [10, 0]] as const) {
        const placed = await shop.placeOrder(shop.orderBody(await shop.newBasket([[p.id, qty]]), await shop.slot()));
        expect(placed.status, placed.text).toBe(201);
        expect(placed.body.subtotalMinor).toBe(500 * qty);
        expect(placed.body.deliveryFeeMinor, `${qty} × 500`).toBe(fee);
        expect(placed.body.totalMinor).toBe(500 * qty + fee - (placed.body.discountMinor ?? 0));
      }

      const tooMany = { feeBands: [0, 1, 2, 3, 4, 5].map((i) => ({ minBasketMinor: i * 100, feeMinor: 1 })), slotCutoffMinutes: 0 };
      expectProblem(await shop.put('/staff/delivery-rules', tooMany, { token: staff }), 400, 'validation.failed');
    } finally {
      await shop.put('/staff/delivery-rules', none, { token: staff });
    }
  });

  test('DF-02 a slot inside the cut-off cannot be booked', async ({ shop, staff }) => {
    try {
      expect((await shop.put('/staff/delivery-rules', { feeBands: [], slotCutoffMinutes: 1440 }, { token: staff })).status).toBe(200);
      const slots = (await shop.get('/delivery-slots')).body as Slot[];
      expect(slots.length).toBe(42);
      const soon = slots.filter((s) => new Date(s.startsAtUtc).getTime() < Date.now() + 1440 * 60_000);
      expect(soon.every((s) => !s.isAvailable), 'every slot inside 24 hours is unavailable').toBe(true);

      const p = await shop.newProduct(staff, { stock: 2 });
      const notStarted = soon.filter((s) => new Date(s.startsAtUtc).getTime() > Date.now() + 60_000);
      expect(notStarted.length, 'a slot that has not started but is inside the cut-off').toBeGreaterThan(0);
      const refused = await shop.placeOrder(shop.orderBody(await shop.newBasket([[p.id, 1]]), notStarted[0].slotId));
      expectProblem(refused, 400, 'validation.failed');
      expect((refused.body.errors as any[]).map((e) => e.field)).toContain('slotId');
    } finally {
      await shop.put('/staff/delivery-rules', none, { token: staff });
    }
  });
});

test.describe('Click and collect', { tag: ['@click-and-collect'] }, () => {
  test('CC-01 a collection order needs no address, pays no fee, and is collected, not couriered', async ({ shop, staff }) => {
    const p = await shop.newProduct(staff, { stock: 3 });
    const email = `collect.${uid().toLowerCase()}@example.com`;
    const placed = await shop.placeOrder({
      basketId: await shop.newBasket([[p.id, 1]]),
      customer: { name: 'Kit Collector', email },
      fulfilment: 'collection',
      slotId: await shop.slot(),
    });
    expect(placed.status, placed.text).toBe(201);
    expect(placed.body.fulfilment).toBe('collection');
    expect(placed.body.deliveryFeeMinor ?? 0).toBe(0);

    const tracked = await shop.get(`/track?orderNumber=${placed.body.orderNumber}&email=${encodeURIComponent(email)}`);
    expect(tracked.status, tracked.text).toBe(200);
    expect(tracked.body.status).toBe('awaiting-payment');

    expectProblem(await shop.post(`/staff/orders/${placed.body.orderNumber}/collected`, {}, { token: staff }), 409, 'order.status');
    expect((await shop.pay(placed.body.paymentUrl, 'paid')).status).toBeLessThan(400);

    const list = await shop.get('/staff/orders', { token: staff });
    const onList = (list.body as any[]).find((o) => o.orderNumber === placed.body.orderNumber);
    expect(onList.fulfilment).toBe('collection');

    expect((await shop.post(`/staff/orders/${placed.body.orderNumber}/packed`, {}, { token: staff })).status).toBe(200);
    expectProblem(await shop.post(`/staff/orders/${placed.body.orderNumber}/delivery`, {}, { token: staff }), 409, 'order.status');
    const collected = await shop.post(`/staff/orders/${placed.body.orderNumber}/collected`, {}, { token: staff });
    expect(collected.status, collected.text).toBe(200);
    expect(collected.body).toEqual(expect.objectContaining({ orderNumber: placed.body.orderNumber, status: 'collected' }));
  });

  test('CC-02 a delivery order is not collected', async ({ shop, staff }) => {
    const p = await shop.newProduct(staff, { stock: 2 });
    const { order } = await shop.order(p.id, 1);
    expect(order.fulfilment, 'delivery orders leave the field out').toBeUndefined();
    await shop.post(`/staff/orders/${order.orderNumber}/packed`, {}, { token: staff });
    expectProblem(await shop.post(`/staff/orders/${order.orderNumber}/collected`, {}, { token: staff }), 409, 'order.status');
  });
});

test.describe('Substitutions', { tag: ['@substitutions'] }, () => {
  test('SB-01 a line names its substitute; the order and the pick list carry it', async ({ shop, staff }) => {
    const p = await shop.newProduct(staff, { stock: 3 });
    const sub = await shop.newProduct(staff, { stock: 3 });
    const basketId = await shop.newBasket([[p.id, 1]]);

    const set = await shop.put(`/baskets/${basketId}/lines/${p.id}/substitute`, { substituteProductId: sub.id });
    expect(set.status, set.text).toBe(200);
    expect(set.body.lines[0]).toEqual(expect.objectContaining({ productId: p.id, substituteProductId: sub.id, substituteName: sub.name }));

    expectProblem(await shop.put(`/baskets/${basketId}/lines/${p.id}/substitute`, { substituteProductId: p.id }), 400, 'validation.failed');
    expectProblem(await shop.put(`/baskets/${basketId}/lines/${p.id}/substitute`, { substituteProductId: 987654321 }), 404, 'product.not_found');
    expectProblem(await shop.put(`/baskets/${basketId}/lines/${sub.id}/substitute`, { substituteProductId: p.id }), 404, 'product.not_found');

    const placed = await shop.placeOrder(shop.orderBody(basketId, await shop.slot()));
    expect(placed.status, placed.text).toBe(201);
    expect(placed.body.lines[0]).toEqual(expect.objectContaining({ substituteProductId: sub.id, substituteName: sub.name }));
    expect((await shop.pay(placed.body.paymentUrl, 'paid')).status).toBeLessThan(400);

    const list = await shop.get('/staff/orders', { token: staff });
    const onList = (list.body as any[]).find((o) => o.orderNumber === placed.body.orderNumber);
    expect(onList.lines[0].substituteName).toBe(sub.name);
  });

  test('SB-02 a substitute can be taken off again', async ({ shop, staff }) => {
    const p = await shop.newProduct(staff, { stock: 3 });
    const sub = await shop.newProduct(staff, { stock: 3 });
    const basketId = await shop.newBasket([[p.id, 1]]);
    await shop.put(`/baskets/${basketId}/lines/${p.id}/substitute`, { substituteProductId: sub.id });
    const cleared = await shop.delete(`/baskets/${basketId}/lines/${p.id}/substitute`);
    expect(cleared.status, cleared.text).toBe(200);
    expect(cleared.body.lines[0].substituteProductId).toBeUndefined();
  });
});
