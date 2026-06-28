const crypto = require('crypto');

// ─────────────────────────────────────────────────────────────────────────────
// RATE LIMITING — store en memoria por proceso
// En Vercel cada instancia cálida mantiene este Map. Es suficiente para un
// sitio de tráfico moderado. Para escalar a múltiples instancias simultáneas
// usa Upstash Redis con @upstash/ratelimit.
// ─────────────────────────────────────────────────────────────────────────────
const ipStore = new Map(); // Map<ip, IpData>

const HOUR_MS   = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const DAY_MS    = 24 * 60 * 60 * 1000;

const LIMIT_RPH        = 20;  // requests por IP por hora
const LIMIT_SESSIONS   = 3;   // sesiones por IP por día
const LIMIT_MSGS       = 15;  // mensajes por sesión
const SUSPICIOUS_RPM   = 10;  // umbral de alerta por minuto

function getIpData(ip) {
  const now = Date.now();
  if (!ipStore.has(ip)) {
    ipStore.set(ip, {
      hourRequests:      0,
      hourWindowStart:   now,
      daySessionStarts:  0,
      dayStart:          now,
      minuteRequests:    0,
      minuteWindowStart: now,
    });
  }
  const d = ipStore.get(ip);
  if (now - d.hourWindowStart   > HOUR_MS)   { d.hourRequests    = 0; d.hourWindowStart   = now; }
  if (now - d.dayStart          > DAY_MS)    { d.daySessionStarts= 0; d.dayStart          = now; }
  if (now - d.minuteWindowStart > MINUTE_MS) { d.minuteRequests  = 0; d.minuteWindowStart = now; }
  return d;
}

