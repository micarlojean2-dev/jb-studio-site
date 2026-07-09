import { Resend } from 'resend';
import { Redis } from '@upstash/redis';

const FROM = 'reservas@jbstudio.app';
const DEMO_EMAIL_LIMIT = 2;

const redisUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const redis = redisUrl && redisToken ? new Redis({ url: redisUrl, token: redisToken }) : null;

function clean(value) {
  return String(value || '').trim();
}

function isValidEmail(email) {
  return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(email || '');
}

function getSessionKey(sessionId) {
  return `demo_email_session:${sessionId}`;
}

function buildDemoEmailHtml(payload) {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Demo JB Studio</title></head>
<body style="margin:0;padding:24px;background:#f6f4ee;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#173323;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #dfe6de;box-shadow:0 12px 28px rgba(0,0,0,0.08);">
      <tr><td style="padding:24px 28px;background:#173323;color:#f5f0e4;">
        <div style="font-size:12px;letter-spacing:.08em;opacity:.78;font-weight:700;">JB STUDIO DEMO</div>
        <div style="margin-top:8px;font-size:24px;font-weight:800;line-height:1.2;">Demo JB Studio: nueva reserva simulada</div>
      </td></tr>
      <tr><td style="padding:28px;">
        <p style="margin:0 0 18px;font-size:15px;line-height:1.7;">Esta es una reserva de prueba generada desde la demo de JB Studio.</p>
        <p style="margin:0 0 8px;font-size:15px;line-height:1.7;"><strong>Negocio:</strong> ${payload.business}</p>
        <p style="margin:0 0 8px;font-size:15px;line-height:1.7;"><strong>Cliente:</strong> ${payload.name}</p>
        <p style="margin:0 0 8px;font-size:15px;line-height:1.7;"><strong>Servicio:</strong> ${payload.service}</p>
        <p style="margin:0 0 8px;font-size:15px;line-height:1.7;"><strong>Fecha:</strong> ${payload.date}</p>
        <p style="margin:0 0 8px;font-size:15px;line-height:1.7;"><strong>Hora:</strong> ${payload.time}</p>
        <p style="margin:0 0 8px;font-size:15px;line-height:1.7;"><strong>Estado:</strong> ${payload.status}</p>
        <p style="margin:18px 0 0;font-size:14px;line-height:1.7;color:#5c6f63;">Asi se veria una notificacion cuando un cliente reserva usando tu asistente.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body>
</html>`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://jbstudio.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sessionId = clean(req.body?.sessionId);
  const email = clean(req.body?.email);
  const payload = {
    business: clean(req.body?.business) || 'Barbería Demo',
    name: clean(req.body?.name) || 'Cliente Demo',
    service: clean(req.body?.service) || 'Servicio Demo',
    date: clean(req.body?.date) || 'Mañana',
    time: clean(req.body?.time) || '4:00 PM',
    status: clean(req.body?.status) || 'Activa',
  };

  if (!sessionId) return res.status(400).json({ error: 'sessionId requerido' });
  if (!isValidEmail(email)) return res.status(400).json({ error: 'email invalido' });

  try {
    if (redis) {
      const key = getSessionKey(sessionId);
      const current = Number(await redis.get(key) || 0);
      if (current >= DEMO_EMAIL_LIMIT) {
        return res.status(429).json({ error: 'Límite de correos demo alcanzado para esta sesión.' });
      }
      await redis.set(key, current + 1, { ex: 60 * 60 * 6 });
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return res.status(200).json({ ok: false, unavailable: true, message: 'Ahora mismo la demo de correo no está disponible, pero la reserva sí quedó simulada en la lista.' });
    }

    const resend = new Resend(apiKey);
    await resend.emails.send({
      from: FROM,
      to: email,
      subject: 'Demo JB Studio: nueva reserva simulada',
      html: buildDemoEmailHtml(payload),
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[api/demo-reservation-email]', err?.message || err);
    return res.status(200).json({ ok: false, unavailable: true, message: 'Ahora mismo la demo de correo no está disponible, pero la reserva sí quedó simulada en la lista.' });
  }
}
