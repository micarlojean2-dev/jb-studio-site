import Stripe from 'stripe';
import { Redis } from '@upstash/redis';

// Disable Vercel's body parser — Stripe needs the raw body to verify signature
export const config = { api: { bodyParser: false } };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Fase 4: estaba usando KV_REST_API_URL/TOKEN, que no existen como variables
// de entorno en este proyecto (mismo bug corregido en api/client-config.js y
// api/create-checkout.js) — el webhook fallaba siempre al tocar Redis.
const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const EVENT_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 días — muy por encima de la ventana de reintentos de Stripe

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end',  () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ── Idempotencia ──────────────────────────────────────────────────────────
// SET ... NX es atómico: si la key ya existía, Stripe ya reenvió este evento
// (reintento o doble entrega) y no se debe procesar de nuevo.
async function markEventProcessed(eventId) {
  const key = `stripe_event:${eventId}`;
  const result = await redis.set(key, '1', { nx: true, ex: EVENT_TTL_SECONDS });
  return result !== null; // true = primera vez que se ve este evento
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
    console.error(`[stripe-webhook] Redis update failed for ${clientId}:`, err.message);
  }
}

function isoDate(unixSeconds) {
  return unixSeconds ? new Date(unixSeconds * 1000).toISOString().slice(0, 10) : null;
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

  console.log(`[stripe-webhook] event: ${event.type} (${event.id})`);

  // ── Idempotencia: si ya se procesó este event.id, responder 200 sin repetir ──
  let isNewEvent = true;
  try {
    isNewEvent = await markEventProcessed(event.id);
  } catch (err) {
    console.error('[stripe-webhook] idempotency check failed:', err.message);
    // Si Redis falla aquí, seguimos procesando de todas formas — es mejor
    // arriesgar un reproceso raro que perder el evento por completo.
  }
  if (!isNewEvent) {
    console.log(`[stripe-webhook] duplicate event ${event.id} — skipped`);
    return res.status(200).json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {

      // ── 1. Checkout completado ──────────────────────────────────────────
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.mode !== 'subscription') break;
        const clientId = session.metadata?.clientId || session.client_reference_id;
        if (!clientId) { console.warn('[stripe-webhook] checkout.session.completed: no clientId'); break; }

        const patch = {
          stripeCustomerId:        session.customer || null,
          stripeSubscriptionId:    session.subscription || null,
          stripeCheckoutSessionId: session.id,
        };

        // Solo se marca como pagado si Stripe confirma el pago en la propia
        // sesión — "no marcar como pagado solo porque se abrió Checkout".
        // Si no, el estado lo termina de resolver invoice.paid /
        // customer.subscription.updated cuando llegue.
        if (session.payment_status === 'paid' || session.payment_status === 'no_payment_required') {
          patch.active            = true;
          patch.paymentStatus     = 'paid';
          patch.paymentFailed     = false;
          patch.gracePeriodEndsAt = null;
        }

        await updateClient(clientId, patch);
        console.log(`[stripe-webhook] Client ${clientId} checkout completed (payment_status=${session.payment_status})`);
        break;
      }

      // ── 2. Pago de factura exitoso ───────────────────────────────────────
      case 'invoice.paid': {
        const invoice = event.data.object;
        if (!invoice.subscription) break;
        const clientId = await getClientIdFromSubscription(invoice.subscription);
        if (!clientId) { console.warn('[stripe-webhook] invoice.paid: no clientId'); break; }

        const periodEnd = invoice.lines?.data?.[0]?.period?.end || null;
        const paidUntil = isoDate(periodEnd);

        await updateClient(clientId, {
          active:                true,
          paymentStatus:         'paid',
          paymentFailed:         false,
          stripeCustomerId:      invoice.customer,
          stripeSubscriptionId:  invoice.subscription,
          lastPaymentAt:         isoDate(invoice.status_transitions?.paid_at) || new Date().toISOString().slice(0, 10),
          nextPaymentAt:         paidUntil,
          paidUntil,
          gracePeriodEndsAt:     null,
        });
        console.log(`[stripe-webhook] Client ${clientId} paid — active until ${paidUntil}`);
        break;
      }

      // ── 3. Pago fallido ──────────────────────────────────────────────────
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        if (!invoice.subscription) break;
        const clientId = await getClientIdFromSubscription(invoice.subscription);
        if (!clientId) { console.warn('[stripe-webhook] payment_failed: no clientId'); break; }

        // No se pausa por el primer fallo: Stripe reintenta automáticamente
        // (Smart Retries) mientras la suscripción esté en past_due — la
        // fecha del próximo reintento la da Stripe (invoice.next_payment_attempt),
        // nunca se inventa. Si ya no hay próximo intento programado, tampoco
        // se pausa aquí: el estado final ("unpaid"/"canceled") lo confirma
        // customer.subscription.updated / customer.subscription.deleted.
        await updateClient(clientId, {
          paymentStatus:      'past_due',
          paymentFailed:      true,
          lastPaymentFailedAt: new Date().toISOString().slice(0, 10),
          gracePeriodEndsAt:  isoDate(invoice.next_payment_attempt),
        });
        console.log(`[stripe-webhook] Client ${clientId} payment failed — next attempt: ${isoDate(invoice.next_payment_attempt) || '(ninguno)'}`);
        break;
      }

      // ── 4/5. Cambios de estado de la suscripción ─────────────────────────
      // Según la documentación oficial de Stripe: "past_due" debe mantener el
      // acceso activo (Smart Retries en curso); solo "unpaid" o "canceled"
      // deben revocar el acceso.
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const clientId = sub.metadata?.clientId;
        if (!clientId) { console.warn('[stripe-webhook] subscription.updated: no clientId'); break; }

        const patch = { cancelAtPeriodEnd: !!sub.cancel_at_period_end };

        if (sub.status === 'active' || sub.status === 'trialing') {
          patch.active            = true;
          patch.paymentStatus     = 'paid';
          patch.paymentFailed     = false;
          patch.gracePeriodEndsAt = null;
        } else if (sub.status === 'past_due') {
          patch.active        = true; // en período de gracia — sigue activo
          patch.paymentStatus = 'past_due';
          patch.paymentFailed = true;
        } else if (sub.status === 'unpaid') {
          patch.active        = false; // reintentos agotados — Stripe ya no cobrará más
          patch.paymentStatus = 'failed';
          patch.paymentFailed = true;
        } else if (sub.status === 'canceled') {
          patch.active        = false;
          patch.paymentStatus = 'cancelled';
          patch.cancelledAt   = new Date().toISOString().slice(0, 10);
        }

        await updateClient(clientId, patch);
        console.log(`[stripe-webhook] Client ${clientId} → subscription ${sub.status}`);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const clientId = sub.metadata?.clientId;
        if (!clientId) { console.warn('[stripe-webhook] subscription.deleted: no clientId'); break; }

        // No se borra el cliente ni su configuración — solo se marca como
        // cancelado. Si vuelve a suscribirse, un nuevo Checkout reactiva todo.
        await updateClient(clientId, {
          active:        false,
          paymentStatus: 'cancelled',
          cancelledAt:   new Date().toISOString().slice(0, 10),
        });
        console.log(`[stripe-webhook] Client ${clientId} subscription deleted — cancelled`);
        break;
      }

      default:
        // Ignorar otros tipos de evento
        break;
    }
  } catch (err) {
    console.error('[stripe-webhook] Handler error:', err.message);
    // Devuelve 200 igual — Stripe reintenta ante respuestas no-2xx y eso
    // podría producir un loop de reintentos sobre un error que no se va a
    // resolver solo. El evento ya quedó marcado como procesado arriba.
  }

  return res.status(200).json({ received: true });
}
