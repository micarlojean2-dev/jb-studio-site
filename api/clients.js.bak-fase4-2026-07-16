import { Redis } from '@upstash/redis';

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

function auth(req) {
  const t = req.headers['x-admin-token'] || req.query?.adminKey;
  return process.env.ADMIN_TOKEN && t === process.env.ADMIN_TOKEN;
}

// Same defaults as admin.html's wizard (PLAN_FEATURES) — kept in sync manually
// since this is a vanilla, no-build-step codebase with no shared module.
const PLAN_FEATURES = {
  basic:   { faq: true, prices: true, catalog: true, reservations: false, leads: false, emailNotifications: false, cancellation: false, rescheduling: false },
  pro:     { faq: true, prices: true, catalog: true, reservations: true,  leads: true,  emailNotifications: true,  cancellation: true,  rescheduling: true  },
  premium: { faq: true, prices: true, catalog: true, reservations: true,  leads: true,  emailNotifications: true,  cancellation: true,  rescheduling: true  },
};
const FEATURE_KEYS = ['faq', 'prices', 'catalog', 'reservations', 'leads', 'emailNotifications', 'cancellation', 'rescheduling'];
const STYLES = ['Moderno', 'Elegante', 'Amigable', 'Minimalista'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sanitizeServiceImage(raw) {
  const v = String(raw || '').slice(0, 500);
  if (/^data:/i.test(v)) return ''; // never persist local base64 blobs
  return v;
}

function sanitizeServices(services) {
  if (!Array.isArray(services)) return [];
  return services.slice(0, 40).map(item => ({
    nombre:      String(item?.nombre      || '').slice(0, 80),
    precio:      String(item?.precio      || '').slice(0, 30),
    duracion:    String(item?.duracion    || '').slice(0, 30),
    descripcion: String(item?.descripcion || '').slice(0, 200),
    imagen:      sanitizeServiceImage(item?.imagen),
  })).filter(item => item.nombre);
}

function sanitizeMenu(menu) {
  if (!Array.isArray(menu)) return [];
  return menu.slice(0, 20).map(item => ({
    nombre:      String(item?.nombre      || '').slice(0, 80),
    precio:      String(item?.precio      || '').slice(0, 30),
    descripcion: String(item?.descripcion || '').slice(0, 200),
    imagen:      sanitizeServiceImage(item?.imagen),
  })).filter(item => item.nombre);
}

function sanitizeFeatures(features, plan) {
  const defaults = PLAN_FEATURES[plan] || PLAN_FEATURES.basic;
  const out = {};
  FEATURE_KEYS.forEach(k => {
    const v = features && typeof features === 'object' ? features[k] : undefined;
    out[k] = typeof v === 'boolean' ? v : defaults[k];
  });
  return out;
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
    const {
      id, businessName, ownerName, ownerEmail, plan, color, language, whatsapp, prompt, menu,
      secondaryColor, style, address, hours, businessType, services, features,
      monthlyPrice, billingDay, trialEnabled, trialDays,
    } = req.body || {};

    if (!id || !businessName || !prompt)
      return res.status(400).json({ error: 'id, businessName, and prompt are required' });
    if (!/^[a-z0-9-]+$/.test(id))
      return res.status(400).json({ error: 'id must be lowercase letters, numbers, and hyphens only' });
    if (id.length > 80)
      return res.status(400).json({ error: 'id too long (max 80 chars)' });
    if (ownerEmail && !EMAIL_RE.test(String(ownerEmail).slice(0, 120)))
      return res.status(400).json({ error: 'ownerEmail is not a valid email' });

    const planSafe = ['basic', 'pro', 'premium'].includes(plan) ? plan : 'basic';
    const featuresSafe = sanitizeFeatures(features, planSafe);
    const servicesSafe = sanitizeServices(services);

    // menu[] (used by widget.js's visual carousel) is derived from services[]
    // when the wizard sends them — only populated if catalog is enabled, and
    // only from server-validated data (never trusts a client-supplied menu
    // when services[] is present). The legacy manual form keeps posting
    // menu[] directly; it's still sanitized the same way.
    const menuSafe = Array.isArray(services)
      ? (featuresSafe.catalog ? servicesSafe.map(s => ({ nombre: s.nombre, precio: s.precio, descripcion: s.descripcion, imagen: s.imagen })) : [])
      : sanitizeMenu(menu);

    try {
      // Never overwrite an existing client — the admin must always get a
      // fresh/suffixed id instead.
      const existing = await redis.get(`client:${id}`);
      if (existing) return res.status(409).json({ error: 'id_exists' });

      const { randomUUID } = await import('crypto');
      const client = {
        id,
        businessName: String(businessName).slice(0, 120),
        ownerName:    String(ownerName || '').slice(0, 120),
        ownerEmail:   String(ownerEmail || '').slice(0, 120),
        whatsapp:     String(whatsapp || '').slice(0, 30),
        plan:         planSafe,
        language:     language === 'en' ? 'en' : 'es',
        color:        /^#[0-9a-fA-F]{3,6}$/.test(color || '') ? color : '#1a4a2e',
        secondaryColor: /^#[0-9a-fA-F]{3,6}$/.test(secondaryColor || '') ? secondaryColor : '#f0f7f4',
        style:        STYLES.includes(style) ? style : 'Moderno',
        address:      String(address || '').slice(0, 200),
        hours:        String(hours || '').slice(0, 200),
        businessType: String(businessType || '').slice(0, 80),
        prompt:       String(prompt).slice(0, 6000),
        menu:         menuSafe,
        services:     servicesSafe,
        features:     featuresSafe,
        monthlyPrice: Number.isFinite(Number(monthlyPrice)) && Number(monthlyPrice) > 0 ? Math.min(Number(monthlyPrice), 100000) : null,
        billingDay:   Number.isInteger(Number(billingDay)) && Number(billingDay) >= 1 && Number(billingDay) <= 28 ? Number(billingDay) : 1,
        trialEnabled: !!trialEnabled,
        trialDays:    Number.isInteger(Number(trialDays)) && Number(trialDays) >= 1 && Number(trialDays) <= 90 ? Number(trialDays) : 7,
        // Server-authoritative — never trust these from the request body,
        // Stripe is not connected yet (Fase 4).
        active:             true,
        paymentStatus:      'pending',
        paidUntil:           null,
        paymentFailed:       false,
        stripeCustomerId:    null,
        stripeSubscriptionId: null,
        createdAt:    new Date().toISOString().slice(0, 10),
        panelToken:   randomUUID(),
        widgetSnippet: `<script src="https://jbstudio.app/widget.js?id=${id}"></script>`,
      };

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
