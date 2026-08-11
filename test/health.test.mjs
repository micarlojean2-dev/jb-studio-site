import assert from 'node:assert/strict';
import handler, { __test } from '../api/health.js';

console.log('Testing api/health.js...');

async function request() {
  const req = { method: 'GET' };
  let statusResult = null;
  let jsonResult = null;

  const res = {
    setHeader() {},
    status(s) { statusResult = s; return this; },
    json(d) { jsonResult = d; return this; },
    end() { return this; },
  };

  await handler(req, res);
  return { statusResult, jsonResult };
}

async function runTests() {
  __test.setRedisForTests({ ping: async () => 'PONG' });
  let { statusResult, jsonResult } = await request();

  assert.equal(statusResult, 200, 'GET /api/health debe responder 200');
  assert.equal(jsonResult.status, 'ok', 'Redis disponible debe responder ok');
  assert.ok(!Number.isNaN(Date.parse(jsonResult.timestamp)), 'timestamp debe ser ISO válido');

  __test.setRedisForTests({ ping: async () => { throw new Error('redis unavailable'); } });
  ({ statusResult, jsonResult } = await request());
  assert.equal(statusResult, 200, 'Redis caído no debe ocultar que el servidor responde');
  assert.equal(jsonResult.status, 'degraded', 'Redis caído debe responder degraded');

  console.log('✅ Unit test for api/health.js passed successfully!');
}

runTests();
