import Stripe from 'stripe';
import { Redis } from '@upstash/redis';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const redis = new Redis({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const PRICE_IDS = {
  basic:   process.env.STRIPE_PRICE_BASIC,
  pro:     process.env.STRIPE_PRICE_PRO,
  premium: process.env.STRIPE_PRICE_PREMIUM,
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

  const { clientId, plan } = req.body || {};
  if (!clientId || !/^[a-z0-9-]+$/.test(clientId))
    return res.status(400).json({ error: 'Invalid clientId' });
  if (!['basic', 'pro', 'premium'].includes(plan))
    return res.status(400).json({ error: 'plan must be basic, pro, or premium' });

  const priceId = PRICE_IDS[plan];
  if (!priceId)
    return res.status(500).json({ error: `STRIPE_PRICE_${plan.toUpperCase()} env var not set` });

  try {
    const client = await redis.get(`client:${clientId}`);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const session = await stripe.checkout.sessions.create({
      mode:                 'subscription',
      payment_method_types: ['card'],
      line_items:           [{ price: priceId, quantity: 1 }],
      client_reference_id:  clientId,
      metadata:             { clientId },
      subscription_data:    { metadata: { clientId } },
      success_url: `https://jbstudio.app/success?client=${encodeURIComponent(clientId)}`,
      cancel_url:  'https://jbstudio.app/cancel',
    });

    return res.status(200).json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('[api/create-checkout]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
