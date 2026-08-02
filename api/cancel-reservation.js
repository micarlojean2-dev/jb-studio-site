import { Redis }  from '@upstash/redis';
import { registrarCambio } from '../lib/changes.js';
import { registrarActividad } from '../lib/activity.js';
import { sendReservationEmails } from '../lib/reservation-emails.js';
import { initSentry, captureApiException, captureApiMessage } from '../lib/sentry.js';

initSentry();

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

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
    const activity = await registrarActividad(clientId, {
      type: 'cancelled', cliente: match.nombre, servicio: match.servicio,
      fecha: match.fecha, hora: match.hora,
    });
    if (!activity.ok) console.error(`[api/cancel-reservation] actividad de cancelación no guardada: ${activity.error}`);

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

    // Failure does not undo cancellation: the slot is released regardless.
    const email = await sendReservationEmails(client, match, 'cancelled');

    return res.status(200).json({ found: true, key: matchKey, aviso: { encolado: aviso.ok }, email, emailWarning: email.warning || null });

  } catch (err) {
    console.error('[api/cancel-reservation]', err.message);
    captureApiException(err, { clientId, feature: 'reservation_cancel', route: '/api/cancel-reservation' });
    return res.status(500).json({ error: 'Database error' });
  }
}
