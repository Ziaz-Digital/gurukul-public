import { test, expect, expectProblem, uid } from '../../src/shop';

// Customer sign-in, shared by customer-accounts, ask-unavailable-item and
// favourites-reorder: any one of them switches it on.

test.describe('Customer sign-in', { tag: ['@customer-accounts', '@ask-unavailable-item', '@favourites-reorder'] }, () => {
  test('CS-01 a one-time code from the outbox signs a customer in, once', async ({ shop }) => {
    const email = `customer.${uid().toLowerCase()}@example.com`;
    const issued = await shop.post('/customers/sign-in-codes', { email });
    expect(issued.status, issued.text).toBe(202);
    expect(new Date(issued.body.expiresAtUtc).getTime()).toBeGreaterThan(Date.now());

    const code = await shop.signInCode(email);
    expectProblem(await shop.post('/customers/sessions', { email, code: code === '000000' ? '111111' : '000000' }), 401, 'customer.code_invalid');

    const session = await shop.post('/customers/sessions', { email, code });
    expect(session.status, session.text).toBe(201);
    expect(typeof session.body.token).toBe('string');
    expect(session.body.customer).toEqual(expect.objectContaining({ id: expect.anything(), email }));
    expectProblem(await shop.post('/customers/sessions', { email, code }), 401, 'customer.code_invalid');

    const me = await shop.get('/customers/me', { token: session.body.token });
    expect(me.status, me.text).toBe(200);
    expect(me.body.email).toBe(email);
  });

  test('CS-02 customer routes need a customer token; signing out ends it', async ({ shop }) => {
    expectProblem(await shop.get('/customers/me'), 401, 'customer.required');
    expectProblem(await shop.get('/customers/me', { token: 'gkcu_notarealtoken' }), 401, 'customer.session_invalid');

    const { token } = await shop.signInCustomer();
    expect((await shop.delete('/customers/sessions/current', { token })).status).toBe(204);
    expectProblem(await shop.get('/customers/me', { token }), 401, 'customer.session_invalid');
  });
});
