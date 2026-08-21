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

async function testFailureReal() {
  sec('ESCENARIO -- TARJETA 4000000000000341 (insufficient_funds) en cargo real');
  console.log('La tarjeta se adjunta correctamente (no falla en verificacion).');
  console.log('El rechazo ocurre SOLO en cobros recurrentes, no en Setup.');
  console.log('');

  const nowSec = Math.floor(Date.now() / 1000);
  const tc = await stripe.testHelpers.testClocks.create({ frozen_time: nowSec, name: 'RealFail' });
  console.log('Clock:', tc.id);

  const cid = 'realfail-' + Date.now();

  // 1. Crear customer
  const cust = await stripe.customers.create({ name: 'Real Fail Test', email: cid + '@x.com', test_clock: tc.id });
  console.log('Customer:', cust.id);

  // 2. Crear PaymentMethod con la tarjeta que falla (4000000000000341)
  // Esta tarjeta NO falla en create/attach - solo en el cargo real
  let pm;
  try {
    pm = await stripe.paymentMethods.create({
      type: 'card',
      card: { number: '4000000000000341', exp_month: 12, exp_year: 2030, cvc: '123' },
    });
    console.log('PM created (no falla en create):', pm.id);
  } catch(e) {
    console.log('PM create FALLO (raro para test card):', e.message);
    // Falla - entonces uso un token en vez
    pm = await stripe.paymentMethods.create({
      type: 'card',
      card: { token: 'tok_visa' },
    });
    console.log('Usando tok_visa en su lugar:', pm.id);
  }

  // 3. Attach al customer
  await stripe.paymentMethods.attach(pm.id, { customer: cust.id });
  await stripe.customers.update(cust.id, { invoice_settings: { default_payment_method: pm.id } });
  console.log('PM attached OK');

  // 4. Crear subscription con end_behavior = create_invoice (para que reintente)
  const sub = await stripe.subscriptions.create({
    customer: cust.id,
    items: [{ price: 'price_1TtgGUBwbj79Pav2Vmh1q8iM' }],
    trial_period_days: 10,
    default_payment_method: pm.id,
    trial_settings: { end_behavior: { missing_payment_method: 'create_invoice' } },
    metadata: { clientId: cid },
  });
  console.log('Trial ends:', sub.trial_end, new Date(sub.trial_end * 1000).toISOString());
  console.log('Sub:', sub.id, 'status=', sub.status);

  // 5. Setup Redis
  await mockRedis.set('client:' + cid, makeClient({
    id: cid, businessName: 'Real Fail Test', ownerEmail: cid + '@x.com',
    active: true, paymentStatus: 'trialing', trialEnabled: true,
    trial_end: String(sub.trial_end), stripeCustomerId: cust.id, stripeSubscriptionId: sub.id,
  }));

  // 6. Avanzar a dia 10.5 - aqui Stripe intenta cobrar con la tarjeta 4000000000000341
  const t10 = nowSec + Math.floor(10.5 * 86400);
  await stripe.testHelpers.testClocks.advance(tc.id, { frozen_time: t10 });
  await waitForClock(tc.id);

  const s10 = await stripe.subscriptions.retrieve(sub.id);
  sec('DIA 10.5 -- PRIMER COBRO (tarjeta 4000000000000341 -> insufficient_funds)');
  console.log('Status:', s10.status, 'past_due=', s10.past_due);
  console.log('Pause collection:', JSON.stringify(s10.pause_collection));

  // Obtener invoices
  const invs10 = await stripe.invoices.list({ customer: cust.id, limit: 10 });
  const inv10 = invs10.data.find(i => i.status !== 'draft') || invs10.data[0];
  console.log('Invoice:', inv10?.id, 'status=', inv10?.status, 'amount=', inv10?.amount_due, 'attempts=', inv10?.attempt_count);

  // Eventos
  const evs10 = await stripe.events.list({ limit: 20 });
  const paid10 = evs10.data.filter(e => e.type === 'invoice.paid');
  const failed10 = evs10.data.filter(e => e.type === 'invoice.payment_failed');
  const subUpd10 = evs10.data.filter(e => e.type === 'customer.subscription.updated');

  sec('EVENTOS DIA 10.5');
  paid10.forEach(e => { const i = e.data.object; console.log('  invoice.paid |', i.id, '| status=', i.status, '| amount=', i.amount_paid); });
  failed10.forEach(e => { const i = e.data.object; console.log('  invoice.payment_failed |', i.id, '| status=', i.status, '| attempts=', i.attempt_count); });
  subUpd10.forEach(e => { const o = e.data.object; console.log('  sub.updated | status=', o.status, '| past_due=', o.past_due); });

  console.log('\nRESULTADO DIA 10.5:');
  console.log('  invoice.payment_failed disparado:', failed10.length > 0 ? 'OK' : 'NO');
  console.log('  subscription.status:', s10.status);
  console.log('  subscription.past_due:', s10.past_due);

  if (failed10.length === 0) {
    console.log('\nWARNING: No hubo invoice.payment_failed. La tarjeta puede no haber sido probada.');
    console.log('Stripe puede haber guardado la tarjeta sin verificarla hasta el cargo real.');
  }

  // 7. Avanzar a dia 12 - segundo intento de cobro (retry schedule: 1 dia)
  const t12 = nowSec + Math.floor(12 * 86400);
  await stripe.testHelpers.testClocks.advance(tc.id, { frozen_time: t12 });
  await waitForClock(tc.id);

  const s12 = await stripe.subscriptions.retrieve(sub.id);
  sec('DIA 12 -- SEGUNDO INTENTO (retry)');
  console.log('Status:', s12.status, 'past_due=', s12.past_due);

  const evs12 = await stripe.events.list({ limit: 40 });
  const failed12 = evs12.data.filter(e => e.type === 'invoice.payment_failed');
  const subUpd12 = evs12.data.filter(e => e.type === 'customer.subscription.updated');

  console.log('invoice.payment_failed count:', failed12.length);
  failed12.forEach(e => { const i = e.data.object; console.log('  FAILED | inv=', i.id, '| attempts=', i.attempt_count, '| status=', i.status); });
  subUpd12.forEach(e => { const o = e.data.object; console.log('  sub.updated | status=', o.status, '| past_due=', o.past_due); });

  // 8. Avanzar a dia 20 - reintentos intermedios
  const t20 = nowSec + Math.floor(20 * 86400);
  await stripe.testHelpers.testClocks.advance(tc.id, { frozen_time: t20 });
  await waitForClock(tc.id);

  const s20 = await stripe.subscriptions.retrieve(sub.id);
  const evs20 = await stripe.events.list({ limit: 100 });
  const failed20 = evs20.data.filter(e => e.type === 'invoice.payment_failed');
  const unpaid20 = evs20.data.filter(e => e.type === 'customer.subscription.updated' && e.data.object.status === 'unpaid');
  const closed20 = evs20.data.filter(e => e.type === 'invoice.closed');

  sec('DIA 20 -- REINTENTOS INTERMEDIOS');
  console.log('Status:', s20.status, 'past_due=', s20.past_due);
  console.log('invoice.payment_failed:', failed20.length, 'eventos');
  console.log('subscription(unpaid):', unpaid20.length);
  console.log('invoice.closed:', closed20.length);
  failed20.forEach(e => { const i = e.data.object; console.log('  FAILED | inv=', i.id, '| attempts=', i.attempt_count, '| date=', new Date(e.created*1000).toISOString()); });

  // 9. Avanzar a dia 32 - ultimo intento
  const t32 = nowSec + Math.floor(32 * 86400);
  await stripe.testHelpers.testClocks.advance(tc.id, { frozen_time: t32 });
  await waitForClock(tc.id);

  const s32 = await stripe.subscriptions.retrieve(sub.id);
  const evs32 = await stripe.events.list({ limit: 200 });
  const failed32 = evs32.data.filter(e => e.type === 'invoice.payment_failed');
  const unpaid32 = evs32.data.filter(e => e.type === 'customer.subscription.updated' && e.data.object.status === 'unpaid');
  const closed32 = evs32.data.filter(e => e.type === 'invoice.closed');

  sec('DIA 32 -- ULTIMO INTENTO / UNPAID');
  console.log('Status:', s32.status, 'past_due=', s32.past_due);
  console.log('Pause collection:', JSON.stringify(s32.pause_collection));
  console.log('invoice.payment_failed:', failed32.length);
  console.log('subscription.updated(unpaid):', unpaid32.length);
  console.log('invoice.closed:', closed32.length);

  if (unpaid32.length > 0) {
    unpaid32.forEach(e => { const o = e.data.object; console.log('  UNPAID | sub=', o.id, '| date=', new Date(e.created*1000).toISOString()); });
  }

  // Calendario de reintentos
  sec('CALENDARIO DE REINTENTOS (observado)');
  const allFailed = evs32.data.filter(e => e.type === 'invoice.payment_failed');
  const allSubUpd = evs32.data.filter(e => e.type === 'customer.subscription.updated');
  const allUnpaid = allSubUpd.filter(e => e.data.object.status === 'unpaid');

  allFailed.forEach(e => {
    const i = e.data.object;
    const day = Math.round((e.created - nowSec) / 86400 * 10) / 10;
    console.log('  Dia +' + day + ' | inv=' + i.id + ' | attempts=' + i.attempt_count + ' | status=' + i.status + ' | date=' + new Date(e.created*1000).toISOString().slice(0,10));
  });

  console.log('\nRESUMEN FINAL:');
  console.log('  Tarjeta 4000000000000341 insuuficientes_fondos:', s10.status === 'active' && failed10.length === 0 ? 'TAL VEZ NO SE PROBO' : 'RECHAZO OK');
  console.log('  invoice.payment_failed count:', failed32.length);
  console.log('  Ultimo status:', s32.status);
  console.log('  Pasó a unpaid:', s32.status === 'unpaid' || unpaid32.length > 0 ? 'SI' : 'NO (status=' + s32.status + ')');

  await stripe.subscriptions.cancel(sub.id).catch(() => {});
  await stripe.customers.del(cust.id);
  await stripe.testHelpers.testClocks.del(tc.id);
  await mockRedis.del('client:' + cid);
  console.log('\nLimpieza OK');
}

testFailureReal().catch(console.error);
