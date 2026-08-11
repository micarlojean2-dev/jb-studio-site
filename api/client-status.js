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
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET')   return res.status(405).json({ error: 'Method not allowed' });

  const clientId = req.query?.clientId;
  const token = req.query?.token || req.headers['x-admin-token'];

  if (!clientId || !/^[a-z0-9-]+$/.test(clientId)) {
    return res.status(400).json({ error: 'Valid clientId is required' });
  }

  try {
    const client = await redis.get(`client:${clientId}`);
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Auth verification: panelToken, adminToken, or test bypass
    const adminToken = process.env.ADMIN_TOKEN || '';
    const testBypassSecret = process.env.TEST_BYPASS_SECRET || '';
    const isTestBypass = testBypassSecret !== '' && req.headers['x-test-bypass'] === testBypassSecret;
    const isValidToken = isTestBypass ||
      (adminToken !== '' && token === adminToken) ||
      (client.panelToken && token === client.panelToken);

    if (!isValidToken) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Trial calculations
    const createdAtMs = client.createdAt ? Date.parse(client.createdAt) : Date.now();
    const trialDays = Number.isInteger(client.trialDays) ? client.trialDays : 10;
    const trialEndsAtMs = client.trialEndsAt ? Date.parse(client.trialEndsAt) : (createdAtMs + trialDays * 86400000);
    const trialEndsAtISO = new Date(trialEndsAtMs).toISOString();

    const now = Date.now();
    const trialDaysLeft = Math.max(0, Math.ceil((trialEndsAtMs - now) / 86400000));
    const isTrialing = trialDaysLeft > 0 && client.paymentStatus !== 'paid' && client.paymentStatus !== 'cancelled';

    // Payment method status from Stripe
    let hasPaymentMethod = false;
    if (client.stripeCustomerId && process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY !== 'sk_test_mock') {
      try {
        const pmList = await stripe.paymentMethods.list({
          customer: client.stripeCustomerId,
          type: 'card',
        });
        hasPaymentMethod = Array.isArray(pmList?.data) && pmList.data.length > 0;
      } catch (err) {
        console.error('[api/client-status] Failed to fetch payment methods:', err.message);
      }
    }

    return res.status(200).json({
      clientId: client.id,
      active: !!client.active,
      paymentStatus: client.paymentStatus || 'pending',
      plan: client.plan || 'basic',
      stripeCustomerId: client.stripeCustomerId || null,
      stripeSubscriptionId: client.stripeSubscriptionId || null,
      paidUntil: client.paidUntil || null,
      trial_end: trialEndsAtISO,
      trialDaysLeft,
      isTrialing,
      hasPaymentMethod,
    });
  } catch (err) {
    console.error('[api/client-status]', err.message);
    captureApiException(err, { clientId, feature: 'client_status', route: '/api/client-status' });
    return res.status(500).json({ error: 'Database error' });
  }
}

export const __test = {
  setRedisForTests(val) { redis = val; }
};
