import { test, expect, expectProblem, uid } from '../../src/shop';

// The add-ons with a signed-in shop customer: ask-unavailable-item,
// favourites-reorder and customer-accounts.

test.describe('Ask for an unavailable item', { tag: ['@ask-unavailable-item'] }, () => {
  test('AU-01 an out-of-stock item is asked for; when stock arrives the next read shows it', async ({ shop, staff }) => {
    const { token } = await shop.signInCustomer();
    const inStock = await shop.newProduct(staff, { stock: 3 });
    const out = await shop.newProduct(staff, { stock: 0 });

    expectProblem(await shop.post('/customers/me/item-requests', { productId: inStock.id }, { token }), 409, 'item_request.in_stock');
    expectProblem(await shop.post('/customers/me/item-requests', { productId: 987654321 }, { token }), 404, 'product.not_found');

    const asked = await shop.post('/customers/me/item-requests', { productId: out.id }, { token });
    expect(asked.status, asked.text).toBe(201);
    expect(asked.body).toEqual(expect.objectContaining({ id: expect.anything(), productId: out.id, name: out.name, status: 'waiting' }));
    const again = await shop.post('/customers/me/item-requests', { productId: out.id }, { token });
    expect(again.status, 'the same open request again').toBe(200);
    expect(again.body.id).toBe(asked.body.id);

    expect((await shop.get('/customers/me/available-requests', { token })).body).toEqual([]);
    const mine = await shop.get('/customers/me/item-requests', { token });
    expect((mine.body as any[]).map((r) => r.id)).toEqual([asked.body.id]);

    const waiting = await shop.get('/staff/item-requests', { token: staff });
    expect(waiting.status, waiting.text).toBe(200);
    expect(waiting.body).toEqual(expect.arrayContaining([expect.objectContaining({ productId: out.id, name: out.name, openRequests: 1 })]));

    await shop.post('/stock/goods-in', { productId: out.id, quantity: 4 }, { token: staff });
    const available = await shop.get('/customers/me/available-requests', { token });
    expect(available.status, available.text).toBe(200);
    expect(available.body).toEqual([
      expect.objectContaining({ id: asked.body.id, status: 'available', product: expect.objectContaining({ id: out.id, stockAvailable: 4 }) }),
    ]);

    expect((await shop.delete(`/customers/me/item-requests/${asked.body.id}`, { token })).status).toBe(204);
    expectProblem(await shop.delete(`/customers/me/item-requests/${asked.body.id}`, { token }), 404, 'item_request.not_found');
    expect((await shop.get('/customers/me/available-requests', { token })).body).toEqual([]);
  });

  test('AU-02 an item asked for by name is matched once staff add a product of that name', async ({ shop, staff }) => {
    const { token } = await shop.signInCustomer();
    const name = `Kit oat milk ${uid()}`;
    const asked = await shop.post('/customers/me/item-requests', { name: name.toUpperCase() }, { token });
    expect(asked.status, asked.text).toBe(201);
    expect(asked.body.productId).toBeUndefined();
    expect(asked.body.status).toBe('waiting');

    await shop.newProduct(staff, { name, stock: 2 });
    const available = await shop.get('/customers/me/available-requests', { token });
    expect((available.body as any[]).map((r) => r.id)).toEqual([asked.body.id]);
    expect(available.body[0].product.name).toBe(name);
  });
});

test.describe('Favourites and order again', { tag: ['@favourites-reorder'] }, () => {
  test('FR-01 favourites are kept per customer', async ({ shop, staff }) => {
    const { token } = await shop.signInCustomer();
    const p = await shop.newProduct(staff, { stock: 1 });

    expect((await shop.put(`/customers/me/favourites/${p.id}`, undefined, { token })).status).toBe(204);
    expect((await shop.put(`/customers/me/favourites/${p.id}`, undefined, { token })).status, 'already a favourite').toBe(204);
    const list = await shop.get('/customers/me/favourites', { token });
    expect(list.status, list.text).toBe(200);
    expect((list.body as any[]).map((x) => x.id)).toEqual([p.id]);

    expectProblem(await shop.put('/customers/me/favourites/987654321', undefined, { token }), 404, 'product.not_found');
    expect((await shop.delete(`/customers/me/favourites/${p.id}`, { token })).status).toBe(204);
    expect((await shop.delete(`/customers/me/favourites/${p.id}`, { token })).status, 'also when it was not one').toBe(204);
    expect((await shop.get('/customers/me/favourites', { token })).body).toEqual([]);
  });

  test('FR-02 order again refills a basket from the last paid order', async ({ shop, staff }) => {
    const { token } = await shop.signInCustomer();
    expectProblem(await shop.post('/customers/me/reorder', {}, { token }), 404, 'order.none');

    const a = await shop.newProduct(staff, { stock: 10 });
    const b = await shop.newProduct(staff, { stock: 10 });
    const basketId = await shop.newBasket([[a.id, 2], [b.id, 1]]);
    const placed = await shop.placeOrder(shop.orderBody(basketId, await shop.slot()), { token });
    expect(placed.status, placed.text).toBe(201);
    expect((await shop.pay(placed.body.paymentUrl, 'paid')).status).toBeLessThan(400);

    // b is no longer sold.
    await shop.put(`/products/${b.id}`, { sku: b.sku, name: b.name, categoryId: b.categoryId, priceMinor: b.priceMinor, reorderLevel: 0, isActive: false }, { token: staff });

    const again = await shop.post('/customers/me/reorder', {}, { token });
    expect(again.status, again.text).toBe(201);
    expect(again.body.basket.lines).toEqual([expect.objectContaining({ productId: a.id, quantity: 2 })]);
    expect(again.body.skipped).toEqual([expect.objectContaining({ productId: b.id, reason: 'not-sold' })]);
  });
});

test.describe('Customer accounts', { tag: ['@customer-accounts'] }, () => {
  test('CA-01 a customer keeps addresses', async ({ shop }) => {
    const { token } = await shop.signInCustomer();
    const added = await shop.post('/customers/me/addresses', { label: 'Home', line1: '2 Kit Lane', city: 'Ghent', postcode: '9000' }, { token });
    expect(added.status, added.text).toBe(201);
    expect(added.body).toEqual(expect.objectContaining({ id: expect.anything(), label: 'Home', line1: '2 Kit Lane', city: 'Ghent', postcode: '9000' }));
    expect((await shop.get('/customers/me/addresses', { token })).body).toEqual([added.body]);

    expect((await shop.delete(`/customers/me/addresses/${added.body.id}`, { token })).status).toBe(204);
    expectProblem(await shop.delete(`/customers/me/addresses/${added.body.id}`, { token }), 404, 'address.not_found');
    expect((await shop.get('/customers/me/addresses', { token })).body).toEqual([]);
  });

  test('CA-02 orders placed while signed in are the customer\'s; guest checkout still works', async ({ shop, staff }) => {
    const { token } = await shop.signInCustomer();
    const p = await shop.newProduct(staff, { stock: 5 });

    const signedIn = await shop.order(p.id, 1, { token, pay: false });
    const guest = await shop.order(p.id, 1, { pay: false });

    const mine = await shop.get('/customers/me/orders', { token });
    expect(mine.status, mine.text).toBe(200);
    const numbers = (mine.body as any[]).map((o) => o.orderNumber);
    expect(numbers).toContain(signedIn.order.orderNumber);
    expect(numbers).not.toContain(guest.order.orderNumber);
  });
});
