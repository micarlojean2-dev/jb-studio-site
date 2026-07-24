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
  if (!clientId) return null;
  try {
    const client = await redis.get(`client:${clientId}`);
    if (!client) { console.warn(`[stripe-webhook] client not found: ${clientId}`); return null; }
    Object.assign(client, patch);
    await redis.set(`client:${clientId}`, client);
    return client;
  } catch (err) {
    console.error(`[stripe-webhook] Redis update failed for ${clientId}:`, err.message);
    return null;
  }
}

// Timestamps reales de Stripe → ISO completo (con hora), para poder calcular
// días restantes con precisión en el panel. null si Stripe no da el dato.
function isoFull(unixSeconds) {
  return unixSeconds ? new Date(unixSeconds * 1000).toISOString() : null;
}
function isoDate(unixSeconds) {
  return unixSeconds ? new Date(unixSeconds * 1000).toISOString().slice(0, 10) : null;
}

// Plan único: Stripe es la fuente de verdad. Traduce el objeto subscription a
// nuestro estado local exacto (active + paymentStatus) y guarda todos los
// campos que el panel necesita. Lo usan subscription.created, subscription.updated
// y, como red de seguridad, checkout.session.completed.
function subscriptionPatch(sub) {
  const item = sub.items?.data?.[0];
  const patch = {
    stripeSubscriptionId: sub.id,
    stripeCustomerId:     sub.customer || null,
    stripePriceId:        item?.price?.id || null,
    subscriptionStatus:   sub.status,
    trialStartedAt:       isoFull(sub.trial_start),
    trialEndsAt:          isoFull(sub.trial_end),
    currentPeriodStart:   isoFull(sub.current_period_start),
    currentPeriodEnd:     isoFull(sub.current_period_end),
    cancelAtPeriodEnd:    !!sub.cancel_at_period_end,
    canceledAt:           isoFull(sub.canceled_at),
    // El próximo cobro cae al final del periodo actual (durante el trial, ese
    // fin coincide con el fin de la prueba).
    nextPaymentAt:        isoFull(sub.current_period_end),
  };
  switch (sub.status) {
    case 'trialing':
      patch.active = true;  patch.paymentStatus = 'trialing';  patch.paymentFailed = false; break;
    case 'active':
      patch.active = true;  patch.paymentStatus = 'active';    patch.paymentFailed = false; break;
    case 'past_due':
      patch.active = true;  patch.paymentStatus = 'past_due';  patch.paymentFailed = true;  break;
    case 'unpaid':
      patch.active = false; patch.paymentStatus = 'unpaid';    patch.paymentFailed = true;  break;
    case 'canceled':
      patch.active = false; patch.paymentStatus = 'canceled';  patch.canceledAt = patch.canceledAt || new Date().toISOString(); break;
    case 'incomplete':
      patch.active = false; patch.paymentStatus = 'incomplete'; break;
    case 'incomplete_expired':
      patch.active = false; patch.paymentStatus = 'incomplete_expired'; break;
    default:
      patch.paymentStatus = sub.status;
  }
  return patch;
}

