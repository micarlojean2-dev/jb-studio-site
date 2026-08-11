import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.UPSTASH_REDIS_REST_URL = 'https://e2e-redis-intenso.local';
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';

test('api/create-portal-session - validaciones y respuesta de sesión', async (t) => {
  const { default: handler } = await import('../api/create-portal-session.js');

  await t.test('rechaza método no POST (HTTP 405)', async () => {
    let statusCode = 0;
    let body = null;
    await handler({ method: 'GET', headers: {} }, {
      setHeader() {},
      status(c) { statusCode = c; return this; },
      json(b) { body = b; return this; }
    });
    assert.equal(statusCode, 405);
  });

  await t.test('rechaza request sin clientId válido (HTTP 400)', async () => {
    let statusCode = 0;
    let body = null;
    await handler({ method: 'POST', headers: {}, body: {} }, {
      setHeader() {},
      status(c) { statusCode = c; return this; },
      json(b) { body = b; return this; }
    });
    assert.equal(statusCode, 400);
    assert.equal(body.error, 'Valid clientId is required');
  });
});