// Limpia entradas expiradas cada 200 requests para evitar fugas de memoria
let cleanupTick = 0;
function maybeCleanup() {
  if (++cleanupTick < 200) return;
  cleanupTick = 0;
  const now = Date.now();
  for (const [ip, d] of ipStore) {
    if (now - d.hourWindowStart > HOUR_MS && now - d.dayStart > DAY_MS) ipStore.delete(ip);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EMAIL — envía el brief al dueño via Resend
// ─────────────────────────────────────────────────────────────────────────────
async function sendLeadEmail(briefData, messages, rawResponse) {
  const resendKey  = process.env.RESEND_API_KEY;
  const ownerEmail = process.env.OWNER_EMAIL;

  if (!resendKey || !ownerEmail) {
    console.warn('[api/chat] RESEND_API_KEY o OWNER_EMAIL no configurados — email omitido');
    return;
  }

  const cleanFinalText = rawResponse.replace(/\{\{BRIEF:[\s\S]*?\}\}/, '').trimEnd();
  const fullThread = [
    ...messages.filter(m => m.content !== '(start)'),
    { role: 'assistant', content: cleanFinalText },
  ];

  const threadRows = fullThread.map(m => {
    const isUser = m.role === 'user';
    const safe   = m.content
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
    return `
      <tr><td style="padding:5px 0;">
        <div style="background:${isUser ? '#6C5FFF' : '#1e1e2e'};color:#fff;
                    padding:10px 14px;border-radius:10px;font-size:13px;line-height:1.55;
                    max-width:82%;${isUser ? 'margin-left:auto;text-align:right;' : 'margin-right:auto;'}">
          <span style="display:block;font-size:10px;font-weight:700;opacity:0.65;
                       margin-bottom:4px;letter-spacing:0.05em;">
            ${isUser ? 'Cliente' : 'Asistente'}
          </span>
          ${safe}
        </div>
      </td></tr>`;
  }).join('');

  const briefFields = [
    ['Nombre',       briefData.name      || '—'],
    ['Negocio',      briefData.business  || '—'],
    ['Template',     briefData.template  || '—'],
    ['Precio',       briefData.price     || '—'],
    ['Logo',         briefData.logo      || '—'],
    ['Fotos',        briefData.photos    || '—'],
    ['Textos/Copy',  briefData.texts     || '—'],
    ['Hosting',      briefData.hosting   || '—'],
    ['Fecha límite', briefData.deadline  || '—'],
  ];

  const briefRows = briefFields.map(([label, value], i) => {
    const safe = String(value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `
      <tr style="background:${i % 2 === 0 ? '#f9f9fc' : '#ffffff'};">
        <td style="padding:9px 16px;font-size:12px;color:#6b7280;font-weight:700;
                   width:130px;border-bottom:1px solid #f0f0f6;white-space:nowrap;">${label}</td>
        <td style="padding:9px 16px;font-size:13px;color:#111827;
                   border-bottom:1px solid #f0f0f6;">${safe}</td>
      </tr>`;
  }).join('');

  const waText = encodeURIComponent(
    `Hola ${briefData.name}, vi tu solicitud en el chatbot de JB Studio. ¿Empezamos con tu proyecto?`
  );
  const waHref = `https://wa.me/15035931690?text=${waText}`;

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Nuevo lead — JB Studio</title>
</head>
<body style="margin:0;padding:0;background:#f0f0f6;
             font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f0f6;padding:36px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0"
             style="max-width:600px;width:100%;background:#ffffff;
                    border-radius:16px;overflow:hidden;
                    box-shadow:0 4px 32px rgba(0,0,0,0.10);">
        <tr>
          <td style="background:linear-gradient(135deg,#6C5FFF 0%,#A89BFF 100%);padding:30px 32px;">
            <p style="margin:0 0 4px;color:rgba(255,255,255,0.75);font-size:11px;
                      font-weight:700;letter-spacing:0.1em;">JB STUDIO — CHATBOT</p>
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:800;
                       letter-spacing:-0.01em;">🎯 Nuevo lead calificado</h1>
            <p style="margin:8px 0 0;color:rgba(255,255,255,0.80);font-size:13px;">
              El asistente completó el brief con un cliente. Aquí tienes todos los detalles.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px 0;">
            <h2 style="margin:0 0 14px;font-size:13px;font-weight:800;color:#374151;
                       letter-spacing:0.08em;text-transform:uppercase;">Datos del cliente</h2>
            <table width="100%" cellpadding="0" cellspacing="0"
                   style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
              ${briefRows}
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:22px 32px 0;">
            <a href="${waHref}" target="_blank"
               style="display:inline-block;background:#25D366;color:#ffffff;
                      text-decoration:none;padding:12px 24px;border-radius:8px;
                      font-size:14px;font-weight:700;
                      box-shadow:0 4px 14px rgba(37,211,102,0.35);">
              💬 Responder por WhatsApp
            </a>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px 0;">
            <hr style="border:none;border-top:1px solid #f0f0f6;margin:0;">
          </td>
        </tr>
        <tr>
          <td style="padding:24px 32px 0;">
            <h2 style="margin:0 0 14px;font-size:13px;font-weight:800;color:#374151;
                       letter-spacing:0.08em;text-transform:uppercase;">Conversación completa</h2>
            <table width="100%" cellpadding="0" cellspacing="0">
              ${threadRows}
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px;">
            <p style="margin:0;font-size:11px;color:#9ca3af;text-align:center;">
              Email generado automáticamente por el chatbot de JB Studio · No responder a este correo
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${resendKey}`,
    },
    body: JSON.stringify({
      from:    'JB Studio Bot <onboarding@resend.dev>',
      to:      [ownerEmail],
      subject: `🎯 Nuevo lead: ${briefData.name} — ${briefData.business}`,
      html,
    }),
  });

  if (!resendRes.ok) {
    const errBody = await resendRes.json().catch(() => ({}));
    throw new Error(`Resend ${resendRes.status}: ${JSON.stringify(errBody)}`);
  }

  const result = await resendRes.json();
  console.log('[api/chat] Email de lead enviado — id:', result.id, '| para:', ownerEmail);
}

// ─────────────────────────────────────────────────────────────────────────────
// HANDLER PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {

  // ── X-Request-ID ────────────────────────────────────────────────────────────
  const requestId = crypto.randomUUID();
  res.setHeader('X-Request-ID', requestId);

  // ── CORS ─────────────────────────────────────────────────────────────────────
  // ALLOWED_ORIGIN en .env / Vercel env vars. Sin ella: modo desarrollo (*)
  const allowedOrigin = process.env.ALLOWED_ORIGIN || null;
  const origin        = req.headers['origin'] || '';

  if (allowedOrigin) {
    if (origin && origin !== allowedOrigin) {
      console.warn(`[api/chat] CORS bloqueado: origin="${origin}" [req:${requestId}]`);
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.setHeader('Access-Control-Allow-Origin',  allowedOrigin);
  } else {
    res.setHeader('Access-Control-Allow-Origin',  '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // ── Preflight OPTIONS ────────────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // ── Método ───────────────────────────────────────────────────────────────────
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Content-Type ─────────────────────────────────────────────────────────────
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('application/json')) {
    return res.status(415).json({ error: 'Content-Type must be application/json' });
  }

  // ── IP ───────────────────────────────────────────────────────────────────────
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress
    || 'unknown';

  maybeCleanup();
  const ipd = getIpData(ip);
  ipd.hourRequests++;
  ipd.minuteRequests++;

  // ── IPs sospechosas (>10 req en <1 min) ─────────────────────────────────────
  if (ipd.minuteRequests > SUSPICIOUS_RPM) {
    console.warn(
      `[api/chat] IP sospechosa: ${ip} — ${ipd.minuteRequests} requests en <1 min [req:${requestId}]`
    );
  }

  // ── Rate limit: 20 req/hora ──────────────────────────────────────────────────
  if (ipd.hourRequests > LIMIT_RPH) {
    console.warn(`[api/chat] Rate limit excedido: ${ip} [req:${requestId}]`);
    return res.status(429).json({
      error: 'Has enviado demasiados mensajes. Por favor espera un momento antes de continuar.',
    });
  }

  // ── Body ─────────────────────────────────────────────────────────────────────
  const { messages, systemPrompt } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages must be a non-empty array' });
  }

  // ── Límite de mensajes por sesión ────────────────────────────────────────────
  if (messages.length > LIMIT_MSGS) {
    return res.status(200).json({
      text: 'Hemos llegado al límite de esta conversación. Para continuar hablando sobre tu proyecto, contacta al diseñador directamente por WhatsApp. ¡Gracias por tu interés en JB Studio! 👋',
    });
  }

  // ── Validación de mensajes ────────────────────────────────────────────────────
  for (const msg of messages) {
    if (!msg || typeof msg.content !== 'string' || !['user', 'assistant'].includes(msg.role)) {
      return res.status(400).json({ error: 'Invalid message format' });
    }
    if (msg.content.length > 2000) {
      return res.status(400).json({ error: 'Message exceeds 2000 character limit' });
    }
  }

  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  if (totalChars > 8000) {
    return res.status(400).json({ error: 'Total content exceeds limit' });
  }

  // ── Mensajes demasiado cortos → no llamar a Anthropic ────────────────────────
  // Va antes del chequeo de sesiones: un mensaje corto no consume cuota de sesión
  const lastMsg = messages[messages.length - 1];
  if (lastMsg.role === 'user' && lastMsg.content.trim().length < 3) {
    return res.status(200).json({
      text: 'Por favor escribe un poco más para que pueda ayudarte. 😊',
    });
  }

  // ── Límite de sesiones por IP por día ────────────────────────────────────────
  // Una sesión nueva comienza cuando messages tiene 1 solo mensaje (el trigger inicial)
  if (messages.length === 1) {
    ipd.daySessionStarts++;
    if (ipd.daySessionStarts > LIMIT_SESSIONS) {
      console.warn(`[api/chat] Máximo de sesiones diarias: ${ip} [req:${requestId}]`);
      return res.status(200).json({
        text: 'Has iniciado demasiadas conversaciones hoy. Vuelve mañana o contáctanos directamente por WhatsApp. ¡Hasta pronto! 👋',
      });
    }
  }

  // ── API key ───────────────────────────────────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error(`[api/chat] ANTHROPIC_API_KEY no configurada [req:${requestId}]`);
    return res.status(500).json({ error: 'Service temporarily unavailable' });
  }

  // ── Llamada a Anthropic ───────────────────────────────────────────────────────
  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 300,
        system:     typeof systemPrompt === 'string' ? systemPrompt.slice(0, 12000) : '',
        messages,
      }),
    });

    if (!upstream.ok) {
      console.error(`[api/chat] Anthropic devolvió ${upstream.status} [req:${requestId}]`);
      return res.status(502).json({ error: 'Assistant temporarily unavailable' });
    }

    const data = await upstream.json();
    const text = data.content?.[0]?.text || '';

    // ── Brief → email ─────────────────────────────────────────────────────────
    const briefMatch = text.match(/\{\{BRIEF:([\s\S]*?)\}\}/);
    if (briefMatch) {
      let briefData = null;
      try { briefData = JSON.parse(briefMatch[1]); }
      catch (e) { console.warn('[api/chat] Brief JSON inválido, email omitido:', e.message); }
      if (briefData) {
        sendLeadEmail(briefData, messages, text).catch(err =>
          console.error('[api/chat] Error enviando email de lead:', err.message)
        );
      }
    }

    return res.status(200).json({ text });

  } catch (err) {
    console.error(`[api/chat] Fetch error: ${err.message} [req:${requestId}]`);
    return res.status(500).json({ error: 'Service error' });
  }
};
