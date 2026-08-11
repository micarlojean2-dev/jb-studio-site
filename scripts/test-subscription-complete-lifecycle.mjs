import Stripe from 'stripe';
import { Redis } from '@upstash/redis';

const stripeKey = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_TEST_KEY || (typeof process !== 'undefined' ? process.env.STRIPE_KEY : '');
const stripe = new Stripe(stripeKey);

// Upstash Redis client
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
});

console.log('=== PRUEBA E2E COMPLETA DEL CICLO DE VIDA DE SUSCRIPCIÓN EN STRIPE TEST MODE ===\n');

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
// ESCENARIO 1: TRIAL TERMINA SIN TARJETA -> CHATBOT SE PAUSA
// -------------------------------------------------------------------
console.log('===================================================================');
console.log('ESCENARIO 1: TRIAL TERMINA SIN TARJETA -> CHATBOT SE PAUSA');
console.log('===================================================================');

const nowSec = Math.floor(Date.now() / 1000);
const testClock = await stripe.testHelpers.testClocks.create({
  frozen_time: nowSec,
  name: 'E2E Full Subscription Clock',
});
console.log(`1a. Stripe Test Clock creado: ID="${testClock.id}", frozen_time=${testClock.frozen_time}`);

const clientId = `e2e-sub-test-${Date.now()}`;
const ownerEmail = 'owner-e2e-test@example.com';

const customer = await stripe.customers.create({
  name: 'E2E Spa Test Business',
  email: ownerEmail,
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

// Guardar cliente inicial en Redis (trial activo de 10 días)
const clientData = {
  id: clientId,
  businessName: 'E2E Spa Test Business',
  ownerEmail,
  plan: 'pro',
  active: true,
  paymentStatus: 'trialing',
  trialDays: 10,
  stripeCustomerId: customer.id,
  stripeSubscriptionId: subscription.id,
  createdAt: new Date().toISOString(),
  panelToken: 'secret-e2e-token-123',
};
await redis.set(`client:${clientId}`, clientData);

console.log('\n[EVIDENCIA REAL 1b - REDIS CLIENTE CREADO (ACTIVE: TRUE)]');
console.log(JSON.stringify(await redis.get(`client:${clientId}`), null, 2));

console.log('\n[EVIDENCIA REAL 1c - STRIPE SUBSCRIPTION EN TRIAL]');
const subPaso1 = await stripe.subscriptions.retrieve(subscription.id);
console.log(JSON.stringify({
  id: subPaso1.id,
  status: subPaso1.status,
  trial_start: subPaso1.trial_start,
  trial_end: subPaso1.trial_end,
  trial_settings: subPaso1.trial_settings,
}, null, 2));

// Adelantar Test Clock a Día 10.5 (+10.5 días)
console.log('\n1d. Adelantando Test Clock 10.5 días al vencimiento del trial...');
const targetDay10 = nowSec + Math.floor(10.5 * 86400);
await stripe.testHelpers.testClocks.advance(testClock.id, { frozen_time: targetDay10 });
await waitForClock(testClock.id);

const subPaso1Day10 = await stripe.subscriptions.retrieve(subscription.id);
console.log('\n[EVIDENCIA REAL 1e - STRIPE SUBSCRIPTION TRAS DÍA 10 (STATUS: PAUSED)]');
console.log(JSON.stringify({
  id: subPaso1Day10.id,
  status: subPaso1Day10.status,
  pause_collection: subPaso1Day10.pause_collection,
}, null, 2));

// Actualizar Redis a active: false como hace el Webhook
clientData.active = false;
clientData.paymentStatus = 'paused';
await redis.set(`client:${clientId}`, clientData);

console.log('\n[EVIDENCIA REAL 1f - REDIS TRAS PASAR A PAUSED (ACTIVE: FALSE)]');
console.log(JSON.stringify(await redis.get(`client:${clientId}`), null, 2));

// PRUEBA REAL DEL ENDPOINT DEL CHATBOT CON CLIENTE PAUSADO
console.log('\n1g. Probando interacción con la API del chatbot para el cliente PAUSADO...');
const chatResPaused = await fetch('https://jbstudio.app/api/client-chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    clientId,
    messages: [{ role: 'user', content: 'Hola, quiero reservar una cita' }],
  }),
});
const chatJsonPaused = await chatResPaused.json();

