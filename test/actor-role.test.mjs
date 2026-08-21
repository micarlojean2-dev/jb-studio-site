import assert from 'node:assert/strict';

process.env.UPSTASH_REDIS_REST_URL ||= 'https://fake.local';
process.env.UPSTASH_REDIS_REST_TOKEN ||= 'fake-token';
globalThis.fetch = async () => { throw new Error('network disabled in actorRole test'); };

const { default: cancellationHandler, __test: cancellationTest } = await import('../api/cancel-reservation.js');

function fakeRedis() {
  const data = new Map();
  const match = (pattern, key) => new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll('\\*', '.*')}$`).test(key);
  return {
    data,
    async get(key) { return data.get(key) ?? null; },
    async mget(...keys) { return keys.map((key) => data.get(key) ?? null); },
    async keys(pattern) { return [...data.keys()].filter((key) => match(pattern, key)); },
    async set(key, value, options = {}) {
      if (options.nx && data.has(key)) return null;
      data.set(key, value);
      return 'OK';
    },
    async del(key) { return data.delete(key) ? 1 : 0; },
    // Rate limiter fail-open: sin incr/expire para que checkRateLimit deje pasar.
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
    statusCode: 200, body: null,
    setHeader() {}, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }, end() {},
  };
}
async function call(req) { const res = response(); await cancellationHandler(req, res); return res; }

const client = {
  active: true,
  features: { reservations: true, cancellation: true },
  timezone: 'UTC',
};

function setup(token, key) {
  const redis = fakeRedis();
  redis.data.set('client:secure-spa', client);
  redis.data.set(key, {
    clientId: 'secure-spa', estado: 'confirmada', nombre: 'QA', fecha: '2040-07-20', hora: '10:00',
    email: '', actionTokenHash: cancellationTest.actionTokenHash(token), actionTokenExpiresAt: '2040-07-21T23:59:59.999Z', actionTokenUsedAt: null,
  });
  cancellationTest.setRedisForTests(redis);
  return redis;
}

const base = (token) => ({ method: 'POST', headers: { 'x-forwarded-for': 'actor.test' }, body: { clientId: 'secure-spa', actionToken: token } });

console.log('actorRole: dueño → cancelledBy = dueño');
{
  const token = 'owner-role-token';
  const key = 'reservations:secure-spa:owner-role';
  const redis = setup(token, key);
  const res = await call({ ...base(token), body: { clientId: 'secure-spa', actionToken: token, actorRole: 'dueño' } });
  assert.equal(res.body.found, true);
  assert.equal(redis.data.get(key).cancelledBy, 'dueño');
  console.log('  ✓ actorRole "dueño" guarda cancelledBy "dueño"');
}

console.log('actorRole: hacker (texto arbitrario) → cancelledBy = cliente');
{
  const token = 'hacker-role-token';
  const key = 'reservations:secure-spa:hacker-role';
  const redis = setup(token, key);
  const res = await call({ ...base(token), body: { clientId: 'secure-spa', actionToken: token, actorRole: 'hacker' } });
  assert.equal(res.body.found, true);
  assert.equal(redis.data.get(key).cancelledBy, 'cliente');
  console.log('  ✓ actorRole "hacker" cae a cancelledBy "cliente"');
}

console.log('actorRole: ausente → cancelledBy = cliente (sin regresión)');
{
  const token = 'no-role-token';
  const key = 'reservations:secure-spa:no-role';
  const redis = setup(token, key);
  const res = await call(base(token));
  assert.equal(res.body.found, true);
  assert.equal(redis.data.get(key).cancelledBy, 'cliente');
  console.log('  ✓ sin actorRole guarda cancelledBy "cliente"');
}

console.log('\n✅ actorRole verificado');
