import { test, expect, expectProblem, uid, Slot } from '../../src/shop';

// The staff-side add-ons: product-images, sales-stock-report,
// suppliers-purchase-orders and opening-hours.

// A 1×1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

test.describe('Product images', { tag: ['@product-images'] }, () => {
  test('PI-01 a PNG is kept and served safely, and can be deleted', async ({ shop, staff, request }) => {
    const p = await shop.newProduct(staff);
    const put = await shop.put(`/products/${p.id}/image`, undefined, { token: staff, raw: { contentType: 'image/png', data: PNG } });
    expect(put.status, put.text).toBe(200);
    expect(put.body).toEqual(expect.objectContaining({ productId: p.id, contentType: 'image/png', sizeBytes: PNG.length }));

    const get = await request.fetch(shop.url(`/products/${p.id}/image`), { headers: { 'X-Shop-Key': process.env.SHOP_KEY! }, ignoreHTTPSErrors: true });
    expect(get.status()).toBe(200);
    expect(get.headers()['content-type']).toBe('image/png');
    expect(get.headers()['x-content-type-options']).toBe('nosniff');
    expect(Buffer.from(await get.body()).equals(PNG)).toBe(true);

    expect((await shop.product(p.id)).imageUrl).toContain(`/products/${p.id}/image`);

    expect((await shop.delete(`/products/${p.id}/image`, { token: staff })).status).toBe(204);
    expectProblem(await shop.get(`/products/${p.id}/image`), 404, 'image.not_found');
    expect((await shop.product(p.id)).imageUrl, 'no image, no imageUrl').toBeUndefined();
  });

  test('PI-02 the type is decided by the bytes; too big and unknown products are refused', async ({ shop, staff }) => {
    const p = await shop.newProduct(staff);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expectProblem(await shop.put(`/products/${p.id}/image`, undefined, { token: staff, raw: { contentType: 'image/png', data: svg } }), 415, 'image.unsupported');

    const tooBig = Buffer.concat([PNG, Buffer.alloc(600 * 1024)]);
    expectProblem(await shop.put(`/products/${p.id}/image`, undefined, { token: staff, raw: { contentType: 'image/png', data: tooBig } }), 413, 'image.too_large');
    expectProblem(await shop.put('/products/987654321/image', undefined, { token: staff, raw: { contentType: 'image/png', data: PNG } }), 404, 'product.not_found');
    expectProblem(await shop.put(`/products/${p.id}/image`, undefined, { raw: { contentType: 'image/png', data: PNG } }), 401, 'staff.required');
  });
});

test.describe('Sales and stock report', { tag: ['@sales-stock-report'] }, () => {
  test('SR-01 a paid order counts; an unpaid one does not', async ({ shop, staff }) => {
    const before = await shop.get('/staff/reports/sales-stock?days=7', { token: staff });
    expect(before.status, before.text).toBe(200);
    expect(before.body).toEqual(
      expect.objectContaining({
        fromUtc: expect.any(String),
        toUtc: expect.any(String),
        orders: expect.any(Number),
        revenueMinor: expect.any(Number),
        discountsMinor: expect.any(Number),
        stockValueMinor: expect.any(Number),
        bestSellers: expect.any(Array),
        slowMovers: expect.any(Array),
      }),
    );

    const p = await shop.newProduct(staff, { priceMinor: 250, stock: 10 });
    await shop.order(p.id, 3);
    await shop.order(p.id, 1, { pay: false });

    const after = await shop.get('/staff/reports/sales-stock?days=7', { token: staff });
    expect(after.body.orders - before.body.orders).toBe(1);
    expect(after.body.revenueMinor - before.body.revenueMinor).toBe(750);
    expect(after.body.stockValueMinor, 'our product alone is worth 7 × 250').toBeGreaterThanOrEqual(7 * 250);
    for (const line of [...after.body.bestSellers, ...after.body.slowMovers])
      expect(line).toEqual(expect.objectContaining({ productId: expect.anything(), sku: expect.any(String), quantitySold: expect.any(Number) }));

    expectProblem(await shop.get('/staff/reports/sales-stock?days=61', { token: staff }), 400, 'validation.failed');
    expectProblem(await shop.get('/staff/reports/sales-stock'), 401, 'staff.required');
  });
});

