import { test, expect, expectProblem, POSTCODE } from '../../src/shop';

// Pick and pack (`pick-pack`), courier booking (`delivery-booking`) and
// track your order (`track-order`).

test.describe('Orders to pick and pack', { tag: ['@core', '@pick-pack'] }, () => {
  test('PP-01 a paid order is on the pick list with its address, and is packed once', async ({ shop, staff }) => {
    const p = await shop.newProduct(staff, { stock: 3 });
    const { order, body } = await shop.order(p.id, 1);

    const list = await shop.get('/staff/orders', { token: staff });
    expect(list.status, list.text).toBe(200);
    const mine = (list.body as any[]).find((o) => o.orderNumber === order.orderNumber);
    expect(mine, 'the paid order is on the pick list').toBeTruthy();
    expect(mine.status).toBe('paid');
    expect(mine.customer).toEqual(expect.objectContaining({ name: body.customer.name, email: body.customer.email }));
    expect(mine.address).toEqual(expect.objectContaining({ line1: body.address.line1, city: body.address.city }));

    const packed = await shop.post(`/staff/orders/${order.orderNumber}/packed`, {}, { token: staff });
    expect(packed.status, packed.text).toBe(200);
    expect(packed.body).toEqual(expect.objectContaining({ orderNumber: order.orderNumber, status: 'packed' }));
    expectProblem(await shop.post(`/staff/orders/${order.orderNumber}/packed`, {}, { token: staff }), 409, 'order.status');

    const packedList = await shop.get('/staff/orders?status=packed', { token: staff });
    expect((packedList.body as any[]).map((o) => o.orderNumber)).toContain(order.orderNumber);
    expectProblem(await shop.get('/staff/orders'), 401, 'staff.required');
  });

  test('PP-02 an unpaid order cannot be packed', async ({ shop, staff }) => {
    const p = await shop.newProduct(staff, { stock: 3 });
    const { order } = await shop.order(p.id, 1, { pay: false });
    expectProblem(await shop.post(`/staff/orders/${order.orderNumber}/packed`, {}, { token: staff }), 409, 'order.status');
  });
});

test.describe('Courier booking', { tag: ['@core', '@delivery-booking'] }, () => {
  test('D-01 a packed order is booked once, and each courier step moves the order on', async ({ shop, staff }) => {
    const p = await shop.newProduct(staff, { stock: 3 });
    const { order } = await shop.order(p.id, 1);

    expectProblem(await shop.post(`/staff/orders/${order.orderNumber}/delivery`, {}, { token: staff }), 409, 'order.status');
    expect((await shop.post(`/staff/orders/${order.orderNumber}/packed`, {}, { token: staff })).status).toBe(200);

    const booked = await shop.post(`/staff/orders/${order.orderNumber}/delivery`, {}, { token: staff });
    expect(booked.status, booked.text).toBe(201);
    expect(booked.body).toEqual(expect.objectContaining({ deliveryId: expect.anything(), status: 'accepted', orderNumber: order.orderNumber }));
    expectProblem(await shop.post(`/staff/orders/${order.orderNumber}/delivery`, {}, { token: staff }), 409, 'order.status');

    const id = booked.body.deliveryId;
    const steps = [
      ['picked-up', undefined],
      ['out-for-delivery', 'out-for-delivery'],
      ['delivered', 'delivered'],
    ] as const;
    for (const [status, orderStatus] of steps) {
      const next = await shop.post(`/dev/deliveries/${id}/advance`);
      expect(next.status, next.text).toBe(200);
      expect(next.body.status).toBe(status);
      if (orderStatus) expect(next.body.orderStatus).toBe(orderStatus);
    }
    expectProblem(await shop.post(`/dev/deliveries/${id}/advance`), 409, 'delivery.finished');
    expect((await shop.get(`/orders/${order.orderNumber}`)).body.status).toBe('delivered');
  });

  test('D-02 a failed delivery fails the order', async ({ shop, staff }) => {
    const p = await shop.newProduct(staff, { stock: 3 });
    const { order } = await shop.order(p.id, 1);
    await shop.post(`/staff/orders/${order.orderNumber}/packed`, {}, { token: staff });
    const booked = await shop.post(`/staff/orders/${order.orderNumber}/delivery`, {}, { token: staff });
    expect(booked.status, booked.text).toBe(201);

    const failed = await shop.post(`/dev/deliveries/${booked.body.deliveryId}/fail`);
    expect(failed.status, failed.text).toBe(200);
    expect(failed.body.status).toBe('failed');
    expect(failed.body.orderStatus).toBe('delivery-failed');
    expectProblem(await shop.post(`/dev/deliveries/${booked.body.deliveryId}/advance`), 409, 'delivery.finished');
  });
});

test.describe('Track your order', { tag: ['@core', '@track-order'] }, () => {
  test('T-01 the order number and postcode show the status, and nothing else', async ({ shop, staff }) => {
    const p = await shop.newProduct(staff, { stock: 3 });
    const { order, body } = await shop.order(p.id, 1);

    const tracked = await shop.get(`/track?orderNumber=${order.orderNumber}&postcode=${encodeURIComponent(POSTCODE)}`);
    expect(tracked.status, tracked.text).toBe(200);
    expect(tracked.body).toEqual(expect.objectContaining({ orderNumber: order.orderNumber, status: 'paid', slot: expect.any(Object) }));
    expect(typeof tracked.body.updatedAtUtc).toBe('string');
    expect(tracked.body.lines, 'no lines').toBeUndefined();
    const text = JSON.stringify(tracked.body);
    expect(text, 'no name').not.toContain(body.customer.name);
    expect(text, 'no email').not.toContain(body.customer.email);
    expect(text, 'no address').not.toContain(body.address.line1);
  });

  test('T-02 a wrong postcode and a wrong number give the same 404 track.not_found', async ({ shop, staff }) => {
    const p = await shop.newProduct(staff, { stock: 3 });
    const { order } = await shop.order(p.id, 1);

    const wrongPostcode = await shop.get(`/track?orderNumber=${order.orderNumber}&postcode=9999ZZ`);
    const wrongNumber = await shop.get(`/track?orderNumber=GS-ZZZZZZZZZZ&postcode=${encodeURIComponent(POSTCODE)}`);
    expectProblem(wrongPostcode, 404, 'track.not_found');
    expectProblem(wrongNumber, 404, 'track.not_found');
    // The same answer, apart from per-request ids — nothing tells which detail was wrong.
    const strip = (b: any) => ({ ...b, traceId: undefined, instance: undefined, requestId: undefined });
    expect(strip(wrongPostcode.body)).toEqual(strip(wrongNumber.body));
  });
});
