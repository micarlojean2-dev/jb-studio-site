import { Redis }  from '@upstash/redis';
import { registrarCambio } from '../lib/changes.js';
import { Resend } from 'resend';
import { initSentry, captureApiException, captureApiMessage } from '../lib/sentry.js';

initSentry();

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const FROM = 'reservas@jbstudio.app';

function esc(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Rate limit: 5 cancelaciones/IP/hora ─────────────────────────────────────
const ipStore = new Map();
const HOUR_MS = 60 * 60 * 1000;
const RPH     = 5;

function checkRateLimit(ip) {
  const now = Date.now();
  if (!ipStore.has(ip)) ipStore.set(ip, { count: 0, ts: now });
  const d = ipStore.get(ip);
  if (now - d.ts > HOUR_MS) { d.count = 0; d.ts = now; }
  return ++d.count <= RPH;
}

// ── Normalize contact string for loose matching ──────────────────────────────
function normalizeContact(s) {
  return String(s || '').toLowerCase().replace(/[\s\-().+]/g, '');
}

// ── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (!checkRateLimit(ip))
    return res.status(429).json({ error: 'Demasiadas solicitudes. Por favor espera antes de intentar de nuevo.' });

  const { clientId, contacto, fecha, actionToken } = req.body || {};

  if (!clientId || !/^[a-z0-9-]+$/.test(clientId))
    return res.status(400).json({ error: 'Invalid clientId' });
  if (!actionToken && (!contacto || !fecha))
    return res.status(400).json({ error: 'contacto and fecha are required' });

  try {
    const client = await redis.get(`client:${clientId}`);
    if (!client)        return res.status(404).json({ error: 'Client not found' });
    if (!client.active) return res.status(403).json({ error: 'Client inactive' });

    // ── Find all reservations for this client ────────────────────────────
    const keys = await redis.keys(`reservations:${clientId}:*`);
    if (!keys.length) return res.status(200).json({ found: false });

    const items = keys.length === 1
      ? [await redis.get(keys[0])]
      : await redis.mget(...keys);

    const normContacto = normalizeContact(contacto);
    const normFecha    = String(fecha || '').toLowerCase().trim();

    // Find most recent pending reservation matching contacto + fecha
    let match     = null;
    let matchKey  = null;
    let matchTs   = 0;

    items.forEach((r, i) => {
      if (!r) return;
      if (actionToken && r.actionToken === actionToken) {
        if (r.estado === 'cancelada') { match = r; matchKey = keys[i]; matchTs = Infinity; }
        else if (matchTs !== Infinity) { match = r; matchKey = keys[i]; matchTs = Infinity; }
        return;
      }
      if (actionToken || r.estado === 'cancelada') return;

      const emailMatch = normalizeContact(r.email)    === normContacto;
      const telMatch   = normalizeContact(r.telefono) === normContacto;
      if (!emailMatch && !telMatch) return;

      const rFecha = String(r.fecha || '').toLowerCase().trim();
      const dateMatch = rFecha.includes(normFecha) || normFecha.includes(rFecha);
      if (!dateMatch) return;

      // Pick the most recent match
      const ts = parseInt(keys[i].split(':').pop(), 10) || 0;
      if (ts > matchTs) { match = r; matchKey = keys[i]; matchTs = ts; }
    });

    if (!match) return res.status(200).json({ found: false });

    // Idempotent secure-email cancellation: once cancelled, no event or email
    // is emitted again.
    if (match.estado === 'cancelada') return res.status(200).json({ found: true, alreadyCancelled: true, key: matchKey });

    // ── Mark as cancelled ────────────────────────────────────────────────
    const fechaCancelacion = new Date().toISOString();
    match.estado           = 'cancelada';
    match.fechaCancelacion = fechaCancelacion;
    match.cancelledBy = actionToken ? 'cliente' : 'cliente';
    await redis.set(matchKey, match);
    console.log(`[api/cancel-reservation] Cancelled ${matchKey}`);

    // ── Sin correos inmediatos (Fase D). La cancelación aparece al instante
    //    en la hoja del dueño; el aviso va en el resumen diario agrupado. ──
    const aviso = await registrarCambio(clientId, {
      type: 'cancelled', reservationId: matchKey,
      nombre: match.nombre, servicio: match.servicio, fecha: match.fecha, hora: match.hora,
    });
    if (!aviso.ok) {
      console.error(`[api/cancel-reservation] cancelación ${matchKey} guardada pero el aviso NO quedó en cola:`, aviso.error);
      captureApiMessage('Cancellation saved but change-notification enqueue failed',
        { clientId, feature: 'redis', route: '/api/cancel-reservation' });
    }

    // Notify immediately when mail is configured. Failure does not undo a
    // cancellation because the slot must be released regardless. The outcome is
    // reported truthfully — a missing key is surfaced, never faked as sent.
    const email = {
      configured: !!process.env.RESEND_API_KEY,
      customer: { attempted: false, sent: false, messageId: null, error: null },
      owners:   { attempted: false, sent: false, messageIds: [], recipients: [], error: null },
      warning: null,
    };
    if (!process.env.RESEND_API_KEY) {
      email.warning = 'RESEND_API_KEY missing: cancellation email NOT sent';
      console.error(`[api/cancel-reservation] EMAIL SKIPPED (RESEND_API_KEY missing) for ${clientId} — cancellation saved, email not sent`);
    } else {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const recipients = Array.isArray(client.notificationEmails) && client.notificationEmails.length
        ? client.notificationEmails : (client.ownerEmail ? [client.ownerEmail] : []);
      const subject = `${client.businessName || 'Reserva'} - reserva cancelada`;
      const html = `<p>La reserva de <strong>${esc(match.nombre)}</strong> para ${esc(match.fecha)} a las ${esc(match.hora)} fue cancelada.</p>`;
      const idOf = (r) => (r && r.data && r.data.id) || (r && r.id) || null;
      if (match.email) {
        email.customer.attempted = true;
        try { const r = await resend.emails.send({ from: FROM, to: match.email, subject, html });
          if (r && r.error) email.customer.error = r.error.message || 'send failed';
          else { email.customer.sent = true; email.customer.messageId = idOf(r); }
        } catch (e) { email.customer.error = e.message; }
      }
      if (recipients.length) {
        email.owners.attempted = true; email.owners.recipients = recipients;
        for (const to of recipients) {
          try { const r = await resend.emails.send({ from: FROM, to, subject, html });
            if (r && r.error) email.owners.error = r.error.message || 'send failed';
            else { email.owners.sent = true; const id = idOf(r); if (id) email.owners.messageIds.push(id); }
          } catch (e) { email.owners.error = e.message; }
        }
      }
      if (email.customer.error || email.owners.error) {
        console.error(`[api/cancel-reservation] email error for ${clientId}:`, email.customer.error || email.owners.error);
        captureApiMessage(`Resend cancellation email failed: ${email.customer.error || email.owners.error}`,
          { clientId, feature: email.customer.error ? 'email_customer' : 'email_owner', route: '/api/cancel-reservation' });
      }
    }

    return res.status(200).json({ found: true, key: matchKey, aviso: { encolado: aviso.ok }, email, emailWarning: email.warning || null });

  } catch (err) {
    console.error('[api/cancel-reservation]', err.message);
    captureApiException(err, { clientId, feature: 'reservation_cancel', route: '/api/cancel-reservation' });
    return res.status(500).json({ error: 'Database error' });
  }
}
