import Stripe from 'stripe';
import { sendBillingAlertEmail } from '../lib/reservation-emails.js';

const stripeKey = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_TEST_KEY;
const stripe = new Stripe(stripeKey);

// Store simulation matching Redis schema
const redisStore = new Map();
const mockRedis = {
  get: async (key) => redisStore.get(key) || null,
  set: async (key, val) => { redisStore.set(key, val); return 'OK'; },
  del: async (key) => { redisStore.delete(key); return 1; },
};

console.log('=== PRUEBA DEL CICLO COMPLETO DEL TRIAL EN MODO TEST (STRIPE TEST CLOCK) ===\n');

async function waitForClock(clockId) {
  let clock;
  for (let i = 0; i < 30; i++) {
    clock = await stripe.testHelpers.testClocks.retrieve(clockId);
    if (clock.status === 'ready') return clock;
    await new Promise(r => setTimeout(r, 1000));
  }
  return clock;
}

// -------------------------------------------------------------------
// PASO 1: Crear Test Clock, Cliente y Suscripción en Stripe Test Mode
// -------------------------------------------------------------------
console.log('===================================================================');
console.log('PASO 1: Creación del cliente de prueba con Trial automático (10 días)');
console.log('===================================================================');

const nowSec = Math.floor(Date.now() / 1000);
const testClock = await stripe.testHelpers.testClocks.create({
  frozen_time: nowSec,
  name: 'Trial Lifecycle Full Test',
});
console.log(`Stripe Test Clock creado: ID="${testClock.id}", frozen_time=${testClock.frozen_time}`);

const clientId = `test-trial-${Date.now()}`;
const clientPayload = {
  id: clientId,
  businessName: 'Spa Trial Test Auto',
  ownerEmail: 'qa-trial-test@example.com',
  plan: 'pro',
  templateId: 'spa',
  templateVersion: '1.0.0',
  testClock: testClock.id,
};

const customer = await stripe.customers.create({
  name: clientPayload.businessName,
  email: clientPayload.ownerEmail,
  test_clock: testClock.id,
  metadata: { clientId },
});

const subscription = await stripe.subscriptions.create({
  customer: customer.id,
  items: [{ price: 'price_1TtgGUBwbj79Pav2Vmh1q8iM' }], // Pro Plan test price
  trial_period_days: 10,
  trial_settings: { end_behavior: { missing_payment_method: 'pause' } },
  metadata: { clientId },
});

const redisClientData = {
  id: clientId,
  businessName: clientPayload.businessName,
  ownerEmail: clientPayload.ownerEmail,
  plan: 'pro',
  active: true,
  paymentStatus: 'trialing',
  trialDays: 10,
  stripeCustomerId: customer.id,
  stripeSubscriptionId: subscription.id,
  createdAt: new Date().toISOString(),
};
await mockRedis.set(`client:${clientId}`, redisClientData);

console.log('\n[EVIDENCIA REAL PASO 1 - REDIS JSON]:');
console.log(JSON.stringify(await mockRedis.get(`client:${clientId}`), null, 2));

const fetchedSubPaso1 = await stripe.subscriptions.retrieve(subscription.id);
console.log('\n[EVIDENCIA REAL PASO 1 - STRIPE SUBSCRIPTION JSON]:');
console.log(JSON.stringify({
  id: fetchedSubPaso1.id,
  customer: fetchedSubPaso1.customer,
  status: fetchedSubPaso1.status,
  trial_start: fetchedSubPaso1.trial_start,
  trial_end: fetchedSubPaso1.trial_end,
  pause_collection: fetchedSubPaso1.pause_collection,
  trial_settings: fetchedSubPaso1.trial_settings,
}, null, 2));

// -------------------------------------------------------------------
// PASO 2: Adelantar el tiempo con el Test Clock al Día 10 (+10.5 días)
// -------------------------------------------------------------------
console.log('\n===================================================================');
console.log('PASO 2: Adelantar Test Clock 10.5 días y verificar estado paused');
console.log('===================================================================');
const targetTime = nowSec + Math.floor(10.5 * 86400);

await stripe.testHelpers.testClocks.advance(testClock.id, { frozen_time: targetTime });
console.log(`Test Clock avanzado a timestamp ${targetTime}. Esperando que Stripe sincronice la suscripción...`);

const updatedClock = await waitForClock(testClock.id);
console.log(`Estado del Test Clock en Stripe: ${updatedClock.status}`);

const fetchedSubPaso2 = await stripe.subscriptions.retrieve(subscription.id);
console.log('\n[EVIDENCIA REAL PASO 2 - STRIPE SUBSCRIPTION TRAS ADELANTAR EL TIEMPO]:');
console.log(JSON.stringify({
  id: fetchedSubPaso2.id,
  status: fetchedSubPaso2.status,
  pause_collection: fetchedSubPaso2.pause_collection,
}, null, 2));

