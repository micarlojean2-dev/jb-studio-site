import { Redis }  from '@upstash/redis';
import { Resend } from 'resend';

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const FROM = 'reservas@jbstudio.app';

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

// ── Email helpers ────────────────────────────────────────────────────────────

function ownerCancelHtml(r, businessName, fechaCancelacion) {
  const row = (label, val) => val
    ? `<tr><td style="padding:6px 12px;color:#555;width:150px">${label}</td><td style="padding:6px 12px;color:#111;font-weight:500">${val}</td></tr>`
    : '';
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#f5f5f5;padding:32px 16px;margin:0">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)">
  <div style="background:#7f1d1d;padding:24px 28px">
    <p style="margin:0;color:#fca5a5;font-size:11px;letter-spacing:.08em;text-transform:uppercase">JB Studio · Asistente Virtual</p>
    <h1 style="margin:6px 0 0;color:#fff;font-size:20px">Cancelación de reserva</h1>
  </div>
  <div style="padding:24px 28px">
    <table style="width:100%;border-collapse:collapse;border:1px solid #eee;border-radius:8px;overflow:hidden">
      ${row('Nombre',     r.nombre)}
      ${row('Teléfono',   r.telefono)}
      ${row('Email',      r.email)}
      ${row('Fecha',      r.fecha)}
      ${row('Hora',       r.hora)}
      ${row('Servicio',   r.servicio)}
      ${row('Estado',     'Cancelada')}
      ${row('Cancelada',  new Date(fechaCancelacion).toLocaleString('es'))}
    </table>
    <p style="margin:24px 0 0;font-size:13px;color:#888;border-top:1px solid #eee;padding-top:16px">
      Esta cancelación fue registrada vía el asistente virtual de <strong>JB Studio</strong> · <a href="https://jbstudio.app" style="color:#1a4a2e">jbstudio.app</a>
    </p>
  </div>
</div>
</body></html>`;
}

function clientCancelHtml(r, businessName, lang) {
  const es = lang !== 'en';
  if (es) {
    return `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#f5f5f5;padding:32px 16px;margin:0">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)">
  <div style="background:#7f1d1d;padding:24px 28px">
    <p style="margin:0;color:#fca5a5;font-size:11px;letter-spacing:.08em;text-transform:uppercase">${businessName}</p>
    <h1 style="margin:6px 0 0;color:#fff;font-size:20px">Cancelación confirmada</h1>
  </div>
  <div style="padding:24px 28px">
    <p style="font-size:15px;color:#1a1a1a;line-height:1.6">Hola <strong>${r.nombre}</strong>,</p>
    <p style="font-size:15px;color:#333;line-height:1.6">
      Tu reserva para el <strong>${r.fecha}</strong>${r.hora ? ' a las <strong>' + r.hora + '</strong>' : ''} en <strong>${businessName}</strong> fue cancelada correctamente.
    </p>
    <p style="font-size:13px;color:#555;background:#fff5f5;border:1px solid #fecaca;padding:12px 16px;border-radius:8px;margin-top:16px">
      Si quieres reagendar, puedes hacerlo cuando gustes a través del asistente.
    </p>
    <p style="margin:24px 0 0;font-size:12px;color:#aaa;border-top:1px solid #eee;padding-top:16px">
      Asistente virtual powered by <a href="https://jbstudio.app" style="color:#1a4a2e">JB Studio</a>
    </p>
  </div>
</div>
</body></html>`;
  }
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#f5f5f5;padding:32px 16px;margin:0">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)">
  <div style="background:#7f1d1d;padding:24px 28px">
    <p style="margin:0;color:#fca5a5;font-size:11px;letter-spacing:.08em;text-transform:uppercase">${businessName}</p>
    <h1 style="margin:6px 0 0;color:#fff;font-size:20px">Cancellation confirmed</h1>
  </div>
  <div style="padding:24px 28px">
    <p style="font-size:15px;color:#1a1a1a;line-height:1.6">Hi <strong>${r.nombre}</strong>,</p>
    <p style="font-size:15px;color:#333;line-height:1.6">
      Your reservation for <strong>${r.fecha}</strong>${r.hora ? ' at <strong>' + r.hora + '</strong>' : ''} at <strong>${businessName}</strong> has been successfully cancelled.
    </p>
    <p style="font-size:13px;color:#555;background:#fff5f5;border:1px solid #fecaca;padding:12px 16px;border-radius:8px;margin-top:16px">
      If you'd like to reschedule, feel free to do so any time through the assistant.
    </p>
    <p style="margin:24px 0 0;font-size:12px;color:#aaa;border-top:1px solid #eee;padding-top:16px">
      Virtual assistant powered by <a href="https://jbstudio.app" style="color:#1a4a2e">JB Studio</a>
    </p>
  </div>
</div>
</body></html>`;
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

  const { clientId, contacto, fecha } = req.body || {};

  if (!clientId || !/^[a-z0-9-]+$/.test(clientId))
    return res.status(400).json({ error: 'Invalid clientId' });
  if (!contacto || !fecha)
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
    const normFecha    = String(fecha).toLowerCase().trim();

    // Find most recent pending reservation matching contacto + fecha
    let match     = null;
    let matchKey  = null;
    let matchTs   = 0;

    items.forEach((r, i) => {
      if (!r || r.estado === 'cancelada') return;

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

    // ── Mark as cancelled ────────────────────────────────────────────────
    const fechaCancelacion = new Date().toISOString();
    match.estado           = 'cancelada';
    match.fechaCancelacion = fechaCancelacion;
    await redis.set(matchKey, match);
    console.log(`[api/cancel-reservation] Cancelled ${matchKey}`);

    // ── Send emails (non-blocking) ────────────────────────────────────────
    const apiKey = process.env.RESEND_API_KEY;
    if (apiKey) {
      const resend       = new Resend(apiKey);
      const businessName = client.businessName || clientId;
      const lang         = client.language || 'es';
      const emails       = [];
      const es           = lang !== 'en';
      // Legacy clients (no features object) keep the old always-on behavior.
      const notifyOwner  = !client.features || client.features.emailNotifications !== false;

      if (notifyOwner && client.ownerEmail) {
        emails.push(
          resend.emails.send({
            from:    FROM,
            to:      client.ownerEmail,
            subject: `Cancelación de reserva — ${match.nombre}`,
            html:    ownerCancelHtml(match, businessName, fechaCancelacion),
          })
        );
      }

      if (match.email) {
        emails.push(
          resend.emails.send({
            from:    FROM,
            to:      match.email,
            subject: es
              ? `Tu cancelación fue confirmada — ${businessName}`
              : `Your cancellation was confirmed — ${businessName}`,
            html: clientCancelHtml(match, businessName, lang),
          })
        );
      }

      if (emails.length) {
        Promise.allSettled(emails).then(results => {
          results.forEach((r, i) => {
            if (r.status === 'rejected')
              console.error(`[api/cancel-reservation] Email ${i} failed:`, r.reason?.message);
            else
              console.log(`[api/cancel-reservation] Email ${i} sent:`, r.value?.data?.id);
          });
        });
      }
    } else {
      console.warn('[api/cancel-reservation] RESEND_API_KEY not set — skipping emails');
    }

    return res.status(200).json({ found: true, key: matchKey });

  } catch (err) {
    console.error('[api/cancel-reservation]', err.message);
    return res.status(500).json({ error: 'Database error' });
  }
}
