// Security regressions exercise the real handlers with an in-memory Redis double.
import assert from 'node:assert/strict';

process.env.UPSTASH_REDIS_REST_URL ||= 'https://fake.local';
process.env.UPSTASH_REDIS_REST_TOKEN ||= 'fake-token';

const { default: reservationHandler, __test: reservationTest } = await import('../api/reservations.js');
const { default: cancellationHandler, __test: cancellationTest } = await import('../api/cancel-reservation.js');
const { __test: changesTest } = await import('../lib/changes.js');

changesTest.setRedisForTests({
  multi() {
    const chain = { rpush() { return chain; }, ltrim() { return chain; }, sadd() { return chain; }, async exec() { return [1, 1, 1]; } };
    return chain;
  },
});

function fakeRedis({ failKeys = false, failReservationWrite = false } = {}) {
  const data = new Map();
  const match = (pattern, key) => new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll('\\*', '.*')}$`).test(key);
  return {
    data,
    async get(key) { return data.get(key) ?? null; },
    async mget(...keys) { return keys.map((key) => data.get(key) ?? null); },
    async keys(pattern) { if (failKeys) throw new Error('redis unavailable'); return [...data.keys()].filter((key) => match(pattern, key)); },
    async set(key, value, options = {}) {
      if (options.nx && data.has(key)) return null;
      if (failReservationWrite && key.startsWith('reservations:')) throw new Error('redis write unavailable');
      data.set(key, value);
      return 'OK';
    },
    async del(key) { return data.delete(key) ? 1 : 0; },
    createScript() {
      return { async eval(keys, args) {
        if (data.get(keys[0]) === args[0]) return data.delete(keys[0]) ? 1 : 0;
        return 0;
      } };
    },
  };
}

function response() {
  return {
    statusCode: 200,
    body: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() {},
  };
}

const hours = Object.fromEntries(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  .map((day) => [day, { enabled: true, ranges: [{ start: '09:00', end: '18:00' }] }]));
const client = {
  active: true,
  features: { reservations: true },
  timezone: 'UTC',
  minNoticeHours: 0,
  capacityPerSlot: 1,
  businessHours: hours,
  menu: [{ nombre: 'Masaje', duracion: '60 min' }],
};
const booking = (nombre, hora = '10:00') => ({
  method: 'POST', headers: { 'x-forwarded-for': `${nombre}.test` }, body: {
    clientId: 'secure-spa', nombre, telefono: '5551234567', email: `${nombre}@qa.test`,
    fecha: '2040-07-20', hora, servicio: 'Masaje', idempotencyKey: `request-${nombre}`,
  },
});
async function call(handler, req) { const res = response(); await handler(req, res); return res; }

console.log('1. Redis availability read failure does not create a reservation');
{
  const redis = fakeRedis({ failKeys: true });
  redis.data.set('client:secure-spa', client);
  reservationTest.setRedisForTests(redis);
  const res = await call(reservationHandler, booking('redis-failure'));
  assert.equal(res.statusCode, 503);
  assert.equal([...redis.data.keys()].filter((key) => key.startsWith('reservations:')).length, 0);
}

console.log('2. Invalid times do not create a reservation');
{
  const redis = fakeRedis();
  redis.data.set('client:secure-spa', client);
  reservationTest.setRedisForTests(redis);
  const res = await call(reservationHandler, booking('invalid-time', '8:99 PM'));
  assert.equal(res.body.ok, false);
  assert.equal(res.body.motivo, 'hora_invalida');
  assert.equal([...redis.data.keys()].filter((key) => key.startsWith('reservations:')).length, 0);
}

console.log('3. Redis write failure does not create a reservation');
{
  const redis = fakeRedis({ failReservationWrite: true });
  redis.data.set('client:secure-spa', client);
  reservationTest.setRedisForTests(redis);
  const res = await call(reservationHandler, booking('write-failure'));
  assert.equal(res.statusCode, 503);
  assert.equal([...redis.data.keys()].filter((key) => key.startsWith('reservations:')).length, 0);
}

console.log('4. Concurrent bookings for one slot allow only one confirmation');
{
  const redis = fakeRedis();
  redis.data.set('client:secure-spa', client);
  reservationTest.setRedisForTests(redis);
  const [a, b] = await Promise.all([call(reservationHandler, booking('alice')), call(reservationHandler, booking('bob'))]);
  assert.equal([a, b].filter((res) => res.statusCode === 201).length, 1);
  assert.equal([...redis.data.keys()].filter((key) => key.startsWith('reservations:')).length, 1);
}

console.log('5. Cancellation without a token is rejected');
{
  const redis = fakeRedis();
  redis.data.set('client:secure-spa', client);
  cancellationTest.setRedisForTests(redis);
  const res = await call(cancellationHandler, { method: 'POST', headers: { 'x-forwarded-for': 'cancel.test' }, body: { clientId: 'secure-spa' } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.found, false);
}

console.log('6. A valid token cancels once and cannot be reused');
{
  const redis = fakeRedis();
  const token = '8ab3d8fb-1699-440d-89b0-ef66c4ad8e3b';
  const key = 'reservations:secure-spa:1';
  redis.data.set('client:secure-spa', client);
  redis.data.set(key, {
    clientId: 'secure-spa', estado: 'confirmada', nombre: 'Token QA', fecha: '2040-07-20', hora: '10:00',
    email: '', actionTokenHash: cancellationTest.actionTokenHash(token), actionTokenExpiresAt: '2040-07-21T23:59:59.999Z', actionTokenUsedAt: null,
  });
  cancellationTest.setRedisForTests(redis);
  const req = { method: 'POST', headers: { 'x-forwarded-for': 'token.test' }, body: { clientId: 'secure-spa', actionToken: token } };
  const first = await call(cancellationHandler, req);
  const second = await call(cancellationHandler, req);
  assert.equal(first.body.found, true);
  assert.equal(second.body.found, false);
  assert.equal(redis.data.get(key).estado, 'cancelada');
  assert.ok(redis.data.get(key).actionTokenUsedAt);
}

console.log('Reservation security handler tests verified');
