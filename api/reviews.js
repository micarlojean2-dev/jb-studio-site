// api/reviews.js
// GET    /api/reviews              → reviews con 4-5★ (máx 20)
// GET    /api/reviews + x-admin-token header → todos los reviews (admin)
// POST   /api/reviews              → guardar nuevo review
// DELETE /api/reviews?id=X&token=Y → eliminar review (admin)

module.exports = async function handler(req, res) {
  const KV_URL   = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;

  if (!KV_URL || !KV_TOKEN) {
    return res.status(500).json({ error: 'Storage not configured' });
  }

  // ── KV helpers (Upstash REST API — no npm packages) ───────────────────────
  async function kvPipeline(commands) {
    const r = await fetch(`${KV_URL}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${KV_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(commands)
    });
    if (!r.ok) throw new Error(`KV error ${r.status}`);
    return r.json();
  }

  async function loadReviews() {
    const results = await kvPipeline([['GET', 'jb_reviews']]);
    const raw = results[0]?.result;
    return raw ? JSON.parse(raw) : [];
  }

  async function saveReviews(reviews) {
    await kvPipeline([['SET', 'jb_reviews', JSON.stringify(reviews)]]);
  }

  // ── Sanitize: strip HTML tags and trim ───────────────────────────────────
  function sanitize(val, maxLen) {
    return String(val || '')
      .replace(/<[^>]*>/g, '')
      .replace(/[<>"'`]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLen);
  }

  // ── CORS ──────────────────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin',  'https://jbstudio.app');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    // ── GET ─────────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const suppliedToken = req.headers['x-admin-token'] || '';

      // If a token was supplied but it's wrong, reject immediately
      if (suppliedToken && suppliedToken !== process.env.ADMIN_TOKEN) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      const isAdmin = suppliedToken && suppliedToken === process.env.ADMIN_TOKEN;
      const reviews = await loadReviews();
      const sorted  = [...reviews].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

      if (isAdmin) return res.status(200).json(sorted);

      const pub = sorted.filter(r => r.estrellas >= 4).slice(0, 20);
      return res.status(200).json(pub);
    }

    // ── POST ────────────────────────────────────────────────────────────────
    if (req.method === 'POST') {
      const { nombre, estrellas, comentario } = req.body || {};

      const stars = parseInt(estrellas, 10);
      if (isNaN(stars) || stars < 1 || stars > 5) {
        return res.status(400).json({ error: 'Invalid stars' });
      }

      const cleanName    = sanitize(nombre, 50);
      const cleanComment = sanitize(comentario, 300);

      if (!cleanName)    return res.status(400).json({ error: 'Name is required' });
      if (!cleanComment) return res.status(400).json({ error: 'Comment is required' });

      const review = {
        id:         `r${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
        nombre:     cleanName,
        estrellas:  stars,
        comentario: cleanComment,
        fecha:      new Date().toISOString()
      };

      const reviews = await loadReviews();
      reviews.push(review);
      await saveReviews(reviews);

      return res.status(201).json({ ok: true });
    }

    // ── DELETE ───────────────────────────────────────────────────────────────
    if (req.method === 'DELETE') {
      const { id, token } = req.query;

      if (!token || token !== process.env.ADMIN_TOKEN) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      if (!id) return res.status(400).json({ error: 'Missing id' });

      const reviews  = await loadReviews();
      const filtered = reviews.filter(r => r.id !== id);

      if (filtered.length === reviews.length) {
        return res.status(404).json({ error: 'Review not found' });
      }

      await saveReviews(filtered);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('[api/reviews]', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
