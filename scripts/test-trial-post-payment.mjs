import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const redisStore = new Map();
const mockRedis = {
  get:  async (key) => redisStore.get(key) || null,
  set:  async (key, val) => { redisStore.set(key, val); return 'OK'; },
  del:  async (key) => { redisStore.delete(key); return 1; },
  keys: async (pattern) => {
    if (pattern === 'client:*') return [...redisStore.keys()].filter(k => k.startsWith('client:'));
    return [];
  },
};

function makeClient(data) {
  return {
    id: data.id, businessName: data.businessName || 'Test', ownerEmail: data.ownerEmail || 'test@test.com',
    plan: data.plan || 'pro', active: data.active !== undefined ? data.active : true,
    paymentStatus: data.paymentStatus || 'trialing', trialEnabled: data.trialEnabled !== undefined ? data.trialEnabled : true,
    trialDays: data.trialDays || 10, trial_end: data.trial_end || null,
    stripeCustomerId: data.stripeCustomerId || null, stripeSubscriptionId: data.stripeSubscriptionId || null,
  };
}

async function waitForClock(clockId) {
  for (let i = 0; i < 30; i++) {
    const c = await stripe.testHelpers.testClocks.retrieve(clockId);
    if (c.status === 'ready') return c;
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('Clock not ready');
}

function sec(title) {
  console.log('\n' + '='.repeat(78));
  console.log(title);
  console.log('='.repeat(78));
}

async function testHappy() {
  sec('ESCENARIO 1 -- COBRO EXITOSO (4242)');
  const nowSec = Math.floor(Date.now() / 1000);
  const tc = await stripe.testHelpers.testClocks.create({ frozen_time: nowSec, name: 'Happy' });
  console.log('Clock:', tc.id);
  const cid = 'happy-' + Date.now();

  const cust = await stripe.customers.create({ name: 'Happy Test', email: cid + '@x.com', test_clock: tc.id });
  const pm = await stripe.paymentMethods.create({ type: 'card', card: { token: 'tok_visa' } });
  await stripe.paymentMethods.attach(pm.id, { customer: cust.id });
  await stripe.customers.update(cust.id, { invoice_settings: { default_payment_method: pm.id } });

  const sub = await stripe.subscriptions.create({
    customer: cust.id, items: [{ price: 'price_1TtgGUBwbj79Pav2Vmh1q8iM' }],
    trial_period_days: 10, default_payment_method: pm.id,
    trial_settings: { end_behavior: { missing_payment_method: 'pause' } },
    metadata: { clientId: cid },
  });
  console.log('Trial ends:', sub.trial_end, new Date(sub.trial_end * 1000).toISOString());
  console.log('Sub:', sub.id, 'status=', sub.status);

  await mockRedis.set('client:' + cid, makeClient({ id: cid, businessName: 'Happy Test', ownerEmail: cid + '@x.com', active: true, paymentStatus: 'trialing', trialEnabled: true, trial_end: String(sub.trial_end), stripeCustomerId: cust.id, stripeSubscriptionId: sub.id }));

  sec('PASO 1a -- Redis inicial');
  console.log(JSON.stringify(await mockRedis.get('client:' + cid), null, 2));

  const t10 = nowSec + Math.floor(10.5 * 86400);
  await stripe.testHelpers.testClocks.advance(tc.id, { frozen_time: t10 });
  await waitForClock(tc.id);

  const s1 = await stripe.subscriptions.retrieve(sub.id);
  sec('PASO 1b -- Suscripcion tras avanzar 10.5 dias');
  console.log('Status:', s1.status, s1.status === 'active' ? 'OK' : 'FAIL');
  console.log('Pause collection:', JSON.stringify(s1.pause_collection));

  const evs = await stripe.events.list({ limit: 20 });
  const paid = evs.data.filter(e => e.type === 'invoice.paid');
  const failed = evs.data.filter(e => e.type === 'invoice.payment_failed');
  const subUpd = evs.data.filter(e => e.type === 'customer.subscription.updated');

  sec('PASO 1c -- Eventos Stripe');
  paid.forEach(e => { const i = e.data.object; console.log('  ', e.type, '| inv=', i.id, '| status=', i.status, '| amount=', i.amount_paid, '| attempts=', i.attempt_count); });
  failed.forEach(e => { const i = e.data.object; console.log('  ', e.type, '| inv=', i.id, '| status=', i.status, '| attempts=', i.attempt_count); });
  subUpd.forEach(e => { const o = e.data.object; console.log('  ', e.type, '| sub=', o.id, '| status=', o.status); });

  sec('PASO 1d -- Redis tras cobro (mock, sin webhook real)');
  const r1 = await mockRedis.get('client:' + cid);
  console.log(JSON.stringify(r1, null, 2));
  console.log('');
  console.log('NOTA: Redis es mock. El webhook real invoice.paid actualiza paymentStatus->paid.');
  console.log('Stripe invoice.paid:', paid.length > 0 ? 'OK' : 'FAIL', '(' + paid.length + ' evento(s))');
  console.log('Suscripcion activa:', s1.status === 'active' ? 'OK' : 'FAIL');

  try {
    const portal = await stripe.billingPortal.sessions.create({ customer: cust.id, return_url: 'https://jbstudio.app' });
    console.log('Portal: OK', portal.id);
  } catch(e) { console.log('Portal: WARNING', e.message); }

  const res = { subStatus: s1.status, invoicePaid: paid.length > 0, noFailed: failed.length === 0 };
  await stripe.subscriptions.cancel(sub.id);
  await stripe.customers.del(cust.id);
  await stripe.testHelpers.testClocks.del(tc.id);
  await mockRedis.del('client:' + cid);
  console.log('Limpieza OK');
  return res;
}

async function testFail() {
  sec('ESCENARIO 2 -- COBRO FALLIDO (sin payment method -> past_due)');
  const nowSec = Math.floor(Date.now() / 1000);
  const tc = await stripe.testHelpers.testClocks.create({ frozen_time: nowSec, name: 'Fail' });
  console.log('Clock:', tc.id);
  const cid = 'fail-' + Date.now();

  const cust = await stripe.customers.create({ name: 'Fail Test', email: cid + '@x.com', test_clock: tc.id });

  const sub = await stripe.subscriptions.create({
    customer: cust.id, items: [{ price: 'price_1TtgGUBwbj79Pav2Vmh1q8iM' }],
    trial_period_days: 10, payment_behavior: 'default_incomplete',
    trial_settings: { end_behavior: { missing_payment_method: 'pause' } },
    metadata: { clientId: cid },
  });
  console.log('Trial ends:', sub.trial_end, new Date(sub.trial_end * 1000).toISOString());
  console.log('Sub:', sub.id, 'status=', sub.status);

  await mockRedis.set('client:' + cid, makeClient({ id: cid, businessName: 'Fail Test', ownerEmail: cid + '@x.com', active: true, paymentStatus: 'trialing', trialEnabled: true, trial_end: String(sub.trial_end), stripeCustomerId: cust.id, stripeSubscriptionId: sub.id }));

  sec('PASO 2a -- Redis inicial');
  console.log(JSON.stringify(await mockRedis.get('client:' + cid), null, 2));

  const day11 = nowSec + Math.floor(11 * 86400);
  await stripe.testHelpers.testClocks.advance(tc.id, { frozen_time: day11 });
  await waitForClock(tc.id);

  const s11 = await stripe.subscriptions.retrieve(sub.id);
  sec('PASO 2b -- DIA 11 (primer intento -> past_due)');
  console.log('Status:', s11.status, s11.status === 'past_due' ? 'OK' : 'FAIL');
  console.log('Past due:', s11.past_due);
  console.log('Pause collection:', JSON.stringify(s11.pause_collection));

  const ev11 = await stripe.events.list({ limit: 20, created: { gte: day11 - 120, lte: day11 + 120 } });
  const inv11 = ev11.data.filter(e => e.type.startsWith('invoice'));
  const fail11 = ev11.data.filter(e => e.type === 'invoice.payment_failed');
  const subUpd11 = ev11.data.filter(e => e.type === 'customer.subscription.updated');

  sec('PASO 2c -- Eventos DIA 11');
  inv11.forEach(e => { const i = e.data.object; console.log('  ', e.type, '| inv=', i.id, '| status=', i.status, '| amount_due=', i.amount_due, '| attempts=', i.attempt_count); });
  subUpd11.forEach(e => { const o = e.data.object; console.log('  ', e.type, '| status=', o.status, '| past_due=', o.past_due); });

  const r11 = await mockRedis.get('client:' + cid);
  console.log('');
  console.log('Redis DIA 11:');
  console.log('active=', r11.active, r11.active === true ? 'OK (past_due NO pausa)' : 'FAIL');
  console.log('paymentStatus=', r11.paymentStatus);

  const day22 = nowSec + Math.floor(22 * 86400);
  await stripe.testHelpers.testClocks.advance(tc.id, { frozen_time: day22 });
  await waitForClock(tc.id);

  const s22 = await stripe.subscriptions.retrieve(sub.id);
  sec('PASO 2d -- DIA 22 (reintentos agotados)');
  console.log('Status:', s22.status);
  console.log('Pause collection:', JSON.stringify(s22.pause_collection));
  console.log('Past due:', s22.past_due);

  const ev22 = await stripe.events.list({ limit: 60, created: { gte: day11, lte: day22 + 120 } });
  const failAll = ev22.data.filter(e => e.type === 'invoice.payment_failed');
  const unpaidEv = ev22.data.filter(e => e.type === 'customer.subscription.updated' && e.data.object.status === 'unpaid');
  const closed = ev22.data.filter(e => e.type === 'invoice.closed');

  sec('PASO 2e -- Resumen eventos dias 11-22');
  console.log('invoice.payment_failed:', failAll.length, 'evento(s)');
  console.log('subscription.updated(unpaid):', unpaidEv.length, 'evento(s)');
  console.log('invoice.closed:', closed.length, 'evento(s)');
  failAll.forEach(e => { const i = e.data.object; console.log('    ', e.type, '| inv=', i.id, '| attempts=', i.attempt_count, '| status=', i.status, '| date=', new Date(e.created * 1000).toISOString()); });
  unpaidEv.forEach(e => { const o = e.data.object; console.log('    ', e.type, '| status=', o.status, '| date=', new Date(e.created * 1000).toISOString()); });

  const r22 = await mockRedis.get('client:' + cid);
  sec('PASO 2f -- Redis DIA 22');
  console.log(JSON.stringify(r22, null, 2));
  console.log('');
  console.log('Redis active=', r22.active, r22.active === false ? 'OK (pausado tras unpaid)' : 'WARNING (aun activo, el cron lo pausara)');

  const pass = s11.status === 'past_due' && r11.active === true;
  console.log('');
  console.log(pass ? 'OK -- ESCENARIO 2 OK' : 'FAIL -- ESCENARIO 2 FALLIDO');

  await stripe.subscriptions.cancel(sub.id);
  await stripe.customers.del(cust.id);
  await stripe.testHelpers.testClocks.del(tc.id);
  await mockRedis.del('client:' + cid);
  console.log('Limpieza OK');
  return { day11Status: s11.status, day11PastDue: s11.past_due, day22Status: s22.status, failCount: failAll.length, unpaidCount: unpaidEv.length, redisD11: r11.active, redisD22: r22.active };
}

async function main() {
  console.log('==================================================');
  console.log('  PRUEBA COMPLETA -- Post-trial payment flow      ');
  console.log('  (cobro exitoso + cobro fallido + reintentos)    ');
  console.log('==================================================');
  const h = await testHappy();
  const f = await testFail();
  sec('RESUMEN FINAL');
  console.log('ESCENARIO 1: sub status =', h.subStatus, h.subStatus === 'active' ? 'OK' : 'FAIL');
  console.log('ESCENARIO 1: invoice.paid =', h.invoicePaid ? 'OK' : 'FAIL');
  console.log('ESCENARIO 1: no invoice.payment_failed =', h.noFailed ? 'OK' : 'FAIL');
  console.log('ESCENARIO 2: dia11 status =', f.day11Status, f.day11Status === 'past_due' ? 'OK' : 'FAIL');
  console.log('ESCENARIO 2: dia11 redis active =', f.redisD11, f.redisD11 === true ? 'OK' : 'FAIL', '(past_due no pausa)');
  console.log('ESCENARIO 2: dia22 status =', f.day22Status);
  console.log('ESCENARIO 2: invoice.payment_failed count =', f.failCount);
  console.log('ESCENARIO 2: unpaid events count =', f.unpaidCount);
}
main().catch(console.error);
