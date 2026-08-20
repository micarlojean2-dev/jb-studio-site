import Stripe from 'stripe';
import { runTrialExpiryFallback } from '../api/trial-expiry-fallback.js';

const stripeKey = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_TEST_KEY || '';
const stripe = new Stripe(stripeKey);

const redisStore = new Map();
const mockRedis = {
  get:    async (key) => redisStore.get(key) || null,
  set:    async (key, val) => { redisStore.set(key, val); return 'OK'; },
  del:    async (key) => { redisStore.delete(key); return 1; },
  keys:   async (pattern) => {
    if (pattern === 'client:*') return [...redisStore.keys()].filter(k => k.startsWith('client:'));
    return [];
  },
  mget:   async (...keys) => keys.map(k => redisStore.get(k) || null),
};

async function waitForClock(clockId) {
  let clock;
  for (let i = 0; i < 30; i++) {
    clock = await stripe.testHelpers.testClocks.retrieve(clockId);
    if (clock.status === 'ready') return clock;
    await new Promise(r => setTimeout(r, 1000));
  }
  return clock;
}

function makeLogger(label) {
  const logs = [];
  const log = {
    log:   (...args) => { const msg = args.join(' '); logs.push(msg); console.log(`[${label}] ${msg}`); },
    error: (...args) => { const msg = args.join(' '); logs.push(`ERROR: ${msg}`); console.error(`[${label}] ${msg}`); },
  };
  return { logger: log, getLogs: () => logs };
}

console.log('=== PRUEBA — Fallback de vencimiento de trial (Cron) ===\n');

console.log('===================================================================');
console.log('PASO 1: Crear Stripe Test Clock y cliente con trial activo');
console.log('===================================================================');

const nowSec = Math.floor(Date.now() / 1000);
const testClock = await stripe.testHelpers.testClocks.create({
  frozen_time: nowSec,
  name: 'Trial Expiry Fallback Test',
});
console.log(`Stripe Test Clock: ${testClock.id}, frozen_time=${testClock.frozen_time}`);

const clientId = `test-fallback-${Date.now()}`;

const customer = await stripe.customers.create({
  name: 'Fallback Test Spa',
  email: 'fallback-test@example.com',
  test_clock: testClock.id,
  metadata: { clientId },
});

const subscription = await stripe.subscriptions.create({
  customer: customer.id,
  items: [{ price: 'price_1TtgGUBwbj79Pav2Vmh1q8iM' }],
  trial_period_days: 10,
  trial_settings: { end_behavior: { missing_payment_method: 'pause' } },
  metadata: { clientId },
});
console.log(`Subscription: ${subscription.id}, status=${subscription.status}`);

const trialEndTs = subscription.trial_end;
console.log(`Trial ends at Unix timestamp: ${trialEndTs} (${new Date(trialEndTs * 1000).toISOString()})`);

const clientData = {
  id:             clientId,
  businessName:   'Fallback Test Spa',
  ownerEmail:     'fallback-test@example.com',
  plan:           'pro',
  active:         true,
  paymentStatus:  'trialing',
  trialEnabled:   true,
  trialDays:      10,
  trial_end:      String(trialEndTs),
  stripeCustomerId: customer.id,
  stripeSubscriptionId: subscription.id,
};
await mockRedis.set(`client:${clientId}`, clientData);

console.log('\n[EVIDENCIA PASO 1 — Cliente en Redis]:');
console.log(JSON.stringify(await mockRedis.get(`client:${clientId}`), null, 2));

console.log('\n===================================================================');
console.log('PASO 2: DRY RUN — Avanzar Test Clock 10.5 días y ejecutar cron');
console.log('===================================================================');

const targetTime = nowSec + Math.floor(10.5 * 86400);
await stripe.testHelpers.testClocks.advance(testClock.id, { frozen_time: targetTime });
await waitForClock(testClock.id);

const afterSub = await stripe.subscriptions.retrieve(subscription.id);
console.log(`Subscription status tras avanzar clock: ${afterSub.status} (pause_collection=${JSON.stringify(afterSub.pause_collection)})`);

const { logger: dryLog, getLogs: getDryLogs } = makeLogger('DRY');

const dryResult = await runTrialExpiryFallback({
  redis: mockRedis,
  sendBillingAlertEmail: async () => {},
  logger: dryLog,
  now: targetTime * 1000,
  dry: true,
});

