import { test, expect, expectProblem } from '../../src/shop';

// Access (shop-server.md "Access") and staff sign-in (`staff-sign-in`).

test.describe('Access', { tag: ['@core'] }, () => {
  test('A-01 no shop key → 401 problem details, code shop.key_missing', async ({ shop }) => {
    const res = await shop.get('/products', { noKey: true });
    expectProblem(res, 401, 'shop.key_missing');
    expect(res.headers['content-type'], 'errors are RFC 9457 problem details').toContain('application/problem+json');
    expect(res.body.status).toBe(401);
    expect(typeof res.body.title).toBe('string');
  });

  test('A-02 an unknown shop key → 401 shop.key_invalid', async ({ shop }) => {
    const res = await shop.get('/products', { key: 'gkshop_thisisnotarealkeyatall000000000000000000' });
    expectProblem(res, 401, 'shop.key_invalid');
  });

  test('A-03 a front end on http://localhost may call it (CORS preflight)', async ({ shop }) => {
    const origin = 'http://localhost:5173';
    const res = await shop.call('OPTIONS', '/orders', undefined, {
      noKey: true,
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'x-shop-key,content-type,idempotency-key',
      },
    });
    expect(res.status, res.text).toBeLessThan(300);
    expect([origin, '*']).toContain(res.headers['access-control-allow-origin']);
    expect(res.headers['access-control-allow-credentials'], 'credentials are not allowed').not.toBe('true');
  });
});

test.describe('Staff sign-in', { tag: ['@core', '@staff-sign-in'] }, () => {
  test('S-01 a staff route without a staff token → 401 staff.required', async ({ shop }) => {
    expectProblem(await shop.post('/categories', { name: 'No token' }), 401, 'staff.required');
    expectProblem(await shop.get('/stock/low'), 401, 'staff.required');
  });

  test('S-02 a wrong staff code → 401 staff.code_invalid', async ({ shop }) => {
    // One wrong try only: five in ten minutes lock staff sign-in.
    expectProblem(await shop.post('/staff/sessions', { staffCode: 'ZZZZZZZZZZZZ' }), 401, 'staff.code_invalid');
  });

  test('S-03 the staff code signs staff in; signing out ends that session at once', async ({ shop }) => {
    const session = await shop.post('/staff/sessions', { staffCode: process.env.SHOP_STAFF_CODE });
    expect(session.status, session.text).toBe(201);
    expect(typeof session.body.token).toBe('string');
    expect(new Date(session.body.expiresAtUtc).getTime()).toBeGreaterThan(Date.now());
    const token = session.body.token as string;

    expect((await shop.get('/stock/low', { token })).status).toBe(200);
    expect((await shop.delete('/staff/sessions/current', { token })).status).toBe(204);
    expectProblem(await shop.get('/stock/low', { token }), 401, 'staff.session_invalid');
  });

  test('S-04 a junk staff token → 401 staff.session_invalid', async ({ shop }) => {
    expectProblem(await shop.get('/stock/low', { token: 'gkst_notarealtoken' }), 401, 'staff.session_invalid');
  });
});
