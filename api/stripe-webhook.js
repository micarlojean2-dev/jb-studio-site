import Stripe from 'stripe';
import { Redis } from '@upstash/redis';

// Disable Vercel's body parser — Stripe needs the raw body to verify signature
export const config = { api: { bodyParser: false } };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const redis = new Redis({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end',  () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function getClientIdFromSubscription(subscriptionId) {
  if (!subscriptionId) return null;
  try {
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    return sub.metadata?.clientId || null;
  } catch {
    return null;
  }
}

async function updateClient(clientId, patch) {
  if (!clientId) return;
  try {
    const client = await redis.get(`client:${clientId}`);
    if (!client) { console.warn(`[stripe-webhook] client not found: ${clientId}`); return; }
    Object.assign(client, patch);
    await redis.set(`client:${clientId}`, client);
  } catch (err) {
    console.error(`[stripe-webhook] KV update failed for ${clientId}:`, err.message);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const sig    = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return res.status(500).json({ error: 'STRIPE_WEBHOOK_SECRET not set' });

  let event;
  try {
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err) {
    console.error('[stripe-webhook] Signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook signature invalid: ${err.message}` });
  }

  console.log(`[stripe-webhook] event: ${event.type}`);

  try {
    switch (event.type) {

      case 'invoice.paid': {
        const invoice = event.data.object;
        if (!invoice.subscription) break;
        const clientId = await getClientIdFromSubscription(invoice.subscription);
        if (!clientId) { console.warn('[stripe-webhook] invoice.paid: no clientId'); break; }

        const paidUntil = invoice.lines?.data?.[0]?.period?.end
          ? new Date(invoice.lines.data[0].period.end * 1000).toISOString().slice(0, 10)
          : null;

        await updateClient(clientId, {
          active:                 true,
          paymentFailed:          false,
          stripeCustomerId:       invoice.customer,
          stripeSubscriptionId:   invoice.subscription,
          paidUntil,
        });
        console.log(`[stripe-webhook] Client ${clientId} activated (paid until ${paidUntil})`);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        if (!invoice.subscription) break;
        const clientId = await getClientIdFromSubscription(invoice.subscription);
        if (!clientId) { console.warn('[stripe-webhook] payment_failed: no clientId'); break; }

        await updateClient(clientId, { active: false, paymentFailed: true });
        console.log(`[stripe-webhook] Client ${clientId} deactivated — payment failed`);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const clientId = sub.metadata?.clientId;
        if (!clientId) { console.warn('[stripe-webhook] subscription.deleted: no clientId'); break; }

        await updateClient(clientId, {
          active:              false,
          subscriptionEnded:   true,
          stripeSubscriptionId: null,
        });
        console.log(`[stripe-webhook] Client ${clientId} deactivated — subscription cancelled`);
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const clientId = sub.metadata?.clientId;
        if (!clientId) { console.warn('[stripe-webhook] subscription.updated: no clientId'); break; }

        const isActive = sub.status === 'active';
        await updateClient(clientId, {
          active:        isActive,
          paymentFailed: sub.status === 'past_due',
        });
        console.log(`[stripe-webhook] Client ${clientId} → ${sub.status}`);
        break;
      }

      default:
        // Ignore other event types
        break;
    }
  } catch (err) {
    console.error('[stripe-webhook] Handler error:', err.message);
    // Return 200 anyway — Stripe retries on non-2xx, don't cause retry loops
  }

  return res.status(200).json({ received: true });
}