console.log('\n[DRY RUN]:');
console.log(JSON.stringify(dryResult, null, 2));
console.log('\n[Logs]:', getDryLogs().join('\n'));

const dryPaused = dryResult.paused.map(c => c.id);
console.log(`\nClientes que el cron marcaría como pausados (dry): [${dryPaused.join(', ')}]`);

console.log('\n===================================================================');
console.log('PASO 3: Verificar que el cliente NO fue modificado tras dry run');
console.log('===================================================================');
const afterDryClient = await mockRedis.get(`client:${clientId}`);
console.log(`active=${afterDryClient.active} (esperado: true) ${afterDryClient.active === true ? '✅' : '❌'}`);
console.log(`paymentStatus=${afterDryClient.paymentStatus} (esperado: trialing) ${afterDryClient.paymentStatus === 'trialing' ? '✅' : '❌'}`);

console.log('\n===================================================================');
console.log('PASO 4: RUN REAL — Ejecutar cron sin dry');
console.log('===================================================================');

const { logger: realLog, getLogs: getRealLogs } = makeLogger('REAL');

const realResult = await runTrialExpiryFallback({
  redis: mockRedis,
  sendBillingAlertEmail: async () => { console.log('[EMAIL MOCK] sendBillingAlertEmail called'); },
  logger: realLog,
  now: targetTime * 1000,
});

console.log('\n[REAL RUN]:');
console.log(JSON.stringify(realResult, null, 2));

const afterRealClient = await mockRedis.get(`client:${clientId}`);
console.log('\n[EVIDENCIA PASO 4 — Cliente en Redis tras cron real]:');
console.log(JSON.stringify(afterRealClient, null, 2));

console.log('\n===================================================================');
console.log('PASO 5: Verificar idempotencia — ejecutar cron de nuevo');
console.log('===================================================================');

const { logger: idemLog } = makeLogger('IDEM');

const idemResult = await runTrialExpiryFallback({
  redis: mockRedis,
  sendBillingAlertEmail: async () => {},
  logger: idemLog,
});

console.log('\n[IDEMPOTENT RUN]:');
console.log(JSON.stringify(idemResult, null, 2));

const idempotentPaused = idemResult.paused.map(c => c.id);
console.log(`\nClientes pausados en segunda ejecución: [${idempotentPaused.join(', ')}]`);
console.log(`Idempotente: ${idempotentPaused.length === 0 ? '✅ SÍ (no duplicó)' : '❌ NO (duplicó)'}`);

console.log('\n===================================================================');
console.log('PASO 6: Verificación final');
console.log('===================================================================');
const finalClient = await mockRedis.get(`client:${clientId}`);
const pass =
  finalClient.active === false &&
  finalClient.paymentStatus === 'paused' &&
  idemResult.paused.length === 0 &&
  realResult.paused.length === 1 &&
  dryResult.paused.length === 1 &&
  afterDryClient.active === true;

console.log(`active = ${finalClient.active} (esperado: false) ${finalClient.active === false ? '✅' : '❌'}`);
console.log(`paymentStatus = ${finalClient.paymentStatus} (esperado: paused) ${finalClient.paymentStatus === 'paused' ? '✅' : '❌'}`);
console.log(`dry paused count = ${dryResult.paused.length} (esperado: 1) ${dryResult.paused.length === 1 ? '✅' : '❌'}`);
console.log(`real paused count = ${realResult.paused.length} (esperado: 1) ${realResult.paused.length === 1 ? '✅' : '❌'}`);
console.log(`idempotent paused count = ${idemResult.paused.length} (esperado: 0) ${idemResult.paused.length === 0 ? '✅' : '❌'}`);
console.log(`no-modification-after-dry = ${afterDryClient.active === true ? '✅' : '❌'}`);
console.log(`\n${pass ? '✅ PRUEBA COMPLETA EXITOSA' : '❌ PRUEBA FALLIDA'}`);

console.log('\n===================================================================');
console.log('PASO 7: Limpieza');
console.log('===================================================================');
await stripe.subscriptions.cancel(subscription.id);
console.log(`Suscripción cancelada.`);
await stripe.customers.del(customer.id);
console.log(`Customer eliminado.`);
await stripe.testHelpers.testClocks.del(testClock.id);
console.log(`Test Clock eliminado.`);
await mockRedis.del(`client:${clientId}`);
console.log(`Cliente Redis eliminado.`);
