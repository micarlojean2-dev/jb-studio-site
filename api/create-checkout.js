import Stripe from 'stripe';
import { Redis } from '@upstash/redis';
import { initSentry, captureApiException } from '../lib/sentry.js';

initSentry();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Fase 4: estaba usando KV_REST_API_URL/TOKEN, que no existen como variables
// de entorno en este proyecto de Vercel (mismo bug encontrado y corregido en
// api/client-config.js durante la Fase 3) — este endpoint fallaba siempre al
// tocar Redis. Corregido para usar el mismo par que el resto de la API.
const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Fase 4: solo Básico y Pro tienen Price ID real — Premium queda fuera del
// checkout (el spec pide únicamente estos dos planes, sin crear un tercero).
const PRICE_IDS = {
  basic: process.env.STRIPE_PRICE_BASIC,
  pro:   process.env.STRIPE_PRICE_PRO,
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  'https://jbstudio.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  // Admin-only
  const token = req.headers['x-admin-token'];
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN)
    return res.status(401).json({ error: 'Unauthorized' });

  const { clientId } = req.body || {};
  if (!clientId || !/^[a-z0-9-]+$/.test(clientId))
    return res.status(400).json({ error: 'Invalid clientId' });

  try {
    const client = await redis.get(`client:${clientId}`);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    // El Price ID se elige siempre a partir del plan guardado en el cliente
    // (nunca de lo que mande el request) — así el precio cobrado coincide
    // siempre con el plan real, sin depender de lo que envíe admin.html.
    const priceId = PRICE_IDS[client.plan];
    if (!priceId)
      return res.status(400).json({ error: `Client plan "${client.plan}" has no Stripe price configured` });

    const session = await stripe.checkout.sessions.create({
      mode:                 'subscription',
      payment_method_types: ['card'],
      line_items:           [{ price: priceId, quantity: 1 }],
      client_reference_id:  clientId,
      customer_email:       client.ownerEmail || undefined,
      metadata:             { clientId },
      subscription_data:    { metadata: { clientId } },
      success_url: `https://jbstudio.app/success?client=${encodeURIComponent(clientId)}`,
      cancel_url:  'https://jbstudio.app/cancel',
    });

    await redis.set(`client:${clientId}`, Object.assign({}, client, {
      stripeCheckoutSessionId: session.id,
    }));

    return res.status(200).json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('[api/create-checkout]', err.message);
    captureApiException(err, { clientId, feature: 'billing', route: '/api/create-checkout' });
    return res.status(500).json({ error: err.message });
  }
}
