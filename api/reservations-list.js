import { Redis } from '@upstash/redis';
import { initSentry, captureApiException } from '../lib/sentry.js';

initSentry();

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

function authorized(token, client) {
  if (!token) return false;
  if (client.panelToken && token === client.panelToken) return true;
  if (process.env.ADMIN_TOKEN && token === process.env.ADMIN_TOKEN) return true;
  return false;
}

export function createReservationsListHandler({ redis: store } = {}) {
  const dataStore = store || redis;
  return async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const clientId = req.query?.clientId;
  const token    = req.query?.token || req.body?.token;

  if (!clientId || !/^[a-z0-9-]+$/.test(clientId))
    return res.status(400).json({ error: 'Invalid clientId' });

  try {
    const client = await dataStore.get(`client:${clientId}`);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    if (!authorized(token, client)) return res.status(401).json({ error: 'Unauthorized' });

    // ── GET: recent owner activity ────────────────────────────────────────
    if (req.method === 'GET' && req.query?.scope === 'activity') {
      const raw = await dataStore.lrange(`activity:${clientId}`, 0, -1);
      const activities = (raw || []).map((value) => {
        try { return typeof value === 'string' ? JSON.parse(value) : value; } catch (_) { return null; }
      }).filter(Boolean).reverse();
      return res.status(200).json({ activities });
    }

    // ── GET: list all reservations ───────────────────────────────────────
    if (req.method === 'GET') {
      const keys = await dataStore.keys(`reservations:${clientId}:*`);
      if (!keys.length) return res.status(200).json([]);

      const items = keys.length === 1
        ? [await dataStore.get(keys[0])]
        : await dataStore.mget(...keys);

      const reservations = items
        .filter(Boolean)
        .map((r, i) => ({ ...r, _key: keys[i] }))
        .sort((a, b) => (b.fechaSolicitud || '').localeCompare(a.fechaSolicitud || ''));

      return res.status(200).json(reservations);
    }

    // ── PUT: update reservation estado ────────────────────────────────────
    if (req.method === 'PUT') {
      const { key, estado } = req.body || {};

      const VALID_ESTADOS = ['pendiente', 'confirmada', 'rechazada', 'cancelada'];
      if (!key || !VALID_ESTADOS.includes(estado))
        return res.status(400).json({ error: 'key and valid estado are required' });

      // Ensure the key belongs to this client
      if (!key.startsWith(`reservations:${clientId}:`))
        return res.status(403).json({ error: 'Key does not belong to this client' });

      const reservation = await dataStore.get(key);
      if (!reservation) return res.status(404).json({ error: 'Reservation not found' });

      reservation.estado = estado;
      if (estado === 'cancelada')   reservation.fechaCancelacion  = new Date().toISOString();
      if (estado === 'confirmada')  reservation.fechaConfirmacion = new Date().toISOString();
      if (estado === 'rechazada')   reservation.fechaRechazo      = new Date().toISOString();

      await dataStore.set(key, reservation);
      return res.status(200).json({ ok: true, reservation });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('[api/reservations-list]', err.message);
    captureApiException(err, { clientId, feature: 'client_panel', route: '/api/reservations-list' });
    return res.status(500).json({ error: 'Database error' });
  }
  };
}

export default createReservationsListHandler();
