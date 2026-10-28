import { test, expect, expectProblem, uid } from '../../src/shop';

// Opening stock import (`opening-stock-import`): a CSV, row by row.

const HEADER = 'sku,name,category,priceMinor,quantity,reorderLevel';

test.describe('Opening stock import', { tag: ['@core', '@opening-stock-import'] }, () => {
  test('I-01 each row is created or rejected on its own; categories are made by name', async ({ shop, staff }) => {
    const t = uid();
    const csv = [
      HEADER,
      `KIT-${t}-A,Kit bananas ${t},Kit fruit ${t},30,40,5`,
      `"KIT-${t}-B","Kit milk, whole ${t}",Kit dairy ${t},129,12,3`,
      `KIT ${t} BAD,Broken row,Kit fruit ${t},1,1,1`,
    ].join('\n');
    const res = await shop.post('/stock/import', undefined, { token: staff, raw: { contentType: 'text/csv', data: csv } });
    expect(res.status, res.text).toBe(200);
    expect(res.body.created).toBe(2);
    expect(res.body.updated).toBe(0);
    expect(res.body.rejected).toEqual([expect.objectContaining({ row: 4, reason: expect.any(String) })]);

    const milk = await shop.get(`/products?search=${encodeURIComponent(`KIT-${t}-B`)}`);
    expect(milk.body.items[0]).toEqual(expect.objectContaining({ name: `Kit milk, whole ${t}`, priceMinor: 129, stockOnHand: 12, reorderLevel: 3 }));

    const categories = (await shop.get('/categories')).body as any[];
    expect(categories.map((c) => c.name)).toEqual(expect.arrayContaining([`Kit fruit ${t}`, `Kit dairy ${t}`]));
  });

  test('I-02 importing again sets stock on hand through one import movement, and none when it does not change', async ({ shop, staff }) => {
    const t = uid();
    const sku = `KIT-${t}`;
    const first = await shop.post('/stock/import', undefined, {
      token: staff,
      raw: { contentType: 'text/csv', data: `${HEADER}\n${sku},Kit oats ${t},Kit dry ${t},250,10,2\n` },
    });
    expect(first.status, first.text).toBe(200);
    const id = (await shop.get(`/products?search=${sku}`)).body.items[0].id;

    const again = await shop.post('/stock/import', undefined, {
      token: staff,
      raw: { contentType: 'text/csv', data: `${HEADER}\n${sku},Kit oats ${t},Kit dry ${t},250,6,2\n` },
    });
    expect(again.status, again.text).toBe(200);
    expect(again.body).toEqual(expect.objectContaining({ created: 0, updated: 1, rejected: [] }));
    expect((await shop.product(id)).stockOnHand).toBe(6);

    const movements = await shop.get(`/stock/movements?productId=${id}`, { token: staff });
    expect(movements.body.items[0]).toEqual(expect.objectContaining({ kind: 'import', quantityChange: -4, stockOnHandAfter: 6 }));
    const count = movements.body.total;

    await shop.post('/stock/import', undefined, {
      token: staff,
      raw: { contentType: 'text/csv', data: `${HEADER}\n${sku},Kit oats ${t},Kit dry ${t},250,6,2\n` },
    });
    expect((await shop.get(`/stock/movements?productId=${id}`, { token: staff })).body.total, 'no movement when nothing changed').toBe(count);
  });

  test('I-03 a file of the wrong shape is refused as a whole', async ({ shop, staff }) => {
    expectProblem(
      await shop.post('/stock/import', undefined, { token: staff, raw: { contentType: 'text/csv', data: 'name,price\nApples,1\n' } }),
      400,
      'import.invalid',
    );
    // Over 256 KB in fewer than 1,000 rows, so only the size is wrong.
    const big = `${HEADER}\n` + `KIT-BIG,${'x'.repeat(600)},Kit,1,1,1\n`.repeat(500);
    expectProblem(await shop.post('/stock/import', undefined, { token: staff, raw: { contentType: 'text/csv', data: big } }), 413, 'import.too_large');
    expectProblem(
      await shop.post('/stock/import', undefined, { raw: { contentType: 'text/csv', data: `${HEADER}\n` } }),
      401,
      'staff.required',
    );
  });
});
