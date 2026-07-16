import { Redis }  from '@upstash/redis';
import { Resend } from 'resend';

const redis  = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const FROM = 'reservas@jbstudio.app';

// ── Rate limit: 5 reservas/IP/hora ──────────────────────────────────────────
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

// ── Email helpers ────────────────────────────────────────────────────────────

function ownerHtml(r, businessName) {
  const row = (label, val) => val
    ? `<tr><td style="padding:6px 12px;color:#555;width:130px">${label}</td><td style="padding:6px 12px;color:#111;font-weight:500">${val}</td></tr>`
    : '';
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#f5f5f5;padding:32px 16px;margin:0">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)">
  <div style="background:#1a4a2e;padding:24px 28px">
    <p style="margin:0;color:#4ade80;font-size:11px;letter-spacing:.08em;text-transform:uppercase">JB Studio · Asistente Virtual</p>
    <h1 style="margin:6px 0 0;color:#fff;font-size:20px">Nueva solicitud de reserva</h1>
  </div>
  <div style="padding:24px 28px">
    <table style="width:100%;border-collapse:collapse;border:1px solid #eee;border-radius:8px;overflow:hidden">
      ${row('Nombre',   r.nombre)}
      ${row('Teléfono', r.telefono)}
      ${row('Email',    r.email)}
      ${row('Fecha',    r.fecha)}
      ${row('Hora',     r.hora)}
      ${row('Servicio', r.servicio)}
      ${r.nota ? row('Nota', r.nota) : ''}
      ${row('Estado',   'Pendiente')}
      ${row('Recibida', new Date(r.fechaSolicitud).toLocaleString('es'))}
    </table>
    <p style="margin:24px 0 0;font-size:13px;color:#888;border-top:1px solid #eee;padding-top:16px">
      Esta solicitud fue recibida vía tu asistente virtual de <strong>JB Studio</strong> · <a href="https://jbstudio.app" style="color:#1a4a2e">jbstudio.app</a>
    </p>
  </div>
</div>
</body></html>`;
}

function clientHtml(r, businessName, lang) {
  const es = lang !== 'en';
  if (es) {
    return `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#f5f5f5;padding:32px 16px;margin:0">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)">
  <div style="background:#1a4a2e;padding:24px 28px">
    <p style="margin:0;color:#4ade80;font-size:11px;letter-spacing:.08em;text-transform:uppercase">${businessName}</p>
    <h1 style="margin:6px 0 0;color:#fff;font-size:20px">¡Solicitud recibida!</h1>
  </div>
  <div style="padding:24px 28px">
    <p style="font-size:15px;color:#1a1a1a;line-height:1.6">
      Hola <strong>${r.nombre}</strong>,
    </p>
    <p style="font-size:15px;color:#333;line-height:1.6">
      Recibimos tu solicitud de cita para el <strong>${r.fecha}</strong> a las <strong>${r.hora}</strong>.
      El equipo de <strong>${businessName}</strong> revisará disponibilidad y te confirmará pronto.
    </p>
    ${r.servicio ? `<p style="font-size:13px;color:#555;background:#f5f5f5;padding:12px 16px;border-radius:8px;margin-top:16px">Servicio: <strong>${r.servicio}</strong></p>` : ''}
    <p style="margin:24px 0 0;font-size:12px;color:#aaa;border-top:1px solid #eee;padding-top:16px">
      Asistente virtual powered by <a href="https://jbstudio.app" style="color:#1a4a2e">JB Studio</a>
    </p>
  </div>
</div>
</body></html>`;
  }
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#f5f5f5;padding:32px 16px;margin:0">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)">
  <div style="background:#1a4a2e;padding:24px 28px">
    <p style="margin:0;color:#4ade80;font-size:11px;letter-spacing:.08em;text-transform:uppercase">${businessName}</p>
    <h1 style="margin:6px 0 0;color:#fff;font-size:20px">Request received!</h1>
  </div>
  <div style="padding:24px 28px">
    <p style="font-size:15px;color:#1a1a1a;line-height:1.6">
      Hi <strong>${r.nombre}</strong>,
    </p>
    <p style="font-size:15px;color:#333;line-height:1.6">
      We received your appointment request for <strong>${r.fecha}</strong> at <strong>${r.hora}</strong>.
      The <strong>${businessName}</strong> team will review availability and confirm with you soon.
    </p>
    ${r.servicio ? `<p style="font-size:13px;color:#555;background:#f5f5f5;padding:12px 16px;border-radius:8px;margin-top:16px">Service: <strong>${r.servicio}</strong></p>` : ''}
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

  const { clientId, nombre, telefono, email, fecha, hora, servicio, nota } = req.body || {};

  if (!clientId || !/^[a-z0-9-]+$/.test(clientId))
    return res.status(400).json({ error: 'Invalid clientId' });
  if (!nombre || !telefono || !fecha || !hora)
    return res.status(400).json({ error: 'nombre, telefono, fecha and hora are required' });

  try {
    const client = await redis.get(`client:${clientId}`);
    if (!client)        return res.status(404).json({ error: 'Client not found' });
    if (!client.active) return res.status(403).json({ error: 'Client inactive' });

    const ts  = Date.now();
    const key = `reservations:${clientId}:${ts}`;

    const reservation = {
      clientId,
      nombre:         String(nombre).slice(0, 120),
      telefono:       String(telefono).slice(0, 30),
      email:          String(email || '').slice(0, 120),
      fecha:          String(fecha).slice(0, 60),
      hora:           String(hora).slice(0, 30),
      servicio:       String(servicio || '').slice(0, 200),
      nota:           /^no$/i.test(String(nota || '').trim()) ? '' : String(nota || '').slice(0, 500),
      estado:         'pendiente',
      fechaSolicitud: new Date(ts).toISOString(),
    };

    // ── Save to KV (primary operation) ──────────────────────────────────
    await redis.set(key, reservation);
    console.log(`[api/reservations] Saved ${key}`);

    // ── Send emails (secondary — non-blocking, never breaks the response) ──
    const apiKey = process.env.RESEND_API_KEY;
    if (apiKey) {
      const resend       = new Resend(apiKey);
      const businessName = client.businessName || clientId;
      const lang         = client.language || 'es';
      const emails       = [];
      // Legacy clients (no features object) keep the old always-on behavior.
      const notifyOwner  = !client.features || client.features.emailNotifications !== false;

      if (notifyOwner && client.ownerEmail) {
        emails.push(
          resend.emails.send({
            from:    FROM,
            to:      client.ownerEmail,
            subject: `Nueva solicitud de reserva — ${reservation.nombre}`,
            html:    ownerHtml(reservation, businessName),
          })
        );
      }

      if (reservation.email) {
        const es = lang !== 'en';
        emails.push(
          resend.emails.send({
            from:    FROM,
            to:      reservation.email,
            subject: es
              ? `Tu solicitud fue recibida — ${businessName}`
              : `Your request was received — ${businessName}`,
            html: clientHtml(reservation, businessName, lang),
          })
        );
      }

      if (emails.length) {
        Promise.allSettled(emails).then(results => {
          results.forEach((r, i) => {
            if (r.status === 'rejected')
              console.error(`[api/reservations] Email ${i} failed:`, r.reason?.message);
            else
              console.log(`[api/reservations] Email ${i} sent:`, r.value?.data?.id);
          });
        });
      }
    } else {
      console.warn('[api/reservations] RESEND_API_KEY not set — skipping emails');
    }

    return res.status(201).json({ ok: true, key });

  } catch (err) {
    console.error('[api/reservations]', err.message);
    return res.status(500).json({ error: 'Database error' });
  }
}
