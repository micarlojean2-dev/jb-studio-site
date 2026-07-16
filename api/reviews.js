// api/reviews.js
// GET    /api/reviews                         → reviews 4-5★ (máx 20)
// GET    /api/reviews  (x-admin-token header) → todos los reviews
// POST   /api/reviews                         → guardar nuevo review
// DELETE /api/reviews?id=X&token=Y            → eliminar review (admin)

import { Redis } from '@upstash/redis';

// Fase 4.3: estaba usando KV_REST_API_URL/TOKEN, que no existen como
// variables de entorno en este proyecto de Vercel (mismo bug ya corregido en
// api/client-config.js, api/create-checkout.js y api/stripe-webhook.js) — este
// endpoint fallaba siempre al tocar Redis. Era el último que quedaba con el
// par viejo. Corregido para usar el mismo que el resto de la API.
const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

function sanitize(val, maxLen) {
  return String(val || '')
    .replace(/<[^>]*>/g, '')
    .replace(/[<>"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  'https://jbstudio.app');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    // ── GET ───────────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const suppliedToken = req.headers['x-admin-token'] || '';

      if (suppliedToken && suppliedToken !== process.env.ADMIN_TOKEN) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      const isAdmin  = !!(suppliedToken && suppliedToken === process.env.ADMIN_TOKEN);
      const reviews  = (await redis.get('jb_reviews')) ?? [];
      const sorted   = [...reviews].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

      if (isAdmin) return res.status(200).json(sorted);

      return res.status(200).json(sorted.filter(r => r.estrellas >= 4).slice(0, 20));
    }

    // ── POST ──────────────────────────────────────────────────────────────────
    if (req.method === 'POST') {
      const { nombre, estrellas, comentario } = req.body || {};

      const stars = parseInt(estrellas, 10);
      if (isNaN(stars) || stars < 1 || stars > 5) {
        return res.status(400).json({ error: 'Invalid stars' });
      }

      const cleanName    = sanitize(nombre,    50);
      const cleanComment = sanitize(comentario, 300);

      if (!cleanName)    return res.status(400).json({ error: 'Name is required' });
      if (!cleanComment) return res.status(400).json({ error: 'Comment is required' });

      const review = {
        id:         `r${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
        nombre:     cleanName,
        estrellas:  stars,
        comentario: cleanComment,
        fecha:      new Date().toISOString(),
      };

      const reviews = (await redis.get('jb_reviews')) ?? [];
      reviews.push(review);
      await redis.set('jb_reviews', reviews);

      return res.status(201).json({ ok: true });
    }

    // ── DELETE ────────────────────────────────────────────────────────────────
    if (req.method === 'DELETE') {
      const { id, token } = req.query;

      if (!token || token !== process.env.ADMIN_TOKEN) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      if (!id) return res.status(400).json({ error: 'Missing id' });

      const reviews  = (await redis.get('jb_reviews')) ?? [];
      const filtered = reviews.filter(r => r.id !== id);

      if (filtered.length === reviews.length) {
        return res.status(404).json({ error: 'Review not found' });
      }

      await redis.set('jb_reviews', filtered);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('[api/reviews]', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
}