// Envía la bienvenida una sola vez, cuando el cliente queda activo (trialing o
// active). No se repite en renovaciones (idempotente vía flag bienvenidaEnviada).
async function maybeWelcome(clientId) {
  try {
    const c = await redis.get(`client:${clientId}`);
    if (c && c.active && c.ownerEmail && !c.bienvenidaEnviada) {
      await sendWelcome(c, clientId);
      await updateClient(clientId, { bienvenidaEnviada: new Date().toISOString() });
    }
  } catch (e) { console.error('[stripe-webhook] welcome:', e.message); }
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
      // No se activa por abrir/regresar de Checkout: se registran los IDs y,
      // como red de seguridad, se aplica el estado leído de la suscripción real
      // (por si subscription.created llegara más tarde o se perdiera).
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.mode !== 'subscription') break;
        const clientId = session.metadata?.clientId || session.client_reference_id;
        if (!clientId) { console.warn('[stripe-webhook] checkout.session.completed: no clientId'); break; }

        const subscriptionId = session.subscription || session.parent?.subscription_details?.subscription || null;
        await updateClient(clientId, {
          stripeCustomerId:        session.customer || null,
          stripeSubscriptionId:    subscriptionId,
          stripeCheckoutSessionId: session.id,
        });
        if (subscriptionId) {
          try {
            const sub = await stripe.subscriptions.retrieve(subscriptionId);
            await updateClient(clientId, subscriptionPatch(sub));
            await maybeWelcome(clientId);
          } catch (e) { console.error('[stripe-webhook] checkout sub sync:', e.message); }
        }
        console.log(`[stripe-webhook] Client ${clientId} checkout completed`);
        break;
      }

      // ── 2/3. Alta y cambios de la suscripción (fuente de verdad del estado) ─
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const clientId = sub.metadata?.clientId || await getClientIdFromSubscription(sub.id);
        if (!clientId) { console.warn(`[stripe-webhook] ${event.type}: no clientId`); break; }
        await updateClient(clientId, subscriptionPatch(sub));
        await maybeWelcome(clientId);
        console.log(`[stripe-webhook] Client ${clientId} → subscription ${sub.status}`);
        break;
      }

      // ── 4. Pago de factura exitoso ───────────────────────────────────────
      case 'invoice.paid': {
        const invoice = event.data.object;
        const subscriptionId = getInvoiceSubscriptionId(invoice);
        if (!subscriptionId) break;
        const clientId = getInvoiceClientId(invoice) || await getClientIdFromSubscription(subscriptionId);
        if (!clientId) { console.warn('[stripe-webhook] invoice.paid: no clientId'); break; }

        await updateClient(clientId, {
          lastPaymentAt:     isoFull(invoice.status_transitions?.paid_at) || new Date().toISOString(),
          paymentFailed:     false,
          gracePeriodEndsAt: null,
        });
        // El estado (active/status/periodos) se sincroniza desde la suscripción
        // real, no desde la factura: Stripe es la fuente de verdad.
        try {
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          await updateClient(clientId, subscriptionPatch(sub));
          await maybeWelcome(clientId);
        } catch (e) { console.error('[stripe-webhook] invoice.paid sub sync:', e.message); }
        console.log(`[stripe-webhook] Client ${clientId} invoice paid`);
        break;
      }

      // ── 5. Pago fallido ──────────────────────────────────────────────────
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const subscriptionId = getInvoiceSubscriptionId(invoice);
        if (!subscriptionId) break;
        const clientId = getInvoiceClientId(invoice) || await getClientIdFromSubscription(subscriptionId);
        if (!clientId) { console.warn('[stripe-webhook] payment_failed: no clientId'); break; }

        // No se pausa por el primer fallo: Stripe reintenta (Smart Retries)
        // mientras la suscripción esté en past_due. El estado final
        // (unpaid/canceled) lo confirma customer.subscription.updated/deleted.
        await updateClient(clientId, {
          paymentStatus:       'past_due',
          paymentFailed:       true,
          lastPaymentFailedAt: new Date().toISOString(),
          gracePeriodEndsAt:   isoFull(invoice.next_payment_attempt),
        });
        console.log(`[stripe-webhook] Client ${clientId} payment failed — next attempt: ${isoFull(invoice.next_payment_attempt) || '(ninguno)'}`);
        break;
      }

      // ── 6. Suscripción eliminada (terminó de verdad) ─────────────────────
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const clientId = sub.metadata?.clientId || await getClientIdFromSubscription(sub.id);
        if (!clientId) { console.warn('[stripe-webhook] subscription.deleted: no clientId'); break; }
        // No se borra el cliente ni su configuración — solo se marca cancelado.
        await updateClient(clientId, {
          active:             false,
          paymentStatus:      'canceled',
          subscriptionStatus: 'canceled',
          canceledAt:         isoFull(sub.canceled_at) || new Date().toISOString(),
          cancelAtPeriodEnd:  false,
        });
        console.log(`[stripe-webhook] Client ${clientId} subscription deleted — canceled`);
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

// Solo para pruebas unitarias (mapeo determinista, sin red).
export const __test = { subscriptionPatch, isoFull, isoDate };
