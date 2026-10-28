import { test, expect, expectProblem } from '../../src/shop';

// Stock (`stock`): goods-in, adjustments with a reason, the movement history,
// and stock on hand that never goes below zero.

test.describe('Stock', { tag: ['@core', '@stock'] }, () => {
  test('ST-01 goods-in puts stock on the shelf and writes one movement', async ({ shop, staff }) => {
    const p = await shop.newProduct(staff);
    const goodsIn = await shop.post('/stock/goods-in', { productId: p.id, quantity: 7, reference: 'DN-1' }, { token: staff });
    expect(goodsIn.status, goodsIn.text).toBe(201);
    expect(goodsIn.body).toEqual(
      expect.objectContaining({ id: expect.anything(), productId: p.id, kind: 'goods-in', quantityChange: 7, stockOnHandAfter: 7, reference: 'DN-1' }),
    );
    expect(typeof goodsIn.body.createdAtUtc).toBe('string');

    const read = await shop.product(p.id);
    expect(read.stockOnHand).toBe(7);
    expect(read.stockAvailable).toBe(7);

    expectProblem(await shop.post('/stock/goods-in', { productId: p.id, quantity: 0 }, { token: staff }), 400, 'validation.failed');
    expectProblem(await shop.post('/stock/goods-in', { productId: p.id, quantity: 10_001 }, { token: staff }), 400, 'validation.failed');
    expectProblem(await shop.post('/stock/goods-in', { productId: 987654321, quantity: 1 }, { token: staff }), 404, 'product.not_found');
  });

  test('ST-02 an adjustment needs a reason and never takes stock below zero', async ({ shop, staff }) => {
    const p = await shop.newProduct(staff, { stock: 5 });

    const damaged = await shop.post('/stock/adjustments', { productId: p.id, quantityChange: -2, reason: 'damaged', note: 'dropped' }, { token: staff });
    expect(damaged.status, damaged.text).toBe(201);
    expect(damaged.body).toEqual(expect.objectContaining({ kind: 'adjustment', quantityChange: -2, stockOnHandAfter: 3, reason: 'damaged' }));

    const count = await shop.post('/stock/adjustments', { productId: p.id, quantityChange: 1, reason: 'count-correction' }, { token: staff });
    expect(count.status, count.text).toBe(201);
    expect(count.body.stockOnHandAfter).toBe(4);

    expectProblem(await shop.post('/stock/adjustments', { productId: p.id, quantityChange: -5, reason: 'expired' }, { token: staff }), 409, 'stock.negative');
    expect((await shop.product(p.id)).stockOnHand, 'nothing changed').toBe(4);

    expectProblem(await shop.post('/stock/adjustments', { productId: p.id, quantityChange: 0, reason: 'damaged' }, { token: staff }), 400, 'validation.failed');
    expectProblem(await shop.post('/stock/adjustments', { productId: p.id, quantityChange: -1, reason: 'stolen' }, { token: staff }), 400, 'validation.failed');
  });

  test('ST-03 an adjustment cannot take stock below what unpaid orders reserved', async ({ shop, staff }) => {
    const p = await shop.newProduct(staff, { stock: 3 });
    await shop.order(p.id, 2, { pay: false });
    expect((await shop.product(p.id)).stockAvailable).toBe(1);
    expectProblem(await shop.post('/stock/adjustments', { productId: p.id, quantityChange: -2, reason: 'damaged' }, { token: staff }), 409, 'stock.reserved');
    expect((await shop.product(p.id)).stockOnHand).toBe(3);
  });

  test('ST-04 the movement history is newest first, 50 a page, staff only', async ({ shop, staff }) => {
    const p = await shop.newProduct(staff, { stock: 10 });
    await shop.post('/stock/adjustments', { productId: p.id, quantityChange: -1, reason: 'expired' }, { token: staff });

    const history = await shop.get(`/stock/movements?productId=${p.id}&page=1`, { token: staff });
    expect(history.status, history.text).toBe(200);
    expect(history.body).toEqual(expect.objectContaining({ page: 1, pageSize: 50, total: 2 }));
    expect(history.body.items.map((m: any) => m.kind)).toEqual(['adjustment', 'goods-in']);
    expect(history.body.items[0].stockOnHandAfter).toBe(9);

    expectProblem(await shop.get(`/stock/movements?productId=${p.id}`), 401, 'staff.required');
  });
});
