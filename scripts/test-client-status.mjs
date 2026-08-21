import Stripe from 'stripe';
import handler, { __test } from '../api/client-status.js';

console.log('=== PRUEBA DE REAL DE API/CLIENT-STATUS EN CLIENTE EN TRIAL ===\n');

const stripeKey = process.env.STRIPE_SECRET_KEY;
if (!stripeKey) {
  console.error('STRIPE_SECRET_KEY env var not set');
  process.exit(1);
}
const stripe = new Stripe(stripeKey);

// 1. Crear un Customer en Stripe Test Mode
const customer = await stripe.customers.create({
  email: 'dueno.trial.status@example.com',
  name: 'Dueño Trial Status Test',
  metadata: { clientId: 'barberia-trial-status' }
});

console.log(`1. Stripe Customer de prueba creado: "${customer.id}"`);

// 2. Crear datos de cliente en trial (7 días restantes)
const clientId = 'barberia-trial-status';
const panelToken = 'token-panel-secret-12345';
const clientData = {
  id: clientId,
  businessName: 'Barbería Trial Status Test',
  ownerEmail: 'dueno.trial.status@example.com',
  active: false,
  paymentStatus: 'pending',
  plan: 'pro',
  panelToken: panelToken,
  createdAt: new Date().toISOString(),
  trialDays: 7,
  stripeCustomerId: customer.id
};

__test.setRedisForTests({
  get: async (key) => key === `client:${clientId}` ? clientData : null
});

// 3. Invocar GET /api/client-status
let statusCode = 0;
let responseBody = null;

await handler({
  method: 'GET',
  query: { clientId, token: panelToken },
  headers: {}
}, {
  setHeader() {},
  status(c) { statusCode = c; return this; },
  json(b) { responseBody = b; return this; }
});

console.log(`\n2. Respuesta HTTP de GET /api/client-status: ${statusCode}`);
console.log('   JSON Devuelto:', JSON.stringify(responseBody, null, 2));

if (statusCode === 200 && responseBody?.isTrialing) {
  console.log('\n✅ ÉXITO TOTAL: api/client-status respondió correctamente calculando los días de trial y el estado de método de pago.');
} else {
  console.error('\n❌ ERROR en api/client-status:', responseBody);
}