test.describe('Suppliers and purchase orders', { tag: ['@suppliers-purchase-orders'] }, () => {
  test('SP-01 suppliers are kept with unique names', async ({ shop, staff }) => {
    const name = `Kit Farms ${uid()}`;
    const created = await shop.post('/staff/suppliers', { name, email: 'orders@kitfarms.example.com' }, { token: staff });
    expect(created.status, created.text).toBe(201);
    expect(created.body).toEqual(expect.objectContaining({ id: expect.anything(), name }));
    expectProblem(await shop.post('/staff/suppliers', { name }, { token: staff }), 409, 'supplier.name_taken');

    const updated = await shop.put(`/staff/suppliers/${created.body.id}`, { name: `${name} Ltd` }, { token: staff });
    expect(updated.status, updated.text).toBe(200);
    expect(updated.body.name).toBe(`${name} Ltd`);
    expect((await shop.get('/staff/suppliers', { token: staff })).body.map((s: any) => s.id)).toContain(created.body.id);
    expectProblem(await shop.put('/staff/suppliers/987654321', { name: `Nobody ${uid()}` }, { token: staff }), 404, 'supplier.not_found');
  });

  test('SP-02 a purchase order raised from the low-stock list tops products up to twice their reorder level', async ({ shop, staff }) => {
    const supplier = await shop.post('/staff/suppliers', { name: `Kit Wholesale ${uid()}` }, { token: staff });
    const low = await shop.newProduct(staff, { reorderLevel: 5, stock: 2 });

    const po = await shop.post('/staff/purchase-orders', { supplierId: supplier.body.id }, { token: staff });
    expect(po.status, po.text).toBe(201);
    expect(po.body).toEqual(expect.objectContaining({ supplierId: supplier.body.id, status: 'open', lines: expect.any(Array) }));
    const line = (po.body.lines as any[]).find((l) => l.productId === low.id);
    expect(line, 'the low product is on it').toBeTruthy();
    expect(line.quantity).toBe(5 * 2 - 2);

    const open = await shop.get('/staff/purchase-orders?status=open', { token: staff });
    expect((open.body as any[]).map((x) => x.id)).toContain(po.body.id);
  });

  test('SP-03 a purchase order is booked in once, as goods-in', async ({ shop, staff }) => {
    const supplier = await shop.post('/staff/suppliers', { name: `Kit Dairy ${uid()}` }, { token: staff });
    const p = await shop.newProduct(staff, { stock: 1 });

    expectProblem(
      await shop.post('/staff/purchase-orders', { supplierId: supplier.body.id, lines: [{ productId: 987654321, quantity: 1 }] }, { token: staff }),
      404,
      'product.not_found',
    );
    const po = await shop.post('/staff/purchase-orders', { supplierId: supplier.body.id, lines: [{ productId: p.id, quantity: 12 }] }, { token: staff });
    expect(po.status, po.text).toBe(201);

    const received = await shop.post(`/staff/purchase-orders/${po.body.id}/receive`, {}, { token: staff });
    expect(received.status, received.text).toBe(200);
    expect(received.body.status).toBe('received');
    expect(typeof received.body.receivedAtUtc).toBe('string');
    expect((await shop.product(p.id)).stockOnHand).toBe(13);
    const movements = await shop.get(`/stock/movements?productId=${p.id}`, { token: staff });
    expect(movements.body.items[0]).toEqual(expect.objectContaining({ kind: 'goods-in', quantityChange: 12, reference: `PO-${po.body.id}` }));

    expectProblem(await shop.post(`/staff/purchase-orders/${po.body.id}/receive`, {}, { token: staff }), 409, 'purchase_order.status');
    expect((await shop.get(`/staff/purchase-orders/${po.body.id}`, { token: staff })).body.status).toBe('received');
    expectProblem(await shop.get('/staff/purchase-orders/987654321', { token: staff }), 404, 'purchase_order.not_found');
  });
});

