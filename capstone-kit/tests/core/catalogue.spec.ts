import { test, expect, expectProblem, uid } from '../../src/shop';

// Catalogue (`catalogue`) and the low-stock list (`low-stock`).

test.describe('Catalogue', { tag: ['@core', '@catalogue'] }, () => {
  test('C-01 staff add and rename a category; everyone lists it', async ({ shop, staff }) => {
    const name = `Kit ${uid()}`;
    const created = await shop.post('/categories', { name, sortOrder: 3 }, { token: staff });
    expect(created.status, created.text).toBe(201);
    expect(created.body).toEqual(expect.objectContaining({ id: expect.any(Number), name, sortOrder: 3 }));

    const listed = await shop.get('/categories');
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.body.id, name })]));

    const renamed = await shop.put(`/categories/${created.body.id}`, { name: `${name} 2`, sortOrder: 4 }, { token: staff });
    expect(renamed.status, renamed.text).toBe(200);
    expect(renamed.body.name).toBe(`${name} 2`);
  });

  test('C-02 a product starts with no stock, and staff can change it', async ({ shop, staff }) => {
    const categoryId = await shop.newCategory(staff);
    const sku = `KIT-${uid()}`;
    const created = await shop.post(
      '/products',
      { sku, name: `Kit pears ${sku}`, categoryId, priceMinor: 80, reorderLevel: 2, isActive: true },
      { token: staff },
    );
    expect(created.status, created.text).toBe(201);
    expect(created.body).toEqual(
      expect.objectContaining({
        id: expect.any(Number),
        sku,
        categoryId,
        priceMinor: 80,
        stockOnHand: 0,
        stockAvailable: 0,
        reorderLevel: 2,
        isActive: true,
      }),
    );
    expect(created.body.currency).toMatch(/^[A-Z]{3}$/);

    const read = await shop.get(`/products/${created.body.id}`);
    expect(read.status).toBe(200);
    expect(read.body.sku).toBe(sku);

    const updated = await shop.put(
      `/products/${created.body.id}`,
      { sku, name: `Kit pears ${sku}`, categoryId, priceMinor: 95, reorderLevel: 2, isActive: true },
      { token: staff },
    );
    expect(updated.status, updated.text).toBe(200);
    expect(updated.body.priceMinor).toBe(95);

    expectProblem(
      await shop.post('/products', { sku, name: 'Same SKU', categoryId, priceMinor: 1, reorderLevel: 0, isActive: true }, { token: staff }),
      409,
      'product.sku_taken',
    );
  });

  test('C-03 customers search and page active products only', async ({ shop, staff }) => {
    const categoryId = await shop.newCategory(staff);
    const tag = uid();
    const active = await shop.newProduct(staff, { name: `Kit searchable ${tag}`, categoryId });
    await shop.newProduct(staff, { name: `Kit searchable ${tag} hidden`, categoryId, isActive: false });

    const found = await shop.get(`/products?search=${encodeURIComponent(tag)}&page=1&pageSize=10`);
    expect(found.status, found.text).toBe(200);
    expect(found.body).toEqual(expect.objectContaining({ items: expect.any(Array), page: 1, pageSize: 10, total: expect.any(Number) }));
    expect(found.body.items.map((p: any) => p.id)).toEqual([active.id]);

    const byCategory = await shop.get(`/products?categoryId=${categoryId}`);
    expect(byCategory.status).toBe(200);
    expect(byCategory.body.items.map((p: any) => p.id)).toEqual([active.id]);

    const big = await shop.get('/products?pageSize=500');
    if (big.status === 200) expect(big.body.pageSize).toBeLessThanOrEqual(100);
    else expectProblem(big, 400, 'validation.failed');
  });

  test('C-04 unknown ids and bad input', async ({ shop, staff }) => {
    expectProblem(await shop.get('/products/987654321'), 404, 'product.not_found');
    const categoryId = await shop.newCategory(staff);
    expectProblem(
      await shop.post('/products', { sku: `KIT-${uid()}`, name: 'Negative', categoryId, priceMinor: -1, reorderLevel: 0, isActive: true }, { token: staff }),
      400,
      'validation.failed',
    );
    // A product in a category that does not exist is refused: either as a bad field or as a missing category.
    const nowhere = await shop.post(
      '/products',
      { sku: `KIT-${uid()}`, name: 'Nowhere', categoryId: 987654321, priceMinor: 1, reorderLevel: 0, isActive: true },
      { token: staff },
    );
    expect([`400 validation.failed`, `404 category.not_found`], nowhere.text).toContain(`${nowhere.status} ${nowhere.body?.code}`);
    expectProblem(await shop.put('/categories/987654321', { name: `Nowhere ${uid()}`, sortOrder: 1 }, { token: staff }), 404, 'category.not_found');
    expectProblem(await shop.post('/products', { sku: `KIT-${uid()}`, name: 'No staff', categoryId, priceMinor: 1, reorderLevel: 0, isActive: true }), 401, 'staff.required');
  });
});

test.describe('Low-stock list', { tag: ['@core', '@low-stock'] }, () => {
  test('L-01 products at or below their reorder level are listed, lowest first', async ({ shop, staff }) => {
    const low = await shop.newProduct(staff, { reorderLevel: 5, stock: 2 });
    const atLevel = await shop.newProduct(staff, { reorderLevel: 4, stock: 4 });
    const fine = await shop.newProduct(staff, { reorderLevel: 5, stock: 20 });

    const list = await shop.get('/stock/low', { token: staff });
    expect(list.status, list.text).toBe(200);
    const ids = (list.body as any[]).map((p) => p.id);
    expect(ids).toContain(low.id);
    expect(ids).toContain(atLevel.id);
    expect(ids).not.toContain(fine.id);

    const available = (list.body as any[]).map((p) => p.stockAvailable);
    expect(available, 'lowest first').toEqual([...available].sort((a, b) => a - b));
  });
});
