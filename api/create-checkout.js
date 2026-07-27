import Stripe from 'stripe';
import { Redis } from '@upstash/redis';
import { initSentry, captureApiException } from '../lib/sentry.js';

initSentry();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const APP_URL = 'https://jbstudio.app';

// Plan único: JB Studio Pro, $65/mes, 7 días de prueba. El precio SIEMPRE se
// toma del servidor (STRIPE_PRO_PRICE_ID), nunca de lo que mande el navegador.
const PRO_PRICE_ID = () => process.env.STRIPE_PRO_PRICE_ID;
const TRIAL_DAYS = 7;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  APP_URL);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  // Admin-only: tanto el enlace de prueba como la sesión del Customer Portal
  // los genera el administrador para el clientId correcto.
  const token = req.headers['x-admin-token'];
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN)
    return res.status(401).json({ error: 'Unauthorized' });

  const { clientId } = req.body || {};
  if (!clientId || !/^[a-z0-9-]+$/.test(clientId))
    return res.status(400).json({ error: 'Invalid clientId' });

  const action = req.query?.action || req.body?.action || 'checkout';

  try {
    const client = await redis.get(`client:${clientId}`);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    // ── Customer Portal: sesión NUEVA (nunca un enlace permanente) para el
    //    stripeCustomerId del cliente. Cancelar / actualizar tarjeta / facturas
    //    los gestiona Stripe, no JB Studio. ─────────────────────────────────
    if (action === 'portal') {
      if (!client.stripeCustomerId)
        return res.status(400).json({ error: 'Client has no Stripe customer yet' });
      const portal = await stripe.billingPortal.sessions.create({
        customer:   client.stripeCustomerId,
        return_url: `${APP_URL}/admin`,
      });
      return res.status(200).json({ url: portal.url });
    }

    const priceId = PRO_PRICE_ID();
    if (!priceId)
      return res.status(500).json({ error: 'STRIPE_PRO_PRICE_ID not configured' });

    // ── Anti doble-clic: si ya hay una Checkout Session abierta para este
    //    cliente, se reutiliza en vez de crear otra usable. Una recarga de
    //    success.html tampoco crea nada nuevo. ──────────────────────────────
    if (client.stripeCheckoutSessionId) {
      try {
        const existing = await stripe.checkout.sessions.retrieve(client.stripeCheckoutSessionId);
        if (existing && existing.status === 'open' && existing.url)
          return res.status(200).json({ url: existing.url, sessionId: existing.id, reused: true });
      } catch { /* sesión vieja/expirada: se crea una nueva abajo */ }
    }

    const session = await stripe.checkout.sessions.create({
      mode:                 'subscription',
      payment_method_types: ['card'],
      line_items:           [{ price: priceId, quantity: 1 }],
      client_reference_id:  clientId,
      customer_email:       client.ownerEmail || undefined,
      // La tarjeta se pide siempre, aunque el primer cobro sea tras el trial.
      payment_method_collection: 'always',
      metadata:             { clientId, businessName: client.businessName || '', plan: 'pro' },
      subscription_data:    {
        trial_period_days: TRIAL_DAYS,
        metadata: { clientId, businessName: client.businessName || '', plan: 'pro' },
      },
      success_url: `${APP_URL}/success?client=${encodeURIComponent(clientId)}`,
      cancel_url:  `${APP_URL}/cancel`,
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
