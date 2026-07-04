import { Redis } from '@upstash/redis';

const redis = new Redis({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
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
    return res.status(200).json({
      businessName: client.businessName,
      color:        client.color    || '#1a4a2e',
      language:     client.language || 'es',
      active:       client.active !== false,
      menu:         Array.isArray(client.menu) ? client.menu : [],
    });
  } catch (err) {
    console.error('[api/client-config]', err.message);
    return res.status(500).json({ error: 'Service error' });
  }
}