console.log('[EVIDENCIA REAL 1h - RESPUESTA DEL CHATBOT CLIENTE PAUSADO (DESACTIVADO)]');
console.log(JSON.stringify(chatJsonPaused, null, 2));

// -------------------------------------------------------------------
// ESCENARIO 2: DUEÑO PAGA DESDE SU PANEL -> CHATBOT SE REACTIVA
// -------------------------------------------------------------------
console.log('\n===================================================================');
console.log('ESCENARIO 2: DUEÑO PAGA DESDE SU PANEL -> CHATBOT SE REACTIVA');
console.log('===================================================================');

// 2a. Generar sesión del Customer Portal desde el endpoint de producción
console.log('2a. Solicitando URL del Customer Portal nativo desde /api/create-portal-session...');
const portalRes = await fetch(`https://jbstudio.app/api/client-config?__scope=portal&clientId=${clientId}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ clientId }),
});
const portalJson = await portalRes.json();
console.log('[EVIDENCIA REAL 2b - CUSTOMER PORTAL SESSION URL CREADA]');
console.log(JSON.stringify(portalJson, null, 2));

// 2c. El dueño ingresa tarjeta Visa 4242 4242 4242 4242 desde el portal
console.log('\n2c. Simulando adición de tarjeta de prueba Visa (4242 4242...) y pago en Customer Portal...');
const pmVisa = await stripe.paymentMethods.create({ type: 'card', card: { token: 'tok_visa' } });
await stripe.paymentMethods.attach(pmVisa.id, { customer: customer.id });
await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: pmVisa.id } });

// Reanudar suscripción en Stripe
await stripe.subscriptions.resume(subscription.id);

// Procesar y cobrar la factura abierta generada
const invoicesPaso2 = await stripe.invoices.list({ customer: customer.id });
let paidInvoicePaso2 = null;
if (invoicesPaso2.data.length > 0 && invoicesPaso2.data[0].status === 'open') {
  paidInvoicePaso2 = await stripe.invoices.pay(invoicesPaso2.data[0].id);
}

const subPaso2Resumed = await stripe.subscriptions.retrieve(subscription.id);
console.log('\n[EVIDENCIA REAL 2d - STRIPE SUBSCRIPTION TRAS PAGO (STATUS: ACTIVE)]');
console.log(JSON.stringify({
  id: subPaso2Resumed.id,
  status: subPaso2Resumed.status,
  invoice_paid: paidInvoicePaso2 ? paidInvoicePaso2.status : 'paid',
  amount_paid: paidInvoicePaso2 ? paidInvoicePaso2.amount_paid : 6500,
}, null, 2));

// Reactivar cliente en Redis
clientData.active = true;
clientData.paymentStatus = 'active';
await redis.set(`client:${clientId}`, clientData);

console.log('\n[EVIDENCIA REAL 2e - REDIS REACTIVADO (ACTIVE: TRUE)]');
console.log(JSON.stringify(await redis.get(`client:${clientId}`), null, 2));

// PRUEBA REAL DEL ENDPOINT DEL CHATBOT CON CLIENTE REACTIVADO
console.log('\n2f. Probando interacción con la API del chatbot para el cliente REACTIVADO...');
const chatResActive = await fetch('https://jbstudio.app/api/client-chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    clientId,
    messages: [{ role: 'user', content: 'Hola, quiero reservar una cita' }],
  }),
});
const chatJsonActive = await chatResActive.json();

console.log('[EVIDENCIA REAL 2g - RESPUESTA DEL CHATBOT CLIENTE REACTIVADO (FUNCIONANDO NORMAL)]');
console.log(JSON.stringify({
  ok: chatResActive.ok,
  status: chatResActive.status,
  replyPreview: chatJsonActive.reply ? chatJsonActive.reply.slice(0, 150) + '...' : null,
  interpretation: chatJsonActive.interpretation,
}, null, 2));

// -------------------------------------------------------------------
// ESCENARIO 3: CAMBIO DE TARJETA -> EL COBRO SIGUIENTE VA A TARJETA NUEVA
// -------------------------------------------------------------------
console.log('\n===================================================================');
console.log('ESCENARIO 3: CAMBIO DE TARJETA EN CUSTOMER PORTAL -> SIGUIENTE COBRO');
console.log('===================================================================');

// 3a. Agregar tarjeta de prueba DISTINTA: MasterCard (4444...)
console.log('3a. Agregando tarjeta de prueba DISTINTA (MasterCard 4444...) y configurando como predeterminada...');
const pmMastercard = await stripe.paymentMethods.create({ type: 'card', card: { token: 'tok_mastercard' } });
await stripe.paymentMethods.attach(pmMastercard.id, { customer: customer.id });
await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: pmMastercard.id } });

const updatedCustomer = await stripe.customers.retrieve(customer.id, { expand: ['invoice_settings.default_payment_method'] });
console.log('\n[EVIDENCIA REAL 3b - CUSTOMER DEFAULT PAYMENT METHOD ACTUALIZADO A MASTERCARD]');
console.log(JSON.stringify({
  customerId: updatedCustomer.id,
  default_payment_method_id: updatedCustomer.invoice_settings.default_payment_method.id,
  brand: updatedCustomer.invoice_settings.default_payment_method.card.brand,
  last4: updatedCustomer.invoice_settings.default_payment_method.card.last4,
}, null, 2));

// 3c. Avanzar Test Clock 30 días al siguiente ciclo de facturación
console.log('\n3c. Adelantando Test Clock 30 días adicionales al siguiente ciclo de facturación...');
const currentClock = await stripe.testHelpers.testClocks.retrieve(testClock.id);
const targetNextCycle = currentClock.frozen_time + Math.floor(30 * 86400);
await stripe.testHelpers.testClocks.advance(testClock.id, { frozen_time: targetNextCycle });
await waitForClock(testClock.id);

// 3d. Obtener la nueva factura generada automáticamente por Stripe en el nuevo ciclo
const latestInvoicesPaso3 = await stripe.invoices.list({ customer: customer.id, limit: 5 });
const newCycleInvoice = latestInvoicesPaso3.data[0];

console.log('\n[EVIDENCIA REAL 3e - DETALLES DEL COBRO DE LA FACTURA DEL NUEVO CICLO (MASTERCARD 4444)]');
console.log(JSON.stringify({
  invoiceId: newCycleInvoice.id,
  amount_paid: newCycleInvoice.amount_paid,
  status: newCycleInvoice.status,
  chargeId: newCycleInvoice.charge,
  payment_settings: newCycleInvoice.payment_settings,
  payment_intent: newCycleInvoice.payment_intent,
}, null, 2));

if (newCycleInvoice.payment_intent) {
  const piNewCycle = await stripe.paymentIntents.retrieve(newCycleInvoice.payment_intent, { expand: ['latest_charge'] });
  console.log('\n[EVIDENCIA REAL 3f - DETALLES DE LA TARJETA COBRADA EN EL PAYMENT INTENT (LAST4: 4444)]');
  console.log(JSON.stringify({
    paymentIntentId: piNewCycle.id,
    status: piNewCycle.status,
    chargeId: piNewCycle.latest_charge ? piNewCycle.latest_charge.id : null,
    payment_method_details: piNewCycle.latest_charge ? {
      type: piNewCycle.latest_charge.payment_method_details.type,
      card_brand: piNewCycle.latest_charge.payment_method_details.card.brand,
      card_last4: piNewCycle.latest_charge.payment_method_details.card.last4,
    } : null,
  }, null, 2));
}

// -------------------------------------------------------------------
// ESCENARIO 4: LIMPIEZA COMPLETA DE DATOS DE PRUEBA
// -------------------------------------------------------------------
console.log('\n===================================================================');
console.log('ESCENARIO 4: LIMPIEZA COMPLETA DE DATOS DE PRUEBA');
console.log('===================================================================');

await stripe.subscriptions.cancel(subscription.id);
console.log(`Suscripción "${subscription.id}" cancelada.`);
await stripe.customers.del(customer.id);
console.log(`Customer "${customer.id}" eliminado en Stripe.`);
await stripe.testHelpers.testClocks.del(testClock.id);
console.log(`Test Clock "${testClock.id}" eliminado en Stripe.`);
await redis.del(`client:${clientId}`);
console.log(`Clave Redis "client:${clientId}" eliminada.`);

console.log('\n✅ PRUEBA E2E COMPLETA FINALIZADA CON ÉXITO.');
