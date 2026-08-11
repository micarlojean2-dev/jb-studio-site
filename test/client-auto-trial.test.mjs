import assert from 'node:assert/strict';

process.env.ADMIN_TOKEN = 'client-auto-trial-token';
process.env.UPSTASH_REDIS_REST_URL = 'https://client-auto-trial.redis';
process.env.UPSTASH_REDIS_REST_TOKEN = 'client-auto-trial-token';
process.env.STRIPE_PRICE_BASIC = 'price_test_basic';

const store = new Map();
const stripeCalls = [];
const redis = {
  async get(key) { return store.get(key) || null; },
  async set(key, value) { store.set(key, value); return 'OK'; },
};
const stripe = {
  customers: {
    async create(params) {
      stripeCalls.push({ type: 'customer', params });
      return { id: 'cus_auto_trial_test' };
    },
  },
  subscriptions: {
    async create(params) {
      stripeCalls.push({ type: 'subscription', params });
      return { id: 'sub_auto_trial_test' };
    },
  },
};

const { default: handler, __test } = await import('../api/clients.js');
__test.setRedisForTests(redis);
__test.setStripeForTests(stripe);

let statusCode = 200;
let body;
await handler({
  method: 'POST',
  query: {},
  headers: { 'x-admin-token': process.env.ADMIN_TOKEN },
  body: { id: 'auto-trial-test', businessName: 'Auto Trial Test', ownerEmail: 'trial@example.com', prompt: 'Prompt seguro' },
}, {
  setHeader() {},
  status(value) { statusCode = value; return this; },
  json(value) { body = value; return this; },
});

assert.equal(statusCode, 201);
assert.equal(body.active, true);
assert.equal(body.paymentStatus, 'trialing');
assert.equal(body.stripeCustomerId, 'cus_auto_trial_test');
assert.equal(body.stripeSubscriptionId, 'sub_auto_trial_test');
assert.deepEqual(store.get('client:auto-trial-test'), body);
assert.deepEqual(stripeCalls[1], {
  type: 'subscription',
  params: {
    customer: 'cus_auto_trial_test',
    items: [{ price: 'price_test_basic' }],
    trial_period_days: 10,
    trial_settings: { end_behavior: { missing_payment_method: 'pause' } },
    metadata: { clientId: 'auto-trial-test' },
  },
});

console.log('Auto trial creation test passed');