test.describe('Opening hours and closures', { tag: ['@opening-hours'] }, () => {
  const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const normal = { week: DAYS.map((day) => ({ day, opensAt: '08:00', closesAt: '20:00' })) };

  test('OH-01 a closed day and short hours take slots away', async ({ shop, staff }) => {
    const slots = (await shop.get('/delivery-slots')).body as Slot[];
    const dayKeys = [...new Set(slots.map((s) => s.slotId.slice(0, 8)))];
    const target = dayKeys[3];
    const targetDay = DAYS[(new Date(`${target.slice(0, 4)}-${target.slice(4, 6)}-${target.slice(6, 8)}T12:00:00Z`).getUTCDay() + 6) % 7];
    try {
      const week = DAYS.map((day) => (day === targetDay ? { day, opensAt: '10:00', closesAt: '14:00' } : { day, opensAt: '08:00', closesAt: '20:00' }));
      const put = await shop.put('/staff/opening-hours', { week }, { token: staff });
      expect(put.status, put.text).toBe(200);
      expect(put.body.week.length).toBe(7);
      const read = await shop.get('/opening-hours');
      expect(read.body.week).toEqual(expect.arrayContaining([expect.objectContaining({ day: targetDay, opensAt: '10:00', closesAt: '14:00' })]));

      const after = (await shop.get('/delivery-slots')).body as Slot[];
      const open = after.filter((s) => s.slotId.startsWith(target) && s.isAvailable).map((s) => s.slotId.slice(9));
      expect(open, `${targetDay}: only the slots inside 10:00–14:00`).toEqual(['10', '12']);

      const bad = { week: DAYS.map((day) => ({ day, opensAt: '20:00', closesAt: '08:00' })) };
      expectProblem(await shop.put('/staff/opening-hours', bad, { token: staff }), 400, 'validation.failed');
      expectProblem(await shop.put('/staff/opening-hours', { week: normal.week.slice(0, 6) }, { token: staff }), 400, 'validation.failed');
    } finally {
      await shop.put('/staff/opening-hours', normal, { token: staff });
    }
  });

  test('OH-02 a closure closes the day; an order for it is refused', async ({ shop, staff }) => {
    const slots = (await shop.get('/delivery-slots')).body as Slot[];
    const day = [...new Set(slots.map((s) => s.slotId.slice(0, 8)))][4];
    const date = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
    try {
      const closure = await shop.put(`/staff/closures/${date}`, { note: 'Stocktake' }, { token: staff });
      expect(closure.status, closure.text).toBe(200);
      expect(closure.body).toEqual(expect.objectContaining({ date, note: 'Stocktake' }));
      expect((await shop.get('/opening-hours')).body.closures).toEqual(expect.arrayContaining([expect.objectContaining({ date })]));

      const after = (await shop.get('/delivery-slots')).body as Slot[];
      expect(after.length).toBe(42);
      expect(after.filter((s) => s.slotId.startsWith(day)).every((s) => !s.isAvailable)).toBe(true);

      const p = await shop.newProduct(staff, { stock: 2 });
      const refused = await shop.placeOrder(shop.orderBody(await shop.newBasket([[p.id, 1]]), `${day}-10`));
      expectProblem(refused, 400, 'validation.failed');
    } finally {
      await shop.delete(`/staff/closures/${date}`, { token: staff });
    }
    expectProblem(await shop.delete(`/staff/closures/${date}`, { token: staff }), 404, 'closure.not_found');
  });
});
