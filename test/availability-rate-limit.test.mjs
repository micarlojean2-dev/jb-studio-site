import assert from 'node:assert/strict';

process.env.UPSTASH_REDIS_REST_URL ||= 'https://fake.local';
process.env.UPSTASH_REDIS_REST_TOKEN ||= 'fake-token';

const { default: handler, __test } = await import('../api/reservations.js');

function fakeRedis() {
  const data = new Map();
  const matches = (pattern, key) => new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll('\\*', '.*')}$`).test(key);
  return {
    data,
    async get(key) { return data.get(key) ?? null; },
    async mget(...keys) { return keys.map((key) => data.get(key) ?? null); },
    async keys(pattern) { return [...data.keys()].filter((key) => matches(pattern, key)); },
    async set(key, value) { data.set(key, value); return 'OK'; },
  };
}

function response() {
  return {
    statusCode: null,
    body: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; },
  };
}

async function call(body, ip) {
  const res = response();
  await handler({ method: 'POST', headers: { 'x-forwarded-for': ip }, body }, res);
  return res;
}

const businessHours = Object.fromEntries(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  .map((day) => [day, { enabled: true, ranges: [{ start: '09:00', end: '18:00' }] }]));
const redis = fakeRedis();
redis.data.set('client:availability-test', {
  active: true,
  features: { reservations: true },
  timezone: 'UTC',
  minNoticeHours: 0,
  capacityPerSlot: 1,
  businessHours,
  menu: [{ nombre: 'Corte', duracion: '45 min' }],
});
__test.setRedisForTests(redis);

const ip = 'availability-rate-limit.test';
for (let attempt = 1; attempt <= 20; attempt++) {
  const dates = await call({ action: 'dates', clientId: 'availability-test', service: 'Corte' }, ip);
  assert.equal(dates.statusCode, 200, `dates request ${attempt} should not exhaust the availability limit`);
  assert.equal(dates.body.ok, true);
  assert.ok(dates.body.dates.length > 0);

  const slots = await call({ action: 'slots', clientId: 'availability-test', service: 'Corte', date: dates.body.dates[0].value }, ip);
  assert.equal(slots.statusCode, 200, `slots request ${attempt} should not exhaust the availability limit`);
  assert.equal(slots.body.ok, true);
  assert.ok(slots.body.slots.length > 0);
}

for (let attempt = 1; attempt <= 20; attempt++) {
  const dates = await call({ action: 'dates', clientId: 'availability-test', service: 'Corte' }, ip);
  assert.equal(dates.statusCode, 200, `availability request ${attempt + 40} should stay within the limit`);
}

const rateLimitedAvailability = await call({ action: 'dates', clientId: 'availability-test', service: 'Corte' }, ip);
assert.equal(rateLimitedAvailability.statusCode, 429);
assert.equal(rateLimitedAvailability.body.error, 'availability_rate_limited');
assert.match(rateLimitedAvailability.body.message, /demasiadas consultas de disponibilidad/i);

for (let attempt = 1; attempt <= 6; attempt++) {
  const mutation = await call({ clientId: 'availability-test' }, ip);
  assert.equal(mutation.statusCode, attempt <= 5 ? 400 : 429, `mutation request ${attempt} should keep the strict limit`);
}

console.log('Availability rate limit: 60 reads are allowed, the 61st has a specific error, and mutations remain limited to five per IP per hour.');
