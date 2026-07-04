import { Redis } from '@upstash/redis';

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// ── In-memory rate limit (30 req/IP/hour) ──────────────────────────────────
const ipStore = new Map();
const HOUR_MS = 60 * 60 * 1000;
const RPH     = 30;

function checkRateLimit(ip) {
  const now = Date.now();
  if (!ipStore.has(ip)) ipStore.set(ip, { count: 0, ts: now });
  const d = ipStore.get(ip);
  if (now - d.ts > HOUR_MS) { d.count = 0; d.ts = now; }
  return ++d.count <= RPH;
}

let tick = 0;
function maybeCleanup() {
  if (++tick < 500) return;
  tick = 0;
  const cutoff = Date.now() - HOUR_MS;
  for (const [ip, d] of ipStore) if (d.ts < cutoff) ipStore.delete(ip);
}

// ── Build system prompt with injected context ──────────────────────────────
function buildSystemPrompt(basePrompt) {
  const now  = new Date();
  const days = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const day  = days[now.getUTCDay()];
  const date = now.toLocaleDateString('es-ES', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });
  const time = now.toLocaleTimeString('es-ES', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' });

  const header = `Hoy es ${day}, ${date} y son las ${time} (horario UTC del servidor).

IMPORTANTE: No uses formato Markdown en tus respuestas. No uses asteriscos, no uses negritas, no uses guiones para listas. Escribe en texto plano y natural, como si fuera una conversación normal.

`;

  return header + (basePrompt || '');
}

// ── Handler ────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // Open CORS — clients embed widget on their own domains
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  maybeCleanup();
  if (!checkRateLimit(ip))
    return res.status(429).json({ error: 'Too many requests. Please wait before sending more messages.' });

  const { clientId, messages } = req.body || {};

  if (!clientId || !/^[a-z0-9-]+$/.test(clientId))
    return res.status(400).json({ error: 'Invalid clientId' });
  if (!Array.isArray(messages) || messages.length === 0)
    return res.status(400).json({ error: 'messages must be a non-empty array' });
  if (messages.length > 30)
    return res.status(400).json({ error: 'Too many messages in history' });

  for (const m of messages) {
    if (!m || typeof m.content !== 'string' || !['user', 'assistant'].includes(m.role))
      return res.status(400).json({ error: 'Invalid message format' });
    if (m.content.length > 2000)
      return res.status(400).json({ error: 'Message too long (max 2000 chars)' });
  }

  try {
    const client = await redis.get(`client:${clientId}`);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    if (!client.active) {
      return res.status(200).json({
        error:   'inactive',
        message: client.language === 'en'
          ? 'This service is temporarily unavailable.'
          : 'Este servicio no está disponible temporalmente.',
      });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Service unavailable' });

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system:     buildSystemPrompt(client.prompt),
        messages:   messages.slice(-20),
      }),
    });

    if (!upstream.ok) {
      console.error(`[api/client-chat] Anthropic ${upstream.status} for ${clientId}`);
      return res.status(502).json({ error: 'Assistant temporarily unavailable' });
    }

    const data = await upstream.json();
    let text = data.content?.[0]?.text || '';

    // Auto-inject [MOSTRAR_MENU] if keywords detected and marker not already present
    if (text && !text.includes('[MOSTRAR_MENU]')) {
      const MENU_KEYWORDS = /cat[áa]logo|im[áa]genes?|fotos?|servicios?|precios?|tratamientos?|productos?/i;
      const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content || '';
      if (MENU_KEYWORDS.test(lastUserMsg) || MENU_KEYWORDS.test(text)) {
        text = text + '\n[MOSTRAR_MENU]';
      }
    }

    return res.status(200).json({ text });

  } catch (err) {
    console.error('[api/client-chat]', err.message);
    return res.status(500).json({ error: 'Service error' });
  }
}
