import { Redis } from '@upstash/redis';

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

function auth(req) {
  const t = req.headers['x-admin-token'] || req.query?.adminKey;
  return process.env.ADMIN_TOKEN && t === process.env.ADMIN_TOKEN;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  'https://jbstudio.app');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!auth(req)) return res.status(401).json({ error: 'Unauthorized' });

  // ── GET: list all clients ───────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const keys = await redis.keys('client:*');
      if (!keys.length) return res.status(200).json([]);
      const items = keys.length === 1
        ? [await redis.get(keys[0])]
        : await redis.mget(...keys);
      const clients = items
        .filter(Boolean)
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      return res.status(200).json(clients);
    } catch (err) {
      console.error('[api/clients] GET:', err.message);
      return res.status(500).json({ error: 'Database error' });
    }
  }

  // ── POST: create client ─────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { id, businessName, ownerName, ownerEmail, plan, color, language, whatsapp, prompt, menu } =
      req.body || {};

    if (!id || !businessName || !prompt)
      return res.status(400).json({ error: 'id, businessName, and prompt are required' });
    if (!/^[a-z0-9-]+$/.test(id))
      return res.status(400).json({ error: 'id must be lowercase letters, numbers, and hyphens only' });
    if (id.length > 80)
      return res.status(400).json({ error: 'id too long (max 80 chars)' });

    const { randomUUID } = await import('crypto');
    const client = {
      id,
      businessName: String(businessName).slice(0, 120),
      ownerName:    String(ownerName || '').slice(0, 120),
      ownerEmail:   String(ownerEmail || '').slice(0, 120),
      plan:         ['basic', 'pro', 'premium'].includes(plan) ? plan : 'basic',
      color:        /^#[0-9a-fA-F]{3,6}$/.test(color || '') ? color : '#1a4a2e',
      language:     language === 'en' ? 'en' : 'es',
      whatsapp:     String(whatsapp || '').slice(0, 30),
      prompt:       String(prompt).slice(0, 6000),
      active:       true,
      createdAt:    new Date().toISOString().slice(0, 10),
      panelToken:   randomUUID(),
      menu:         Array.isArray(menu)
        ? menu.slice(0, 20).map(item => ({
            nombre:      String(item.nombre      || '').slice(0, 80),
            precio:      String(item.precio      || '').slice(0, 30),
            descripcion: String(item.descripcion || '').slice(0, 200),
            imagen:      String(item.imagen      || '').slice(0, 500),
          })).filter(item => item.nombre)
        : [],
      widgetSnippet: `<script src="https://jbstudio.app/widget.js?id=${id}"></script>`,
    };

    try {
      await redis.set(`client:${id}`, client);
      return res.status(201).json(client);
    } catch (err) {
      console.error('[api/clients] POST:', err.message);
      return res.status(500).json({ error: 'Database error' });
    }
  }

  // ── PUT: update client fields ───────────────────────────────────────────
  if (req.method === 'PUT') {
    const { id, active, prompt, businessName, ownerName, ownerEmail, plan,
            color, language, whatsapp, menu } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id is required' });

    try {
      const client = await redis.get(`client:${id}`);
      if (!client) return res.status(404).json({ error: 'Client not found' });

      if (active    !== undefined) client.active       = !!active;
      if (prompt    !== undefined) client.prompt       = String(prompt).slice(0, 6000);
      if (businessName !== undefined) client.businessName = String(businessName).slice(0, 120);
      if (ownerName !== undefined) client.ownerName   = String(ownerName).slice(0, 120);
      if (ownerEmail!== undefined) client.ownerEmail  = String(ownerEmail).slice(0, 120);
      if (plan      !== undefined && ['basic','pro','premium'].includes(plan)) client.plan = plan;
      if (color     !== undefined && /^#[0-9a-fA-F]{3,6}$/.test(color)) client.color = color;
      if (language  !== undefined) client.language    = language === 'en' ? 'en' : 'es';
      if (whatsapp  !== undefined) client.whatsapp    = String(whatsapp).slice(0, 30);
      if (menu      !== undefined && Array.isArray(menu)) {
        client.menu = menu.slice(0, 20).map(item => ({
          nombre:      String(item.nombre      || '').slice(0, 80),
          precio:      String(item.precio      || '').slice(0, 30),
          descripcion: String(item.descripcion || '').slice(0, 200),
          imagen:      String(item.imagen      || '').slice(0, 500),
        })).filter(item => item.nombre);
      }

      await redis.set(`client:${id}`, client);
      return res.status(200).json(client);
    } catch (err) {
      console.error('[api/clients] PUT:', err.message);
      return res.status(500).json({ error: 'Database error' });
    }
  }

  // ── DELETE: remove client ───────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const id = req.query?.id || req.body?.id;
    if (!id) return res.status(400).json({ error: 'id is required' });
    if (!/^[a-z0-9-]+$/.test(id))
      return res.status(400).json({ error: 'Invalid id' });

    try {
      await redis.del(`client:${id}`);
      return res.status(200).json({ deleted: true });
    } catch (err) {
      console.error('[api/clients] DELETE:', err.message);
      return res.status(500).json({ error: 'Database error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
