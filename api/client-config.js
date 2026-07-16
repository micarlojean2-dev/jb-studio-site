import { Redis } from '@upstash/redis';

// Fase 3: estaba usando KV_REST_API_URL/TOKEN, que no existen como variables
// de entorno en este proyecto Vercel (solo UPSTASH_REDIS_REST_URL/TOKEN, las
// mismas que usan todas las demás funciones) — esto hacía que este endpoint
// devolviera 500 en producción y que widget.js nunca cargara los datos
// reales del cliente. Corregido para usar el mismo par que el resto de la API.
const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' });

  const { id } = req.query || {};
  if (!id) return res.status(400).json({ error: 'id is required' });
  if (!/^[a-z0-9-]+$/.test(id)) return res.status(400).json({ error: 'Invalid id' });

  try {
    const client = await redis.get(`client:${id}`);
    if (!client) return res.status(404).json({ error: 'Not found' });

    // Return only public-safe fields — never expose prompt, panelToken, ownerEmail
    const out = {
      businessName: client.businessName,
      color:        client.color    || '#1a4a2e',
      language:     client.language || 'es',
      active:       client.active !== false,
      menu:         Array.isArray(client.menu) ? client.menu : [],
    };
    // Only present for clients created with the automatic wizard — omit the
    // key entirely for legacy clients so widget.js's "!== false" checks keep
    // defaulting to enabled (never send an empty {} that would look "set").
    if (client.features && typeof client.features === 'object') {
      out.features = client.features;
    }
    return res.status(200).json(out);
  } catch (err) {
    console.error('[api/client-config]', err.message);
    return res.status(500).json({ error: 'Service error' });
  }
}
