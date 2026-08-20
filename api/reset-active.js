import { Redis } from '@upstash/redis';

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const auth = req.headers['x-reset-token'];
  if (auth !== 'jb-reset-2026') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { clientId } = req.body || {};
  if (!clientId) return res.status(400).json({ error: 'clientId required' });

  try {
    const raw = await redis.get(`client:${clientId}`);
    const client = typeof raw === 'string' ? JSON.parse(raw) : raw;
    client.active = false;
    await redis.set(`client:${clientId}`, JSON.stringify(client));
    return res.status(200).json({ ok: true, clientId, active: false });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
