import Stripe from 'stripe';
import { Redis } from '@upstash/redis';
import { initSentry, captureApiException } from '../lib/sentry.js';
import { sendBillingAlertEmail } from '../lib/reservation-emails.js';

initSentry();

// Fire-and-forget heartbeat to Better Stack. No afecta el response del
// webhook aunque Better Stack esté lento o caiga. Timeout de 2 s.
async function notifyHeartbeat(eventType) {
  const url = process.env.STRIPE_WEBHOOK_HEARTBEAT_URL;
  if (!url) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  fetch(url, { signal: controller.signal, method: 'HEAD' })
    .catch(() => {}) // intentionally swallow — heartbeat no es crítico
    .finally(() => clearTimeout(timeout));
}

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

// Confirmado en vivo contra Stripe API 2026-02-25.clover: Invoice ya no
// trae `invoice.subscription` como campo plano (queda null) — la relación
// vive ahora en invoice.parent.subscription_details. Se resuelven ambas
// rutas por si el proyecto corre alguna vez con una API version distinta.
function getInvoiceSubscriptionId(invoice) {
  return invoice.subscription || invoice.parent?.subscription_details?.subscription || null;
}

// La metadata de la suscripción (con el clientId) también viaja directo en
// invoice.parent.subscription_details.metadata — evita una llamada extra a
// la API cuando está disponible; si no, cae al lookup por subscription id.
function getInvoiceClientId(invoice) {
  return invoice.parent?.subscription_details?.metadata?.clientId || null;
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

// ── Correo de bienvenida al activarse ───────────────────────────────────────
const escW = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Solo se listan las funciones que el plan realmente tiene. Prometerle
// reservas a un Básico sería mentirle en el primer correo que recibe.
function funcionesActivas(c) {
  const f = c.features || {};
  const items = [];
  if (f.faq !== false)            items.push('Responde preguntas sobre tu negocio');
  if (f.prices !== false)         items.push('Informa precios y servicios');
  if (f.catalog !== false)        items.push('Muestra tu catálogo');
  if (f.reservations === true)    items.push('Toma reservas por ti');
  if (f.emailNotifications === true) items.push('Te avisa por correo de cada reserva');
  if (f.reservations === true)    items.push('Recordatorios y resumen diario de tus citas');
  if (f.leads === true)           items.push('Captura clientes interesados');
  if (f.cancellation === true)    items.push('Gestiona cancelaciones');
  return items;
}

async function sendWelcome(c, clientId) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;
  const { Resend } = await import('resend');
  const resend = new Resend(apiKey);

  const color   = c.color || '#1a4a2e';
  const negocio = c.businessName || 'tu negocio';
  const url     = `https://jbstudio.app/asistente/${encodeURIComponent(clientId)}`;
  const snippet = c.widgetSnippet || `<script src="https://jbstudio.app/widget.js?id=${clientId}"></script>`;
  const panel   = c.panelToken
    ? `https://jbstudio.app/reservas/${encodeURIComponent(clientId)}#t=${encodeURIComponent(c.panelToken)}`
    : '';
  const lista = funcionesActivas(c)
    .map((t) => `<li style="margin-bottom:6px">${escW(t)}</li>`).join('');

  const html = `<!DOCTYPE html><html><body style="font-family:-apple-system,Segoe UI,sans-serif;background:#eef0f3;padding:32px 16px;margin:0">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,.10)">
  <div style="background:${escW(color)};padding:26px 28px">
    <p style="margin:0;color:rgba(255,255,255,.72);font-size:11px;letter-spacing:.08em;text-transform:uppercase">${escW(negocio)}</p>
    <h1 style="margin:6px 0 0;color:#fff;font-size:22px">Tu asistente ya está listo ✨</h1>
  </div>
  <div style="padding:24px 28px">
    <p style="font-size:15px;color:#16181d;line-height:1.6;margin:0 0 18px">
      Desde ahora atiende a tus clientes por ti, 24/7.
    </p>

    <div style="border:1px solid #eaecef;border-radius:12px;padding:14px 16px;margin-bottom:12px">
      <div style="font-size:12px;color:#8a8f96;margin-bottom:4px">La dirección de tu asistente</div>
      <a href="${escW(url)}" style="font-size:14px;color:${escW(color)};font-weight:600;text-decoration:none;word-break:break-all">${escW(url)}</a>
    </div>

    <div style="border:1px solid #eaecef;border-radius:12px;padding:14px 16px;margin-bottom:12px">
      <div style="font-size:12px;color:#8a8f96;margin-bottom:6px">Para ponerlo en tu web, pega esto antes de &lt;/body&gt;</div>
      <code style="display:block;font-size:12px;background:#f5f6f8;padding:10px;border-radius:8px;color:#16181d;word-break:break-all">${escW(snippet)}</code>
    </div>

    ${panel ? `<div style="border:1px solid #eaecef;border-radius:12px;padding:14px 16px;margin-bottom:12px">
      <div style="font-size:12px;color:#8a8f96;margin-bottom:4px">Tu panel de citas</div>
      <a href="${escW(panel)}" style="font-size:14px;color:${escW(color)};font-weight:600;text-decoration:none;word-break:break-all">Ver mis reservas</a>
    </div>` : ''}

    <div style="border:1px solid #eaecef;border-radius:12px;padding:14px 16px;margin-bottom:12px">
      <div style="font-size:12px;color:#8a8f96;margin-bottom:4px">Correo configurado</div>
      <div style="font-size:14px;color:#16181d;font-weight:600">${escW(c.ownerEmail)}</div>
      <div style="font-size:12px;color:#8a8f96;margin-top:4px">Aquí te llegarán los avisos de tu negocio.</div>
    </div>

    ${lista ? `<div style="border:1px solid #eaecef;border-radius:12px;padding:14px 16px">
      <div style="font-size:12px;color:#8a8f96;margin-bottom:8px">Lo que hace por ti</div>
      <ul style="margin:0;padding-left:18px;font-size:14px;color:#16181d;line-height:1.5">${lista}</ul>
    </div>` : ''}

    <p style="margin:22px 0 0;font-size:11.5px;color:#a8acb3;border-top:1px solid #eee;padding-top:14px">
      <a href="https://jbstudio.app" style="color:${escW(color)};text-decoration:none">JB Studio</a>
    </p>
  </div>
</div>
</body></html>`;

  await resend.emails.send({
    from: 'reservas@jbstudio.app',
    to: c.ownerEmail,
    subject: 'Tu asistente ya está listo ✨',
    html,
  });
  console.log(`[stripe-webhook] welcome sent to ${clientId}`);
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
    captureApiException(err, { clientId, feature: 'billing', route: '/api/stripe-webhook' });
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
    captureApiException(err, { feature: 'redis', route: '/api/stripe-webhook' });
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
          stripeSubscriptionId:    session.subscription || session.parent?.subscription_details?.subscription || null,
          stripeCheckoutSessionId: session.id,
        };

        // Solo se marca como pagado si Stripe confirma el pago en la propia
        // sesión — "no marcar como pagado solo porque se abrió Checkout".
        // Si no, el estado lo termina de resolver invoice.paid /
        // customer.subscription.updated cuando llegue.

        await updateClient(clientId, patch);
        console.log(`[stripe-webhook] Client ${clientId} checkout completed (payment_status=${session.payment_status})`);
        break;
      }

      // ── 2. Pago de factura exitoso ───────────────────────────────────────
      case 'invoice.paid': {
        const invoice = event.data.object;
        const subscriptionId = getInvoiceSubscriptionId(invoice);
        if (!subscriptionId) break;
        const clientId = getInvoiceClientId(invoice) || await getClientIdFromSubscription(subscriptionId);
        if (!clientId) { console.warn('[stripe-webhook] invoice.paid: no clientId'); break; }

        const periodEnd = invoice.lines?.data?.[0]?.period?.end || null;
        const paidUntil = isoDate(periodEnd);

        const patch = {
          active:                true,
          paymentStatus:         'paid',
          paymentFailed:         false,
          stripeCustomerId:      invoice.customer,
          stripeSubscriptionId:  subscriptionId,
          lastPaymentAt:         isoDate(invoice.status_transitions?.paid_at) || new Date().toISOString().slice(0, 10),
          nextPaymentAt:         paidUntil,
          paidUntil,
          gracePeriodEndsAt:     null,
        };

        try {
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          if (sub.trial_end) patch.trial_end = String(sub.trial_end);
        } catch (_) {}

        await updateClient(clientId, patch);
        console.log(`[stripe-webhook] Client ${clientId} paid — active until ${paidUntil}`);

        // Bienvenida solo la primera vez que se activa. Las renovaciones
        // mensuales también disparan invoice.paid y no deben repetirla.
        try {
          const c = await redis.get(`client:${clientId}`);
          if (c && c.ownerEmail && !c.bienvenidaEnviada) {
            await sendWelcome(c, clientId);
            await updateClient(clientId, { bienvenidaEnviada: new Date().toISOString().slice(0, 10) });
          }
        } catch (e) {
          console.error('[stripe-webhook] welcome:', e.message);
          captureApiException(e, { clientId, feature: 'email_owner', route: '/api/stripe-webhook' });
        }
        break;
      }

      // ── 3. Pago fallido ──────────────────────────────────────────────────
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const subscriptionId = getInvoiceSubscriptionId(invoice);
        if (!subscriptionId) break;
        const clientId = getInvoiceClientId(invoice) || await getClientIdFromSubscription(subscriptionId);
        if (!clientId) { console.warn('[stripe-webhook] payment_failed: no clientId'); break; }

        const gracePeriodEndsAt = isoDate(invoice.next_payment_attempt);
        await updateClient(clientId, {
          paymentStatus:      'past_due',
          paymentFailed:      true,
          lastPaymentFailedAt: new Date().toISOString().slice(0, 10),
          gracePeriodEndsAt,
        });
        console.log(`[stripe-webhook] Client ${clientId} payment failed — next attempt: ${gracePeriodEndsAt || '(ninguno)'}`);

        try {
          const clientData = await redis.get(`client:${clientId}`);
          if (clientData && clientData.ownerEmail) {
            await sendBillingAlertEmail(clientData, 'payment_failed', { clientId, gracePeriodEndsAt });
          }
        } catch (e) {
          console.error('[stripe-webhook] payment_failed email error:', e.message);
          captureApiException(e, { clientId, feature: 'email_owner', route: '/api/stripe-webhook' });
        }
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

         // Stripe puede indicar canceled_at al solicitar una cancelación que
         // todavía terminará en cancel_at. Date.now() usa el reloj del runtime;
         // con Test Clocks muy desalineados, esta comparación puede no coincidir.
         const cancelAtFuture = sub.cancel_at && sub.cancel_at > Math.floor(Date.now() / 1000);
         const cancellationScheduled = sub.cancel_at_period_end === true || cancelAtFuture;

         if (sub.canceled_at && cancellationScheduled) {
           await updateClient(clientId, {
             cancelAtPeriodEnd: true,
             cancelAt:          isoDate(sub.cancel_at),
           });
           console.log(`[stripe-webhook] Client ${clientId} → cancellation scheduled for ${isoDate(sub.cancel_at)}`);
           break;
         }

        const patch = { cancelAtPeriodEnd: !!sub.cancel_at_period_end };

        if (sub.status === 'active' || sub.status === 'trialing') {
          patch.active            = true;
          patch.paymentStatus     = 'paid';
          patch.paymentFailed     = false;
          patch.gracePeriodEndsAt = null;
          patch.trial_end         = sub.trial_end ? String(sub.trial_end) : null;
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
        } else if (sub.status === 'paused') {
          patch.active        = false;
          patch.paymentStatus = 'paused';
          patch.paymentFailed = false;
        }

        await updateClient(clientId, patch);
        console.log(`[stripe-webhook] Client ${clientId} → subscription ${sub.status}`);
        
        if (sub.status === 'unpaid' || sub.status === 'canceled' || sub.status === 'paused') {
          try {
            const clientData = await redis.get(`client:${clientId}`);
            if (clientData && clientData.ownerEmail) {
              await sendBillingAlertEmail(clientData, 'subscription_paused', { clientId });
            }
          } catch (e) {
            console.error('[stripe-webhook] subscription_paused email error:', e.message);
            captureApiException(e, { clientId, feature: 'email_owner', route: '/api/stripe-webhook' });
          }
        }
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
        
        try {
          const clientData = await redis.get(`client:${clientId}`);
          if (clientData && clientData.ownerEmail) {
            await sendBillingAlertEmail(clientData, 'subscription_paused', { clientId });
          }
        } catch (e) {
          console.error('[stripe-webhook] subscription.deleted email error:', e.message);
          captureApiException(e, { clientId, feature: 'email_owner', route: '/api/stripe-webhook' });
        }
        break;
      }

      case 'customer.subscription.paused': {
        const sub = event.data.object;
        const clientId = sub.metadata?.clientId;
        if (!clientId) { console.warn('[stripe-webhook] subscription.paused: no clientId'); break; }
        await updateClient(clientId, {
          active:        false,
          paymentStatus: 'paused',
          paymentFailed: false,
        });
        console.log(`[stripe-webhook] Client ${clientId} → subscription paused`);
        break;
      }

      // ── 0. Trial por terminar (Stripe avisa 3 días antes) ─────────────────
      // Stripe envía este evento 3 días antes de que termine el trial.
      // El email de aviso lo envía Stripe automáticamente — no ours.
      case 'customer.subscription.trial_will_end': {
        const sub     = event.data.object;
        const clientId = sub.metadata?.clientId;
        if (!clientId) { console.warn('[stripe-webhook] trial_will_end: no clientId'); break; }
        await updateClient(clientId, {
          trial_end: sub.trial_end ? String(sub.trial_end) : null,
        });
        console.log(`[stripe-webhook] Client ${clientId} trial ending at ${sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : 'unknown'}`);

        try {
          const clientData = await redis.get(`client:${clientId}`);
          if (clientData && clientData.ownerEmail) {
            await sendBillingAlertEmail(clientData, 'trial_ending_soon', {
              clientId,
              trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
            });
          }
        } catch (e) {
          console.error('[stripe-webhook] trial_will_end email error:', e.message);
          captureApiException(e, { clientId, feature: 'email_owner', route: '/api/stripe-webhook' });
        }
        break;
      }

      default:
        // Ignorar otros tipos de evento
        break;
    }
  } catch (err) {
    console.error('[stripe-webhook] Handler error:', err.message);
    captureApiException(err, { feature: 'billing', route: '/api/stripe-webhook', extra: { eventType: event?.type } });
    // Devuelve 200 igual — Stripe reintenta ante respuestas no-2xx y eso
    // podría producir un loop de reintentos sobre un error que no se va a
    // resolver solo. El evento ya quedó marcado como procesado arriba.
  }

  // Latido de vida — no bloquea el response aunque falle o corte.
  notifyHeartbeat(event?.type);

  return res.status(200).json({ received: true });
}
