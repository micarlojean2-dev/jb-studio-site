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

// Admin preview tokens: short-lived so a leaked URL stops working quickly.
const PREVIEW_TTL_SECONDS = 15 * 60;

// Clients created before the display-mode picker have neither field.
const DISPLAY_MODES = ['fullscreen', 'widget'];
const WIDGET_POSITIONS = ['bottom-right', 'bottom-left'];
function normalizeDisplayMode(v) {
  return DISPLAY_MODES.includes(v) ? v : 'fullscreen';
}
function normalizeWidgetPosition(v) {
  return WIDGET_POSITIONS.includes(v) ? v : 'bottom-right';
}
const STYLES = ['Moderno', 'Elegante', 'Amigable', 'Minimalista'];
// Fase 4: únicamente estos dos planes tienen suscripción real en Stripe. El
// monto guardado siempre se deriva del plan — nunca de lo que mande el
// cliente — para que coincida exactamente con lo que Stripe va a cobrar.
const PLAN_PRICES = { basic: 49, pro: 65 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Fase 4.1 — mismas listas que usa el wizard nuevo en admin.html (idiomas,
// países de teléfono, días de la semana), repetidas aquí porque no hay
// módulo compartido en este proyecto sin build step.
const LANGUAGE_CODES = ['es', 'en', 'pt', 'fr'];
const PHONE_COUNTRY_CODES = ['US', 'MX', 'CL', 'AR', 'CO', 'PE', 'BR', 'ES', 'GB', 'CA'];
const TIME_RE = /^\d{2}:\d{2}$/;
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_LABELS = { monday: 'Lunes', tuesday: 'Martes', wednesday: 'Miércoles', thursday: 'Jueves', friday: 'Viernes', saturday: 'Sábado', sunday: 'Domingo' };

function sanitizeLanguages(languages) {
  if (!Array.isArray(languages)) return null;
  const out = [];
  languages.forEach(l => {
    const code = String(l || '').toLowerCase();
    if (LANGUAGE_CODES.includes(code) && !out.includes(code)) out.push(code);
  });
  return out.slice(0, 4);
}

function sanitizeHourRange(range) {
  const start = String(range?.start || '');
  const end = String(range?.end || '');
  if (!TIME_RE.test(start) || !TIME_RE.test(end)) return null;
  return { start, end };
}

function sanitizeBusinessHours(businessHours) {
  if (!businessHours || typeof businessHours !== 'object') return null;
  const out = {};
  for (const day of DAYS) {
    const src = businessHours[day];
    if (!src || typeof src !== 'object') return null;
    const ranges = Array.isArray(src.ranges) ? src.ranges.map(sanitizeHourRange).filter(Boolean).slice(0, 2) : [];
    out[day] = { enabled: !!src.enabled, ranges };
  }
  return out;
}

function businessHoursToText(businessHours) {
  return DAYS.map(day => {
    const d = businessHours[day];
    const label = DAY_LABELS[day];
    if (!d.enabled || !d.ranges.length) return `${label}: Cerrado`;
    return `${label}: ${d.ranges.map(r => `${r.start}–${r.end}`).join(', ')}`;
  }).join('\n');
}

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

// El plan es un TECHO, no un valor por defecto. Antes cualquier booleano que
// llegara en la petición ganaba, así que un Básico podía quedarse con
// reservations:true — funciones de pago regaladas. Ahora se puede APAGAR algo
// que el plan sí incluye, pero nunca ENCENDER algo que no incluye.
function sanitizeFeatures(features, plan) {
  const allowed = PLAN_FEATURES[plan] || PLAN_FEATURES.basic;
  const out = {};
  FEATURE_KEYS.forEach(k => {
    if (allowed[k] === false) { out[k] = false; return; }   // el plan no lo incluye: fin
    const v = features && typeof features === 'object' ? features[k] : undefined;
    out[k] = typeof v === 'boolean' ? v : allowed[k];
  });
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  'https://jbstudio.app');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!auth(req)) return res.status(401).json({ error: 'Unauthorized' });

  // ── POST ?action=preview-token: mint a short-lived admin preview token ──
  // Lets the admin talk to a chatbot that has not been paid for yet, without
  // activating it publicly. The token is random, server-side, expires in 15
  // minutes and only unlocks the one client it was minted for. It is NOT the
  // ADMIN_TOKEN and grants nothing else.
  if (req.method === 'POST' && req.query?.action === 'preview-token') {
    const { id } = req.body || {};
    if (!id || !/^[a-z0-9-]+$/.test(id))
      return res.status(400).json({ error: 'Valid id is required' });
    try {
      const client = await redis.get(`client:${id}`);
      if (!client) return res.status(404).json({ error: 'Client not found' });

      const { randomBytes } = await import('crypto');
      const token = randomBytes(32).toString('hex');
      await redis.set(`preview:${token}`, { clientId: id }, { ex: PREVIEW_TTL_SECONDS });

      return res.status(200).json({
        previewToken: token,
        expiresInSeconds: PREVIEW_TTL_SECONDS,
        previewUrl: `https://jbstudio.app/asistente/${encodeURIComponent(id)}?preview=${token}`,
      });
    } catch (err) {
      console.error('[api/clients] preview-token:', err.message);
      return res.status(500).json({ error: 'Database error' });
    }
  }

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
      billingDay, trialEnabled, trialDays,
      languages, primaryLanguage, businessHours, phoneCountry, phoneCountryCode, phoneNumber,
      displayMode, widgetPosition,
    } = req.body || {};
    // Nota: monthlyPrice nunca se lee del body — siempre se deriva del plan
    // (PLAN_PRICES), para que coincida exactamente con lo que cobra Stripe.

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

    // Fase 4.1 — campos nuevos del wizard rediseñado. Todos opcionales y
    // aditivos: si el request no los manda (formulario legado), quedan en
    // null/undefined y no se guardan campos estructurados nuevos, pero los
    // campos legados (language/whatsapp/hours) se siguen guardando igual
    // que antes más abajo.
    const languagesSafe = sanitizeLanguages(languages);
    const primaryLanguageSafe = languagesSafe && languagesSafe.length
      ? (languagesSafe.includes(String(primaryLanguage || '').toLowerCase()) ? String(primaryLanguage).toLowerCase() : languagesSafe[0])
      : null;
    const businessHoursSafe = sanitizeBusinessHours(businessHours);
    const phoneCountrySafe = PHONE_COUNTRY_CODES.includes(String(phoneCountry || '').toUpperCase())
      ? String(phoneCountry).toUpperCase() : null;
    const phoneCountryCodeSafe = phoneCountrySafe && /^\+\d{1,4}$/.test(String(phoneCountryCode || ''))
      ? String(phoneCountryCode) : null;
    const phoneNumberSafe = phoneNumber != null ? String(phoneNumber).slice(0, 30) : '';

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

      const mode     = normalizeDisplayMode(displayMode);
      const position = normalizeWidgetPosition(widgetPosition);

      const { randomUUID } = await import('crypto');

      // Campos legados derivados: si el wizard nuevo mandó estructura,
      // language/whatsapp/hours se derivan de ella para que todo el código
      // viejo (prompt legado, widget, paneles) que todavía los lee como
      // texto plano siga funcionando sin cambios. Si no vino estructura
      // nueva (formulario legado), se guarda lo que mandó el request como
      // siempre.
      const languageDerived = primaryLanguageSafe || (language === 'en' ? 'en' : 'es');
      const whatsappDerived = phoneCountryCodeSafe && phoneNumberSafe
        ? `${phoneCountryCodeSafe}${phoneNumberSafe}`
        : String(whatsapp || '').slice(0, 30);
      const hoursDerived = businessHoursSafe
        ? businessHoursToText(businessHoursSafe)
        : String(hours || '').slice(0, 200);

      const client = {
        id,
        businessName: String(businessName).slice(0, 120),
        ownerName:    String(ownerName || '').slice(0, 120),
        ownerEmail:   String(ownerEmail || '').slice(0, 120),
        whatsapp:     whatsappDerived,
        plan:         planSafe,
        language:     languageDerived,
        color:        /^#[0-9a-fA-F]{3,6}$/.test(color || '') ? color : '#1a4a2e',
        secondaryColor: /^#[0-9a-fA-F]{3,6}$/.test(secondaryColor || '') ? secondaryColor : '#f0f7f4',
        style:        STYLES.includes(style) ? style : 'Moderno',
        address:      String(address || '').slice(0, 200),
        hours:        hoursDerived,
        businessType: String(businessType || '').slice(0, 80),
        prompt:       String(prompt).slice(0, 6000),
        menu:         menuSafe,
        services:     servicesSafe,
        features:     featuresSafe,
        // Fase 4.1 — estructura nueva, solo presente cuando el wizard la
        // manda (queda undefined/omitida para clientes creados con el
        // formulario legado, que no la necesitan).
        ...(languagesSafe && languagesSafe.length ? { languages: languagesSafe, primaryLanguage: primaryLanguageSafe } : {}),
        ...(businessHoursSafe ? { businessHours: businessHoursSafe } : {}),
        ...(phoneCountrySafe && phoneCountryCodeSafe ? { phoneCountry: phoneCountrySafe, phoneCountryCode: phoneCountryCodeSafe, phoneNumber: phoneNumberSafe } : {}),
        monthlyPrice: PLAN_PRICES[planSafe] || null,
        billingDay:   Number.isInteger(Number(billingDay)) && Number(billingDay) >= 1 && Number(billingDay) <= 28 ? Number(billingDay) : 1,
        trialEnabled: !!trialEnabled,
        trialDays:    Number.isInteger(Number(trialDays)) && Number(trialDays) >= 1 && Number(trialDays) <= 90 ? Number(trialDays) : 7,
        // Server-authoritative — never trust these from the request body.
        // Fase 4: el chatbot ya no queda activo al crearse — necesita el
        // primer pago real. Solo el webhook de Stripe puede poner active:true
        // o cambiar paymentStatus a partir de aquí (ver api/stripe-webhook.js).
        active:                false,
        paymentStatus:         'pending',
        paidUntil:             null,
        paymentFailed:         false,
        stripeCustomerId:      null,
        stripeSubscriptionId:  null,
        stripeCheckoutSessionId: null,
        lastPaymentAt:         null,
        nextPaymentAt:         null,
        gracePeriodEndsAt:     null,
        cancelAtPeriodEnd:     false,
        cancelledAt:           null,
        createdAt:    new Date().toISOString().slice(0, 10),
        panelToken:   randomUUID(),
        displayMode:    mode,
        widgetPosition: position,
        widgetSnippet: `<script src="https://jbstudio.app/widget.js?id=${id}" data-position="${position}"></script>`,
        assistantUrl:  `https://jbstudio.app/asistente/${id}`,
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
      if (plan      !== undefined && ['basic','pro','premium'].includes(plan)) {
        client.plan = plan;
        // Mantiene el monto sincronizado con el plan, igual que en la creación.
        if (PLAN_PRICES[plan]) client.monthlyPrice = PLAN_PRICES[plan];
      }
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
