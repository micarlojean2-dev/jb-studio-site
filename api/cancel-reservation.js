import { Redis }  from '@upstash/redis';
import { registrarCambio } from '../lib/changes.js';
import { registrarActividad } from '../lib/activity.js';
import { sendReservationEmails } from '../lib/reservation-emails.js';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { initSentry, captureApiException, captureApiMessage } from '../lib/sentry.js';

initSentry();

let redis = new Redis({
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

function actionTokenHash(token) {
  return createHash('sha256').update(String(token || '')).digest('hex');
}

function tokenMatches(hash, token) {
  if (!hash || !token) return false;
  const expected = Buffer.from(String(hash));
  const actual = Buffer.from(actionTokenHash(token));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function rawTokenMatches(storedToken, token) {
  if (!storedToken || !token) return false;
  const expected = Buffer.from(String(storedToken));
  const actual = Buffer.from(String(token));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function sameChatContact(a, b) {
  return !!a?.email && !!a?.telefono && a.email === b?.email && a.telefono === b?.telefono;
}

function actionTokenState(reservation, token) {
  if (!reservation || reservation.actionTokenUsedAt) return null;
  const expiresAt = Date.parse(reservation && reservation.actionTokenExpiresAt);
  if (reservation.actionTokenHash) {
    return Number.isFinite(expiresAt) && expiresAt > Date.now() && tokenMatches(reservation.actionTokenHash, token) ? 'secure' : null;
  }
  return rawTokenMatches(reservation.actionToken, token) ? 'legacy' : null;
}

function actionTokenExpiry(fechaISO, timezone) {
  const match = String(fechaISO || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  let candidate = NaN;
  if (match) {
    const [year, month, day] = match.slice(1).map(Number);
    const utcGuess = Date.UTC(year, month - 1, day, 23, 59, 59, 999);
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(utcGuess));
      const part = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
      const localAsUtc = Date.UTC(+part.year, +part.month - 1, +part.day, +part.hour, +part.minute, +part.second, 999);
      candidate = utcGuess - (localAsUtc - utcGuess);
    } catch (e) {}
  }
  return new Date(Math.max(Date.now() + 86400000, Number.isFinite(candidate) ? candidate : Date.now() + 86400000)).toISOString();
}

function migrateLegacyActionToken(reservation, token, timezone) {
  if (actionTokenState(reservation, token) !== 'legacy') return false;
  reservation.actionTokenHash = actionTokenHash(token);
  reservation.actionTokenExpiresAt = actionTokenExpiry(reservation.fechaISO, timezone);
  reservation.actionTokenUsedAt = null;
  delete reservation.actionToken;
  return true;
}

async function releaseOwnedLock(key, owner) {
  const script = redis.createScript('if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) end return 0');
  await script.eval([key], [owner]);
}

function storageUnavailable(res) {
  return res.status(503).json({ error: 'storage_unavailable', retryable: true });
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

  const { clientId, actionToken, selectedReservationId } = req.body || {};

  if (!clientId || !/^[a-z0-9-]+$/.test(clientId))
    return res.status(400).json({ error: 'Invalid clientId' });
  if (!actionToken || typeof actionToken !== 'string')
    return res.status(400).json({ found: false, error: 'Valid actionToken is required' });

  try {
    let client;
    try {
      client = await redis.get(`client:${clientId}`);
    } catch (err) {
      captureApiException(err, { clientId, feature: 'redis', route: '/api/cancel-reservation' });
      return storageUnavailable(res);
    }
    if (!client)        return res.status(404).json({ error: 'Client not found' });
    if (!client.active) return res.status(403).json({ error: 'Client inactive' });

    // ── Find all reservations for this client ────────────────────────────
    let keys, items;
    try {
      keys = await redis.keys(`reservations:${clientId}:*`);
      items = keys.length === 1 ? [await redis.get(keys[0])] : keys.length ? await redis.mget(...keys) : [];
    } catch (err) {
      captureApiException(err, { clientId, feature: 'redis', route: '/api/cancel-reservation' });
      return storageUnavailable(res);
    }
    if (!keys.length) return res.status(200).json({ found: false });

    // Only an unexpired, unused hashed action capability can select a reservation.
    let source     = null;
    let sourceKey  = null;

    items.forEach((r, i) => {
      if (!r) return;
      if (!actionTokenState(r, actionToken)) return;
      source = r;
      sourceKey = keys[i];
    });

    const chatSelection = typeof selectedReservationId === 'string';
    let match = source;
    let matchKey = sourceKey;
    if (chatSelection) {
      const selectedIndex = keys.indexOf(selectedReservationId);
      match = selectedIndex >= 0 ? items[selectedIndex] : null;
      matchKey = selectedIndex >= 0 ? keys[selectedIndex] : null;
      if (!source || !match || !sameChatContact(source, match)) return res.status(200).json({ found: false });
    }
    if (!match || match.estado === 'cancelada') return res.status(200).json({ found: false });

    const lockKey = `reservation-action-lock:${actionTokenHash(actionToken)}`;
    const lockOwner = randomUUID();
    try {
      const got = await redis.set(lockKey, lockOwner, { nx: true, px: 15000 });
      if (got !== 'OK' && got !== true) return storageUnavailable(res);
    } catch (err) {
      captureApiException(err, { clientId, feature: 'redis', route: '/api/cancel-reservation' });
      return storageUnavailable(res);
    }

    try {
      // Reload while holding the capability lock so parallel requests cannot consume it twice.
      try {
        const reloadedSource = await redis.get(sourceKey);
        match = sourceKey === matchKey ? reloadedSource : await redis.get(matchKey);
        source = reloadedSource;
      } catch (err) {
        captureApiException(err, { clientId, feature: 'redis', route: '/api/cancel-reservation' });
        return storageUnavailable(res);
      }
      if (!source || !actionTokenState(source, actionToken) || !match || match.estado === 'cancelada' ||
        (chatSelection && !sameChatContact(source, match)) || (!chatSelection && !actionTokenState(match, actionToken))) {
        return res.status(200).json({ found: false });
      }

    // ── Mark as cancelled ────────────────────────────────────────────────
    const fechaCancelacion = new Date().toISOString();
    match.estado           = 'cancelada';
    match.fechaCancelacion = fechaCancelacion;
    if (!chatSelection) {
      migrateLegacyActionToken(match, actionToken, client.timezone);
      match.actionTokenUsedAt = fechaCancelacion;
    }
    match.cancelledBy = 'cliente';
    try {
      await redis.set(matchKey, match);
    } catch (err) {
      captureApiException(err, { clientId, feature: 'redis', route: '/api/cancel-reservation' });
      return storageUnavailable(res);
    }
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

      return res.status(200).json({ found: true, aviso: { encolado: aviso.ok }, email, emailWarning: email.warning || null });
    } finally {
      await releaseOwnedLock(lockKey, lockOwner).catch(() => {});
    }

  } catch (err) {
    console.error('[api/cancel-reservation]', err.message);
    captureApiException(err, { clientId, feature: 'reservation_cancel', route: '/api/cancel-reservation' });
    return res.status(500).json({ error: 'Database error' });
  }
}

export const __test = { actionTokenHash, tokenMatches, actionTokenState, actionTokenExpiry, migrateLegacyActionToken, sameChatContact, setRedisForTests(value) { redis = value; } };
