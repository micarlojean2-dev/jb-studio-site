import Stripe from 'stripe';
import handler, { __test } from '../api/create-portal-session.js';

console.log('=== PRUEBA REAL EN MODO TEST DE STRIPE CUSTOMER PORTAL ===\n');

// 1. Iniciar Stripe SDK con la API Key real de Modo Test
const stripeKey = process.env.STRIPE_SECRET_KEY;
if (!stripeKey) {
  console.error('STRIPE_SECRET_KEY env var not set');
  process.exit(1);
}
const stripe = new Stripe(stripeKey);

// 2. Crear un Customer de prueba real en el dashboard de Stripe (Modo Test)
const customer = await stripe.customers.create({
  email: 'dueno.barberia.e2e@example.com',
  name: 'Dueño Barbería E2E Portal Test',
  metadata: { clientId: 'barberia-portal-real' }
});

console.log(`1. Stripe Customer creado exitosamente en Modo Test:`);
console.log(`   Customer ID: "${customer.id}"`);
console.log(`   Email: "${customer.email}"`);

// 3. Mock Redis local inyectado al handler de api/create-portal-session.js
const redisStore = new Map();
const clientId = 'barberia-portal-real';
const clientData = {
  id: clientId,
  businessName: 'Barbería El Corte Fino (Portal Test)',
  ownerEmail: 'dueno.barberia.e2e@example.com',
  active: true,
  stripeCustomerId: customer.id
};
redisStore.set(`client:${clientId}`, clientData);

__test.setRedisForTests({
  get: async (key) => redisStore.get(key) || null
});

// 4. Invocar POST /api/create-portal-session
let statusCode = 0;
let responseBody = null;

await handler({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: { clientId }
}, {
  setHeader() {},
  status(c) { statusCode = c; return this; },
  json(b) { responseBody = b; return this; }
});

console.log(`\n2. Respuesta de POST /api/create-portal-session (HTTP ${statusCode}):`);
console.log(JSON.stringify(responseBody, null, 2));

if (statusCode === 200 && responseBody?.url) {
  console.log('\n================================================================');
  console.log('✅ URL REAL DEL STRIPE CUSTOMER PORTAL GENERADA EXITOSAMENTE:');
  console.log(responseBody.url);
  console.log('================================================================\n');
} else {
  console.error('\n❌ Error al generar la sesión del Customer Portal:', responseBody);
}