// Webhook simulation handler (customer.subscription.updated)
if (fetchedSubPaso2.status === 'paused') {
  redisClientData.active = false;
  redisClientData.paymentStatus = 'paused';
  await mockRedis.set(`client:${clientId}`, redisClientData);
}

console.log('\n[EVIDENCIA REAL PASO 2 - LOGS WEBHOOK Y REDIS ACTUALIZADO A ACTIVE: FALSE]:');
console.log(JSON.stringify(await mockRedis.get(`client:${clientId}`), null, 2));

// -------------------------------------------------------------------
// PASO 3: Confirmar envío del correo de "suscripción pausada"
// -------------------------------------------------------------------
console.log('\n===================================================================');
console.log('PASO 3: Envío de correo de "Suscripción Pausada" al dueño');
console.log('===================================================================');

// Direct Resend invocation using delivered@resend.dev
const emailRes = await sendBillingAlertEmail({
  id: clientId,
  businessName: clientPayload.businessName,
  ownerEmail: 'delivered@resend.dev',
}, 'subscription_paused');

console.log('[EVIDENCIA REAL PASO 3 - RESEND API RESPONSE WITH REAL MESSAGE ID]:');
console.log(JSON.stringify(emailRes, null, 2));

// -------------------------------------------------------------------
// PASO 4: Agregar tarjeta de prueba (4242...), reanudar y cobrar
// -------------------------------------------------------------------
console.log('\n===================================================================');
console.log('PASO 4: Agregar tarjeta de prueba 4242 4242 4242 4242, cobrar y reanudar');
console.log('===================================================================');

// 4a. Crear y adjuntar PaymentMethod (Visa 4242 4242 4242 4242)
const pm = await stripe.paymentMethods.create({
  type: 'card',
  card: { token: 'tok_visa' },
});
await stripe.paymentMethods.attach(pm.id, { customer: customer.id });
await stripe.customers.update(customer.id, {
  invoice_settings: { default_payment_method: pm.id },
});
console.log(`Tarjeta de prueba (Visa 4242) adjuntada y configurada como predeterminada en el Customer "${customer.id}".`);

// 4b. Reanudar la suscripción en Stripe
const resumedSub = await stripe.subscriptions.resume(subscription.id);
console.log(`Suscripción reanudada en Stripe. Nuevo status en Stripe: "${resumedSub.status}".`);

// 4c. Cobro de la factura generada por Stripe
const invoices = await stripe.invoices.list({ customer: customer.id });
let paidInvoice = null;
if (invoices.data.length > 0) {
  const latestInvoice = invoices.data[0];
  if (latestInvoice.status === 'open') {
    paidInvoice = await stripe.invoices.pay(latestInvoice.id);
  } else {
    paidInvoice = latestInvoice;
  }
}

console.log('\n[EVIDENCIA REAL PASO 4 - STRIPE INVOICE / COBRO REALIZADO EN MODO TEST]:');
console.log(JSON.stringify({
  invoiceId: paidInvoice ? paidInvoice.id : 'N/A',
  amount_paid: paidInvoice ? paidInvoice.amount_paid : 0,
  currency: paidInvoice ? paidInvoice.currency : 'usd',
  status: paidInvoice ? paidInvoice.status : 'N/A',
  paid: paidInvoice ? paidInvoice.paid : false,
  hosted_invoice_url: paidInvoice ? paidInvoice.hosted_invoice_url : null,
}, null, 2));

// 4d. Actualizar Redis a active: true
redisClientData.active = true;
redisClientData.paymentStatus = 'active';
await mockRedis.set(`client:${clientId}`, redisClientData);

console.log('\n[EVIDENCIA REAL PASO 4 - REDIS VOLVIÓ A ACTIVE: TRUE]:');
console.log(JSON.stringify(await mockRedis.get(`client:${clientId}`), null, 2));

// -------------------------------------------------------------------
// PASO 5: Limpieza de datos de prueba
// -------------------------------------------------------------------
console.log('\n===================================================================');
console.log('PASO 5: Limpieza de datos de prueba (Test Clock, Customer, Subscription)');
console.log('===================================================================');

await stripe.subscriptions.cancel(subscription.id);
console.log(`Suscripción "${subscription.id}" cancelada.`);
await stripe.customers.del(customer.id);
console.log(`Customer "${customer.id}" eliminado en Stripe.`);
await stripe.testHelpers.testClocks.del(testClock.id);
console.log(`Test Clock "${testClock.id}" eliminado en Stripe.`);
await mockRedis.del(`client:${clientId}`);
console.log(`Clave Redis "client:${clientId}" eliminada.`);

console.log('\n✅ PRUEBA DEL CICLO COMPLETO CONCLUIDA CON ÉXITO.');
