import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ADMIN_TOKEN = 'test-admin-token';
process.env.UPSTASH_REDIS_REST_URL = 'https://e2e-redis-intenso.local';
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';

test('api/client-status - endpoint de estado de suscripción y trial', async (t) => {
  const { default: handler, __test } = await import('../api/client-status.js');

  const mockClient = {
    id: 'barberia-status-test',
    plan: 'pro',
    active: false,
    paymentStatus: 'pending',
    panelToken: 'panel-secret-token',
    createdAt: new Date().toISOString(),
    trialDays: 10,
    stripeCustomerId: 'cus_test_123'
  };

  __test.setRedisForTests({
    get: async (key) => key === 'client:barberia-status-test' ? mockClient : null
  });

  await t.test('rechaza petición no GET (HTTP 405)', async () => {
    let statusCode = 0;
    await handler({ method: 'POST', query: { clientId: 'barberia-status-test' } }, {
      setHeader() {},
      status(c) { statusCode = c; return this; },
      json() { return this; }
    });
    assert.equal(statusCode, 405);
  });

  await t.test('rechaza token inválido (HTTP 401)', async () => {
    let statusCode = 0;
    await handler({ method: 'GET', query: { clientId: 'barberia-status-test', token: 'wrong' }, headers: {} }, {
      setHeader() {},
      status(c) { statusCode = c; return this; },
      json() { return this; }
    });
    assert.equal(statusCode, 401);
  });

  await t.test('devuelve estado completo de trial con panelToken válido (HTTP 200)', async () => {
    let statusCode = 0;
    let body = null;
    await handler({ method: 'GET', query: { clientId: 'barberia-status-test', token: 'panel-secret-token' }, headers: {} }, {
      setHeader() {},
      status(c) { statusCode = c; return this; },
      json(b) { body = b; return this; }
    });
    assert.equal(statusCode, 200);
    assert.equal(body.clientId, 'barberia-status-test');
    assert.equal(body.trialDaysLeft, 10);
    assert.equal(body.isTrialing, true);
    assert.equal(body.hasPaymentMethod, false);
    assert.equal(typeof body.trial_end, 'string');
  });
});
