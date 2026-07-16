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

// Normaliza la fecha de la cita a ISO (YYYY-MM-DD) desde el texto libre del
// chat. Conservador a propósito: ante la duda devuelve '' en vez de adivinar.
// Un recordatorio enviado el día equivocado es peor que no enviarlo.
function rollYear(d, base, y, mon, day) {
  const mk = (x) => x.toISOString().slice(0, 10);
  const diasPasados = Math.floor((base - d) / 86400000);
  if (diasPasados > 30) {                    // muy atrás: se refiere al año que viene
    const next = new Date(Date.UTC(y + 1, mon, day));
    return next.getUTCDate() === day ? mk(next) : '';
  }
  if (diasPasados > 0) return '';            // pasó hace poco: ambiguo, no adivinamos
  return d.getUTCDate() === day ? mk(d) : '';
}

function parseFechaISO(raw, now) {
  const txt = String(raw || '').toLowerCase().trim();
  if (!txt) return '';
  const base = now ? new Date(now) : new Date();
  const mk = (d) => d.toISOString().slice(0, 10);
  const addDays = (d, n) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };

  if (/\bpasado\s+ma(ñ|n)ana\b/.test(txt)) return mk(addDays(base, 2));
  if (/\bhoy\b|\btoday\b/.test(txt)) return mk(base);
  if (/\bma(ñ|n)ana\b|\btomorrow\b/.test(txt)) return mk(addDays(base, 1));

  const DIAS = { domingo:0, lunes:1, martes:2, 'miercoles':3, 'miércoles':3, jueves:4, viernes:5, 'sabado':6, 'sábado':6,
                 sunday:0, monday:1, tuesday:2, wednesday:3, thursday:4, friday:5, saturday:6 };
  const MESES = { enero:0, febrero:1, marzo:2, abril:3, mayo:4, junio:5, julio:6, agosto:7,
                  septiembre:8, setiembre:8, octubre:9, noviembre:10, diciembre:11,
                  january:0, february:1, march:2, april:3, may:4, june:5, july:6, august:7,
                  september:8, october:9, november:10, december:11 };

  // "15 de julio" / "july 15" / "18 julio"
  const dm = txt.match(/\b(\d{1,2})\s*(?:de\s+)?([a-záéíóú]+)/);
  if (dm && MESES[dm[2]] !== undefined) {
    const day = parseInt(dm[1], 10), mon = MESES[dm[2]];
    if (day >= 1 && day <= 31) {
      let y = base.getUTCFullYear();
      let d = new Date(Date.UTC(y, mon, day));
      const r = rollYear(d, base, y, mon, day);
      if (r) return r;
    }
  }
  const md = txt.match(/\b([a-záéíóú]+)\s+(\d{1,2})\b/);
  if (md && MESES[md[1]] !== undefined) {
    const day = parseInt(md[2], 10), mon = MESES[md[1]];
    if (day >= 1 && day <= 31) {
      let y = base.getUTCFullYear();
      let d = new Date(Date.UTC(y, mon, day));
      const r = rollYear(d, base, y, mon, day);
      if (r) return r;
    }
  }

  // "este sábado" / "el viernes" / "sábado"
  for (const name in DIAS) {
    if (new RegExp('\\b' + name + '\\b').test(txt)) {
      const target = DIAS[name];
      let delta = (target - base.getUTCDay() + 7) % 7;
      if (delta === 0) delta = 7;                       // "el sábado" dicho un sábado = el próximo
      if (/\bpróximo\b|\bproximo\b|\bnext\b/.test(txt) && delta < 7) delta += 7;
      return mk(addDays(base, delta));
    }
  }

  // "2026-07-18" / "18/07" / "18-07-2026"
  const iso = txt.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return iso[0];
  const dmy = txt.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if (dmy) {
    const day = +dmy[1], mon = +dmy[2] - 1;
    let y = dmy[3] ? +dmy[3] : base.getUTCFullYear();
    if (y < 100) y += 2000;
    if (day >= 1 && day <= 31 && mon >= 0 && mon <= 11) {
      const d = new Date(Date.UTC(y, mon, day));
      if (d.getUTCDate() === day) return mk(d);
    }
  }
  return '';
}

// El chat entrega texto libre ("2", "dos", "para 4 personas"). Guardamos un
// entero cuando se puede deducir; si no, lo dejamos vacío en vez de inventar.
function normalizePersonas(v) {
  if (v === undefined || v === null || v === '') return '';
  const raw = String(v).trim();
  const digits = raw.match(/\d{1,3}/);
  if (digits) {
    const n = parseInt(digits[0], 10);
    return n >= 1 && n <= 200 ? n : '';
  }
  const words = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6,
                  siete: 7, ocho: 8, nueve: 9, diez: 10, one: 1, two: 2, three: 3,
                  four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  for (const w in words) {
    if (new RegExp('\\b' + w + '\\b', 'i').test(raw)) return words[w];
  }
  return '';
}

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
      ${r.personas ? row('Personas', r.personas) : ''}
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
    ${r.servicio || r.personas ? `<div style="font-size:13px;color:#555;background:#f5f5f5;padding:12px 16px;border-radius:8px;margin-top:16px">
      ${r.servicio ? `<div>Servicio: <strong>${r.servicio}</strong></div>` : ''}
      ${r.personas ? `<div style="margin-top:4px">Personas: <strong>${r.personas}</strong></div>` : ''}
    </div>` : ''}
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
    ${r.servicio || r.personas ? `<div style="font-size:13px;color:#555;background:#f5f5f5;padding:12px 16px;border-radius:8px;margin-top:16px">
      ${r.servicio ? `<div>Service: <strong>${r.servicio}</strong></div>` : ''}
      ${r.personas ? `<div style="margin-top:4px">People: <strong>${r.personas}</strong></div>` : ''}
    </div>` : ''}
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

  const { clientId, nombre, telefono, email, fecha, hora, servicio, personas, nota } = req.body || {};

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
      // Copia normalizada para poder consultar por día (recordatorios,
      // resumen, filtros). '' cuando el texto no permite deducirla sin riesgo.
      fechaISO:       parseFechaISO(fecha),
      hora:           String(hora).slice(0, 30),
      servicio:       String(servicio || '').slice(0, 200),
      personas:       normalizePersonas(personas),
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
