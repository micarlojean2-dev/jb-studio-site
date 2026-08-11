import Stripe from 'stripe';
import { Redis } from '@upstash/redis';
import { initSentry, captureApiException } from '../lib/sentry.js';

initSentry();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_mock');
let redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { clientId } = req.body || {};
  if (!clientId || !/^[a-z0-9-]+$/.test(clientId)) {
    return res.status(400).json({ error: 'Valid clientId is required' });
  }

  try {
    const client = await redis.get(`client:${clientId}`);
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    if (!client.stripeCustomerId) {
      return res.status(400).json({
        error: 'no_stripe_customer',
        message: 'Este negocio no tiene una cuenta o suscripción de Stripe activa.'
      });
    }

    const returnUrl = `https://jbstudio.app/reservas/${encodeURIComponent(clientId)}`;

    const session = await stripe.billingPortal.sessions.create({
      customer: client.stripeCustomerId,
      return_url: returnUrl,
    });

    return res.status(200).json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('[api/create-portal-session]', err.message);
    captureApiException(err, { clientId, feature: 'stripe_portal', route: '/api/create-portal-session' });
    return res.status(500).json({ error: 'Failed to create billing portal session', details: err.message });
  }
}

export const __test = {
  setRedisForTests(val) { redis = val; }
};
