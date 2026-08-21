import { Redis } from '@upstash/redis';
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { sanitizeServiceList } from '../lib/services.js';
import { initSentry, captureApiException } from '../lib/sentry.js';
import { isValidDurationMinutes } from '../lib/duration.js';

initSentry();
// Cargado con import() dinámico a propósito: Vercel transpila este archivo a
// CommonJS, y un import estático del módulo ESM (.mjs) se convierte en require()
// -> ERR_REQUIRE_ESM en runtime (rompía GET /api/clients con 500). import()
// funciona igual desde CommonJS y desde ESM.
let _templatesMod;
async function getOfficialTemplate(id) {
  if (!_templatesMod) _templatesMod = await import('../lib/assistant-templates.mjs');
  return _templatesMod.getOfficialTemplate(id);
}
async function listOfficialTemplates() {
  if (!_templatesMod) _templatesMod = await import('../lib/assistant-templates.mjs');
  return _templatesMod.listOfficialTemplates();
}
async function buildTemplatePrompt(businessData, template) {
  if (!_templatesMod) _templatesMod = await import('../lib/assistant-templates.mjs');
  return _templatesMod.buildTemplatePrompt(businessData, template);
}

let redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY env var not set');
let stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

import { timingSafeEqual } from 'node:crypto';

function safeTokenCompare(provided, expected) {
  if (!provided || !expected) return false;
  const provBuf = Buffer.from(String(provided));
  const expBuf = Buffer.from(String(expected));
  if (provBuf.length !== expBuf.length) return false;
  return timingSafeEqual(provBuf, expBuf);
}

function verifyAdminToken(req) {
  const t = req.headers['x-admin-token'] || req.query?.adminKey;
  if (!t) return false;
  const testBypassSecret = process.env.TEST_BYPASS_SECRET || '';
  if (testBypassSecret !== '' && safeTokenCompare(t, testBypassSecret)) return true;
  const adminToken = process.env.ADMIN_TOKEN || '';
  if (!adminToken) return false;
  return safeTokenCompare(t, adminToken);
}

const ADMIN_FAILED_LIMIT = 10;
const ADMIN_FAILED_WINDOW_SEC = 3600;

async function checkAdminFailedRateLimit(redisClient, ip) {
  if (!ip || ip === 'unknown') return { blocked: false };
  try {
    const key = `ratelimit:admin_failed:${ip}`;
    const count = await redisClient.get(key);
    return { blocked: Number(count || 0) >= ADMIN_FAILED_LIMIT, count: Number(count || 0) };
  } catch (err) {
    return { blocked: false };
  }
}

async function recordAdminFailedAttempt(redisClient, ip) {
  if (!ip || ip === 'unknown' || !redisClient) return;
  try {
    const key = `ratelimit:admin_failed:${ip}`;
    if (typeof redisClient.incr === 'function') {
      const count = await redisClient.incr(key);
      if (count === 1 && typeof redisClient.expire === 'function') await redisClient.expire(key, ADMIN_FAILED_WINDOW_SEC);
      return;
    }
    const count = Number(await redisClient.get(key) || 0) + 1;
    await redisClient.set(key, count, { ex: ADMIN_FAILED_WINDOW_SEC });
  } catch (err) {}
}

async function resetAdminFailedAttempts(redisClient, ip) {
  if (!ip || ip === 'unknown') return;
  try {
    await redisClient.del(`ratelimit:admin_failed:${ip}`);
  } catch (err) {}
}

// Same defaults as admin.html's wizard (PLAN_FEATURES) — kept in sync manually
// since this is a vanilla, no-build-step codebase with no shared module.
const PLAN_FEATURES = {
  basic:   { faq: true, prices: true, catalog: true, reservations: false, leads: false, emailNotifications: false, cancellation: false, rescheduling: false },
  pro:     { faq: true, prices: true, catalog: true, reservations: true,  leads: true,  emailNotifications: true,  cancellation: true,  rescheduling: true  },
  premium: { faq: true, prices: true, catalog: true, reservations: true,  leads: true,  emailNotifications: true,  cancellation: true,  rescheduling: true  },
};
const FEATURE_KEYS = ['faq', 'prices', 'catalog', 'reservations', 'leads', 'emailNotifications', 'cancellation', 'rescheduling'];

// Zona horaria del negocio. Sin esto el asistente usa el UTC del servidor y
// le dice a una barbería de México que son las 11:35 cuando son las 5:35 de
// la madrugada. Se valida contra Intl: un valor inventado rompería toda
// conversión posterior.
function normalizeTimezone(tz) {
  const v = String(tz || '').trim();
  if (!v) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: v });
    return v;
  } catch (e) {
    return 'UTC';
  }
}

const GEOAPIFY_URL = 'https://api.geoapify.com/v1/geocode/search';
const GEOAPIFY_CONFIDENCE_MINIMUM = 0.9;

async function detectTimezone(address, country) {
  if (!process.env.GEOAPIFY_API_KEY) return { unavailable: true };
  const url = new URL(GEOAPIFY_URL);
  url.searchParams.set('text', address);
  url.searchParams.set('filter', `countrycode:${country}`);
  url.searchParams.set('limit', '2');
  url.searchParams.set('format', 'json');
  url.searchParams.set('apiKey', process.env.GEOAPIFY_API_KEY);

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Geoapify returned ${response.status}`);
  const results = (await response.json()).results;
  const first = Array.isArray(results) ? results[0] : null;
  const second = Array.isArray(results) ? results[1] : null;
  const timezone = first?.timezone?.name;
  const confidence = Number(first?.rank?.confidence || 0);
  const ambiguousTimezone = second
    && Number(second?.rank?.confidence || 0) >= confidence - 0.02
    && second?.timezone?.name
    && second.timezone.name !== timezone;

  if (first?.country_code?.toLowerCase() !== country || confidence < GEOAPIFY_CONFIDENCE_MINIMUM || ambiguousTimezone || !isValidTimezone(timezone)) {
    return { timezone: null, address: null };
  }
  return { timezone, address: String(first.formatted || address) };
}

// Cuántas citas simultáneas admite el negocio: barberos, cabinas, mesas.
function normalizeCapacity(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 1 && n <= 100 ? n : 1;   // por defecto, uno
}

// Cualquier entero razonable entre 0 y 240 minutos (antes: solo 0/15/30/45).
// Number(), no parseInt(): parseInt('10.5')===10 truncaría un decimal en vez
// de rechazarlo. Aquí basta con no persistir un valor fuera de rango; el
// rechazo real ocurre antes, en missingTemplateFields.
function normalizeBufferMinutes(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 240 ? n : 0;
}

function normalizeReservationInterval(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 5 && n <= 240 && n % 5 === 0 ? n : 15;
}

// Correos que reciben los avisos de reserva del negocio. Array, minúsculas,
// sin espacios, sin duplicados, máximo 10. Se descartan los que no sean correo.
function normalizeNotificationEmails(v) {
  if (!Array.isArray(v)) return [];
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const vistos = {};
  const out = [];
  v.forEach((e) => {
    const s = String(e || '').trim().toLowerCase().slice(0, 120);
    if (re.test(s) && !vistos[s]) { vistos[s] = 1; out.push(s); }
  });
  return out.slice(0, 10);
}

// Días sueltos cerrados (YYYY-MM-DD). Se descarta lo que no sea una fecha.
function normalizeHolidays(v) {
  if (!Array.isArray(v)) return [];
  return v.map(x => String(x || '').trim())
          .filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x))
          .slice(0, 60);
}

// Anticipación mínima para reservar, en horas.
function normalizeMinNotice(h) {
  const n = parseInt(h, 10);
  return Number.isFinite(n) && n >= 0 && n <= 720 ? n : 0;
}

// Duración de reserva a nivel de negocio -- SOLO Restaurante la usa (auditoría
// "contradicción duración Restaurante"): la duración por plato queda opcional
// (un plato no "dura" lo que dura ocupar una mesa), pero el motor de
// disponibilidad (durationFor() en api/reservations.js) necesita UNA fuente
// determinista para calcular cierre y solapamientos. Se guarda como string
// (misma gramática que servicio.duracion, "60"/"90 min"/"1 hora") porque
// durationFor() la interpreta con el mismo parser -- nunca se pre-convierte a
// número aquí para no inventar una segunda representación de la misma cosa.
function normalizeReservationDuration(v) {
  return String(v || '').trim().slice(0, 20);
}

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
function stripePriceIdFor(plan) {
  return plan === 'basic' ? process.env.STRIPE_PRICE_BASIC
    : plan === 'pro' ? process.env.STRIPE_PRICE_PRO
    : null;
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Fase 4.1 — mismas listas que usa el wizard nuevo en admin.html (idiomas,
// países de teléfono, días de la semana), repetidas aquí porque no hay
// módulo compartido en este proyecto sin build step.
const LANGUAGE_CODES = ['es', 'en', 'pt', 'fr'];
const PHONE_COUNTRY_CODES = ['US', 'MX', 'CL', 'AR', 'CO', 'PE', 'BR', 'ES', 'GB', 'CA'];
// Único mapa país -> código de marcado compartido en el backend. Antes
// phoneCountry y phoneCountryCode se validaban por separado (cada uno con su
// propia forma), así que "CL" + "+1" pasaba aunque Chile no sea +1. Solo se
// exige la correspondencia para templateId === 'spa' (ver missingTemplateFields);
// no cambia nada para restaurante, barbería ni el formulario legado.
const PHONE_DIAL_CODES = { US: '+1', CA: '+1', MX: '+52', CL: '+56', AR: '+54', CO: '+57', PE: '+51', BR: '+55', ES: '+34', GB: '+44' };
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
    // Un día que falta no es un día cerrado: es un día que no sabemos. Antes
    // se descartaba todo el horario (return null); ahora se marca unknown.
    if (!src || typeof src !== 'object') {
      out[day] = { enabled: false, unknown: true, ranges: [] };
      continue;
    }
    const ranges = Array.isArray(src.ranges) ? src.ranges.map(sanitizeHourRange).filter(Boolean).slice(0, 2) : [];
    // `unknown` se conserva. Se perdía aquí: la IA marca unknown:true cuando
    // el dueño no dijo el horario de ese día, y al guardar quedaba como
    // enabled:false — es decir, "cerrado". El validador de reservas rechaza
    // entonces citas en un día en el que el negocio quizá sí abre.
    out[day] = { enabled: !!src.enabled, unknown: src.unknown === true, ranges };
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

// La generación/validación de id y el saneado de una lista de servicios
// viven en lib/services.js — única fuente de verdad, compartida también con
// api/generate-client-config.js. Antes cada archivo tenía su propia copia
// (una de ellas ni siquiera generaba id), el mismo patrón de divergencia
// que ya causó el bug de client.services/client.menu desincronizados.
function sanitizeServices(services) {
  return sanitizeServiceList(services, 40);
}

function sanitizeMenu(menu) {
  return sanitizeServiceList(menu, 20);
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

function isValidTimezone(timezone) {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: String(timezone || '') });
    return true;
  } catch (e) {
    return false;
  }
}

function missingTemplateFields(template, values) {
  if (!template) return [];
  const missing = [];
  if (!values.businessName) missing.push('businessName');
  if (!values.address) missing.push('address');
  if (!values.phoneCountryCode || !values.phoneNumber) missing.push('phone');
  if (!EMAIL_RE.test(values.ownerEmail)) missing.push('ownerEmail');
  if (!isValidTimezone(values.timezone)) missing.push('timezone');
  if (!values.businessHours || !Object.values(values.businessHours).some(day => day.enabled && day.ranges.length)) missing.push('businessHours');
  const requiresDuration = template?.id !== 'restaurant';
  if (!values.services.length || values.services.some(service => !service.precio || (requiresDuration && !service.duracion))) missing.push('services');
  if (!values.features.reservations) missing.push('bookingEnabled');
  if (!values.notificationEmails.length) missing.push('notificationEmails');
  // Restaurante no exige duración por plato, pero SÍ exige una duración de
  // reserva a nivel de negocio -- sin ella, un restaurante "válido" quedaría
  // needsSetup:true de inmediato (lib/setup.js) apenas se creara (auditoría,
  // contradicción confirmada). Spa/Barbería no usan este campo en absoluto:
  // su duración obligatoria sigue siendo por servicio, sin cambios.
  if (template?.id === 'restaurant') {
    if (!isValidDurationMinutes(values.reservationDuration)) missing.push('reservationDuration');
  }
  // Duración de cada servicio: obligatoria y válida (1-1440 minutos) para
  // cualquier plantilla que la exija (Spa y Barbería). Antes esta validación
  // de FORMATO solo corría dentro de `if (template.id === 'spa')` -- Barbería
  // solo comprobaba que service.duracion no viniera vacía, así que un POST
  // directo con duracion:"60abc"/"pronto"/"0"/"-30"/"1500" pasaba la
  // validación igual, y durationFor() en api/reservations.js lo leía
  // silenciosamente como 0: rompía el corte "no cabe antes del cierre" y
  // dejaba de detectar solapamientos entre citas de barbería (auditoría,
  // riesgo confirmado). isValidDurationMinutes() es la misma función que usa
  // durationFor() para interpretar la duración en tiempo real ("60", "60
  // min", "1 hora" son formatos válidos ahí) -- validar con
  // Number.isInteger() puro habría rechazado "60 min", que el creador oficial
  // vía IA (api/generate-client-config.js, ver test/template-creation.test.mjs)
  // ya envía legítimamente hoy.
  if (requiresDuration) {
    const invalidDuration = values.services.some((service) => !isValidDurationMinutes(service.duracion));
    if (invalidDuration && !missing.includes('services')) missing.push('services');
  }
  if (template.id === 'spa') {
    const capacity = parseInt(values.capacityPerSlot, 10);
    // Number(), no parseInt(): un decimal como 10.5 debe rechazarse, no
    // truncarse a 10. Rango 0-240 (antes: solo 0/15/30/45).
    const buffer = Number(values.bufferMinutes);
    if (!Number.isFinite(capacity) || capacity < 1 || capacity > 100) missing.push('capacityPerSlot');
    if (!Number.isInteger(buffer) || buffer < 0 || buffer > 240) missing.push('bufferMinutes');

    // El código de marcado debe corresponder al país declarado — antes se
    // validaban por separado (cada uno con su propia forma), así que
    // phoneCountry:"CL" + phoneCountryCode:"+1" pasaba sin error.
    if (values.phoneCountry && values.phoneCountryCode && PHONE_DIAL_CODES[values.phoneCountry] !== values.phoneCountryCode) {
      missing.push('phoneCountryCode');
    }
    // Longitud del número ya normalizado (solo dígitos): el frontend exige
    // 6-14, pero antes el backend solo comprobaba que existiera algún valor.
    if (values.phoneNumber && (values.phoneNumber.length < 6 || values.phoneNumber.length > 14)) {
      missing.push('phone');
    }
  }
  return missing;
}

function templateRuntime(template) {
  if (!template) return null;
  return {
    plan: 'pro',
    features: {
      faq: !!template.features.faq,
      prices: true,
      // The existing assistant runtime renders restaurant menus as catalogs.
      catalog: !!(template.features.catalog || template.features.menu),
      reservations: !!template.features.booking,
      leads: !!template.features.booking,
      emailNotifications: !!template.features.emailNotifications,
      cancellation: !!template.features.cancellation,
      rescheduling: !!template.features.rescheduling,
    },
  };
}

function sanitizeTemplateData(template, data) {
  if (data === undefined) return { data: {}, error: null };
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { data: null, error: 'templateData must be an object' };
  }
  const source = data;
  if (template?.id === 'restaurant') {
    if (source.menuMetadata !== undefined && !Array.isArray(source.menuMetadata)) {
      return { data: null, error: 'templateData.menuMetadata must be an array' };
    }
    return { data: {
      menuMetadata: Array.isArray(source.menuMetadata) ? source.menuMetadata.slice(0, 40).map(item => ({
        itemName: String(item?.itemName || '').slice(0, 80),
        category: String(item?.category || '').slice(0, 60),
        dietaryTags: Array.isArray(item?.dietaryTags) ? item.dietaryTags.map(tag => String(tag || '').slice(0, 40)).filter(Boolean).slice(0, 8) : [],
        allergens: Array.isArray(item?.allergens) ? item.allergens.map(allergen => String(allergen || '').slice(0, 40)).filter(Boolean).slice(0, 12) : [],
      })).filter(item => item.itemName) : [],
    }, error: null };
  }
  if (template?.id === 'barber') {
    if ((source.barberStaff !== undefined && !Array.isArray(source.barberStaff)) ||
        (source.barberPolicies !== undefined && !Array.isArray(source.barberPolicies))) {
      return { data: null, error: 'templateData barber fields must be arrays' };
    }
    return { data: {
      barberStaff: Array.isArray(source.barberStaff) ? source.barberStaff.slice(0, 20).map(member => ({
        name: String(member?.name || '').slice(0, 80),
        specialties: Array.isArray(member?.specialties) ? member.specialties.map(specialty => String(specialty || '').slice(0, 60)).filter(Boolean).slice(0, 12) : [],
      })).filter(member => member.name) : [],
      barberPolicies: Array.isArray(source.barberPolicies) ? source.barberPolicies.map(policy => String(policy || '').slice(0, 200)).filter(Boolean).slice(0, 20) : [],
    }, error: null };
  }
  return { data: {}, error: null };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  'https://jbstudio.app');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  const rl = await checkAdminFailedRateLimit(redis, ip);
  if (rl.blocked) {
    return res.status(429).json({ error: 'Too many failed authentication attempts. Please try again later.' });
  }

  if (!verifyAdminToken(req)) {
    await recordAdminFailedAttempt(redis, ip);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  await resetAdminFailedAttempts(redis, ip);

  // ── POST ?action=detect-timezone: Geoapify lookup for the creator. ──────
  // The provider key is read only in this server function; callers receive
  // either an IANA suggestion or null when the location is not unambiguous.
  if (req.method === 'POST' && req.query?.action === 'detect-timezone') {
    const address = String(req.body?.address || '').trim();
    const country = String(req.body?.country || '').trim().toLowerCase();
    if (!address || address.length > 300 || !/^[a-z]{2}$/.test(country)) {
      return res.status(400).json({ error: 'Address and country are required' });
    }
    try {
      const suggestion = await detectTimezone(address, country);
      if (suggestion.unavailable) return res.status(503).json({ error: 'Timezone detection is unavailable' });
      return res.status(200).json(suggestion);
    } catch (err) {
      console.error('[api/clients] detect-timezone:', err.message);
      captureApiException(err, { feature: 'client_panel', route: '/api/clients?action=detect-timezone' });
      return res.status(502).json({ error: 'Timezone lookup failed' });
    }
  }

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
      captureApiException(err, { clientId: id, feature: 'client_panel', route: '/api/clients?action=preview-token' });
      return res.status(500).json({ error: 'Database error' });
    }
  }

  // ── GET ?action=templates: official template registry for the admin's
  // creator UI (name/requiredFields/features only — never promptBase). ──
  if (req.method === 'GET' && req.query?.action === 'templates') {
    try {
      return res.status(200).json(await listOfficialTemplates());
    } catch (err) {
      console.error('[api/clients] templates:', err.message);
      captureApiException(err, { feature: 'client_panel', route: '/api/clients?action=templates' });
      return res.status(500).json({ error: 'Template configuration error' });
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
      captureApiException(err, { feature: 'client_panel', route: '/api/clients' });
      return res.status(500).json({ error: 'Database error' });
    }
  }

  // ── POST: create client or administrative actions ───────────────────────
  if (req.method === 'POST') {
    if (req.query?.action === 'connect_stripe_trial' || req.body?.action === 'connect_stripe_trial') {
      const targetIds = Array.isArray(req.body?.clientIds) ? req.body.clientIds : ['spa', 'barberia-el-corte-fino', 'restaurante-e2e-intenso'];
      const results = {};
      const stripePriceId = process.env.STRIPE_PRICE_PRO || process.env.STRIPE_PRICE_BASIC || process.env.STRIPE_PRICE_PREMIUM || 'price_1Q_mock';

      for (const cid of targetIds) {
        const client = await redis.get(`client:${cid}`);
        if (!client) continue;

        let stripeCustomer;
        if (client.stripeCustomerId) {
          stripeCustomer = await stripe.customers.retrieve(client.stripeCustomerId);
        } else {
          stripeCustomer = await stripe.customers.create({
            name: client.businessName,
            email: client.ownerEmail || undefined,
            metadata: { clientId: cid }
          });
          client.stripeCustomerId = stripeCustomer.id;
        }

        let stripeSubscription = null;
        let checkoutSession = null;
        if (client.stripeSubscriptionId) {
          stripeSubscription = await stripe.subscriptions.retrieve(client.stripeSubscriptionId);
        } else {
          checkoutSession = await stripe.checkout.sessions.create({
            mode: 'subscription',
            payment_method_types: ['card'],
            payment_method_collection: 'always',
            line_items: [{ price: stripePriceId, quantity: 1 }],
            client_reference_id: cid,
            customer: stripeCustomer.id,
            metadata: { clientId: cid },
            subscription_data: {
              trial_period_days: 10,
              trial_settings: { end_behavior: { missing_payment_method: 'pause' } },
              metadata: { clientId: cid },
            },
            success_url: `https://jbstudio.app/success?client=${encodeURIComponent(cid)}`,
            cancel_url: `https://jbstudio.app/reservas/${encodeURIComponent(cid)}`,
          });
        }

        client.trial_end = stripeSubscription?.trial_end ? String(stripeSubscription.trial_end) : null;
        client.paymentStatus = stripeSubscription ? 'trialing' : 'awaiting_checkout';
        client.plan = client.plan || 'pro';
        client.active = !!stripeSubscription;
        client.trialEnabled = true;
        client.trialDays = 10;
        await redis.set(`client:${cid}`, client);

        results[cid] = {
          stripeCustomer: {
            id: stripeCustomer.id,
            name: stripeCustomer.name,
            email: stripeCustomer.email,
            livemode: stripeCustomer.livemode
          },
          stripeSubscription: stripeSubscription ? {
            id: stripeSubscription.id,
            status: stripeSubscription.status,
            trial_start: stripeSubscription.trial_start,
            trial_end: stripeSubscription.trial_end,
            trial_end_iso: new Date(stripeSubscription.trial_end * 1000).toISOString(),
            livemode: stripeSubscription.livemode,
          } : null,
          checkoutSession: checkoutSession ? { id: checkoutSession.id, url: checkoutSession.url } : null,
          updatedClientInRedis: {
            id: client.id,
            businessName: client.businessName,
            active: client.active,
            plan: client.plan,
            paymentStatus: client.paymentStatus,
            stripeCustomerId: client.stripeCustomerId,
            stripeSubscriptionId: client.stripeSubscriptionId,
            trial_end: client.trial_end
          }
        };
      }
      return res.status(200).json({ ok: true, results });
    }

    const {
      id, businessName, ownerName, ownerEmail, plan, color, language, whatsapp, prompt, menu,
      secondaryColor, style, address, hours, businessType, services, features, templateId, templateVersion,
      billingDay,
      languages, primaryLanguage, businessHours, phoneCountry, phoneCountryCode, phoneNumber,
      displayMode, widgetPosition, timezone, minNoticeHours, capacityPerSlot, bufferMinutes, reservationIntervalMinutes, holidays, notificationEmails, templateData,
      reservationDuration, testClock, test_clock,
    } = req.body || {};
    // Nota: monthlyPrice nunca se lee del body — siempre se deriva del plan
    // (PLAN_PRICES), para que coincida exactamente con lo que cobra Stripe.

    const missingBasic = [];
    if (!id) missingBasic.push('id');
    if (!businessName) missingBasic.push('businessName');
    if (missingBasic.length)
      return res.status(400).json({ error: 'Missing required fields', fields: missingBasic });
    if (!/^[a-z0-9-]+$/.test(id))
      return res.status(400).json({ error: 'id must be lowercase letters, numbers, and hyphens only' });
    if (id.length > 80)
      return res.status(400).json({ error: 'id too long (max 80 chars)' });
    if (ownerEmail && !EMAIL_RE.test(String(ownerEmail).slice(0, 120)))
      return res.status(400).json({ error: 'ownerEmail is not a valid email' });

    let planSafe = ['basic', 'pro', 'premium'].includes(plan) ? plan : 'basic';
    let featuresSafe = sanitizeFeatures(features, planSafe);
    const servicesSafe = sanitizeServices(services);
    // Metadatos opcionales para clientes creados desde plantillas versionadas.
    // No se infieren ni se escriben en clientes existentes: su prompt y su
    // configuración actual continúan siendo la fuente de verdad.
    const templateRequested = templateId !== undefined || templateVersion !== undefined;
    if (!templateRequested && templateData !== undefined) {
      return res.status(400).json({ error: 'templateData requires an official template' });
    }
    let template = null;
    if (templateRequested) {
      if (!templateId || !templateVersion) {
        return res.status(400).json({ error: 'templateId and templateVersion must be provided together' });
      }
      try {
        template = await getOfficialTemplate(String(templateId));
      } catch (err) {
        console.error('[api/clients] template:', err.message);
        captureApiException(err, { clientId: id, feature: 'client_panel', route: '/api/clients' });
        return res.status(500).json({ error: 'Template configuration error' });
      }
      if (!template || String(templateVersion) !== template.version) {
        return res.status(400).json({ error: 'Unknown or mismatched template version' });
      }
    }
    // Con una plantilla oficial válida, el prompt SIEMPRE se deriva del
    // promptBase server-side (más abajo, vía buildTemplatePrompt) — nunca se
    // confía en el prompt del body, aunque lo mande. Solo los clientes
    // legado sin plantilla (formularios antiguos) siguen requiriendo y
    // usando el prompt manual del body, igual que siempre.
    if (!template && !prompt)
      return res.status(400).json({ error: 'Missing required fields', fields: ['prompt'] });
    const templateIdSafe = template ? template.id : '';
    const templateVersionSafe = template ? template.version : '';
    const runtime = templateRuntime(template);
    if (runtime) {
      planSafe = runtime.plan;
      featuresSafe = runtime.features;
    }
    const templateDataResult = sanitizeTemplateData(template, templateData);
    if (templateDataResult.error) return res.status(400).json({ error: 'Invalid templateData', detail: templateDataResult.error });
    const templateDataSafe = templateDataResult.data;

    // Fase 4.1 — campos nuevos del wizard rediseñado. Todos opcionales y
    // aditivos: si el request no los manda (formulario legado), quedan en
    // null/undefined y no se guardan campos estructurados nuevos, pero los
    // campos legados (language/whatsapp/hours) se siguen guardando igual
    // que antes más abajo.
    const requestedLanguages = sanitizeLanguages(languages);
    // Cualquier plantilla OFICIAL (spa/barber/restaurant) es bilingüe por
    // diseño del producto — server-owned, ni el creador con IA ni un request
    // del navegador pueden anularlo. Antes esto se limitaba a
    // templateIdSafe==='spa': Barbería y Restaurante quedaban monolingües en
    // español porque no existía un prompt oficial en inglés para ellos
    // (api/client-chat.js) — ahora las 3 plantillas tienen su
    // promptBaseEn oficial, así que la misma regla aplica a cualquiera.
    // Clientes legado sin plantilla oficial (templateIdSafe==='') conservan
    // el comportamiento anterior: solo bilingües si el propio request lo pide.
    // [auditoría FASE 4 — bilingüe]
    const languagesSafe = templateIdSafe ? ['es', 'en'] : requestedLanguages;
    const primaryLanguageSafe = templateIdSafe ? 'es' : languagesSafe && languagesSafe.length
      ? (languagesSafe.includes(String(primaryLanguage || '').toLowerCase()) ? String(primaryLanguage).toLowerCase() : languagesSafe[0])
      : null;
    const businessHoursSafe = sanitizeBusinessHours(businessHours);
    const phoneCountrySafe = PHONE_COUNTRY_CODES.includes(String(phoneCountry || '').toUpperCase())
      ? String(phoneCountry).toUpperCase() : null;
    const phoneCountryCodeSafe = phoneCountrySafe && /^\+\d{1,4}$/.test(String(phoneCountryCode || ''))
      ? String(phoneCountryCode) : null;
    // Un número local puede empezar legítimamente con el mismo dígito que el
    // código de país (ej. +1 y un número de EE. UU. que empieza en "1") —
    // recortar por startsWith(codeDigits) a ciegas le comía un dígito real.
    // Solo se recorta el código cuando el texto original indica explícitamente
    // que es un número internacional completo: empieza con "+" o con "00".
    // Misma regla que normalizePhoneNumber() en admin.html, server-side.
    let phoneNumberSafe = '';
    if (phoneNumber != null) {
      const rawPhoneStr = String(phoneNumber).trim();
      let digits = rawPhoneStr.replace(/[^0-9]/g, '');
      let isInternational = false;
      if (/^\+/.test(rawPhoneStr)) {
        isInternational = true;
      } else if (/^00/.test(rawPhoneStr)) {
        isInternational = true;
        digits = digits.replace(/^00/, '');
      }
      if (isInternational && phoneCountryCodeSafe) {
        const codeDigits = phoneCountryCodeSafe.replace(/[^0-9]/g, '');
        if (codeDigits && digits.startsWith(codeDigits) && digits.length > codeDigits.length) {
          digits = digits.slice(codeDigits.length);
        }
      }
      phoneNumberSafe = digits.slice(0, 30);
    }
    const notificationEmailsSafe = normalizeNotificationEmails(notificationEmails);

    const missingTemplate = missingTemplateFields(template, {
      businessName: String(businessName || '').trim(),
      address: String(address || '').trim(),
      phoneCountry: phoneCountrySafe,
      phoneCountryCode: phoneCountryCodeSafe,
      phoneNumber: phoneNumberSafe,
      ownerEmail: String(ownerEmail || '').trim(),
      timezone,
      businessHours: businessHoursSafe,
      services: servicesSafe,
      features: featuresSafe,
      notificationEmails: notificationEmailsSafe,
      capacityPerSlot,
      bufferMinutes,
      reservationDuration,
    });
    if (missingTemplate.length) {
      return res.status(400).json({ error: 'Missing required template fields', fields: missingTemplate });
    }

    // menu[] (used by widget.js's visual carousel) is derived from services[]
    // when the wizard sends them — only populated if catalog is enabled, and
    // only from server-validated data (never trusts a client-supplied menu
    // when services[] is present). The legacy manual form keeps posting
    // menu[] directly; it's still sanitized the same way.
    const menuSafe = Array.isArray(services)
      // duracion viaja al menu: el chat la necesita para no aceptar un servicio
      // de 60 min a 15 minutos del cierre. id también viaja: es la misma clave
      // que usan las imágenes asociadas (client-images), y debe coincidir con
      // client.services[].id para que el widget y el panel las encuentren.
      ? (featuresSafe.catalog ? servicesSafe.map(s => ({ id: s.id, nombre: s.nombre, precio: s.precio, descripcion: s.descripcion, imagen: s.imagen, duracion: s.duracion })) : [])
      : sanitizeMenu(menu);

    const stripePriceId = stripePriceIdFor(planSafe);
    if (!stripePriceId) {
      return res.status(400).json({ error: `Client plan "${planSafe}" has no Stripe price configured` });
    }

    try {
      // Never overwrite an existing client — the admin must always get a
      // fresh/suffixed id instead.
      const existing = await redis.get(`client:${id}`);
      if (existing) return res.status(409).json({ error: 'id_exists' });

      const mode     = normalizeDisplayMode(displayMode);
      const position = normalizeWidgetPosition(widgetPosition);

      // Campos legados derivados: si el wizard nuevo mandó estructura,
      // language/whatsapp/hours se derivan de ella para que todo el código
      // viejo (prompt legado, widget, paneles) que todavía los lee como
      // texto plano siga funcionando sin cambios. Si no vino estructura
      // nueva (formulario legado), se guarda lo que mandó el request como
      // siempre.
      // primaryLanguageSafe ya vale 'es' para cualquier plantilla oficial
      // (ver arriba), así que ya no hace falta repetir el caso spa aquí.
      const languageDerived = primaryLanguageSafe || (language === 'en' ? 'en' : 'es');
      const whatsappDerived = phoneCountryCodeSafe && phoneNumberSafe
        ? `${phoneCountryCodeSafe}${phoneNumberSafe}`
        : String(whatsapp || '').slice(0, 30);
      const hoursDerived = businessHoursSafe
        ? businessHoursToText(businessHoursSafe)
        : String(hours || '').slice(0, 200);

      // El prompt nunca viene del body cuando hay una plantilla oficial: se
      // deriva del promptBase de esa plantilla + los datos ya validados del
      // negocio (mismo builder que usa api/generate-client-config.js). Sin
      // plantilla (cliente legado), se conserva el prompt manual del body.
      const promptSafe = template
        ? await buildTemplatePrompt({
            businessName, address,
            phoneCountryCode: phoneCountryCodeSafe, phoneNumber: phoneNumberSafe,
            services: servicesSafe, businessHours: businessHoursSafe,
          }, template)
        : String(prompt).slice(0, 6000);

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
        // Con plantilla oficial, el tipo de negocio SIEMPRE es el id de la
        // plantilla — nunca un valor suelto del body que podría no
        // corresponder (ej. businessType:'spa' con templateId:'restaurant').
        businessType: templateIdSafe || String(businessType || '').slice(0, 80),
        ...(templateIdSafe && templateVersionSafe
          ? { templateId: templateIdSafe, templateVersion: templateVersionSafe, templateData: templateDataSafe }
          : {}),
        // Canonical runtime staff list. `templateData.barberStaff` remains the
        // factual template payload; reservations read this normalized field.
        ...(templateIdSafe === 'barber' ? { staff: templateDataSafe.barberStaff } : {}),
        prompt:       promptSafe,
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
        // Server-authoritative: every new client starts Stripe's 10-day trial.
        trialEnabled: true,
        trialDays:    10,
        active:                true,
        paymentStatus:         'trialing',
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
        timezone:       normalizeTimezone(timezone),
        minNoticeHours: normalizeMinNotice(minNoticeHours),
        capacityPerSlot: normalizeCapacity(capacityPerSlot),
        reservationIntervalMinutes: normalizeReservationInterval(reservationIntervalMinutes),
        holidays:        normalizeHolidays(holidays),
        notificationEmails: notificationEmailsSafe,
        bufferMinutes:      normalizeBufferMinutes(bufferMinutes),
        // Solo Restaurante la exige (missingTemplateFields, arriba) y solo
        // Restaurante la usa (durationFor() en api/reservations.js); para
        // cualquier otra plantilla queda simplemente ausente, sin inventar
        // un valor que nadie va a leer.
        ...(templateIdSafe === 'restaurant' ? { reservationDuration: normalizeReservationDuration(reservationDuration) } : {}),
        widgetSnippet: `<script src="https://jbstudio.app/widget.js?id=${id}" data-position="${position}"></script>`,
        assistantUrl:  `https://jbstudio.app/asistente/${id}`,
      };

      const stripeCustomer = await stripe.customers.create({
        name: client.businessName,
        email: client.ownerEmail || undefined,
        metadata: { clientId: id },
        ...((testClock || test_clock) ? { test_clock: String(testClock || test_clock) } : {}),
      });
      const checkoutSession = await stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        payment_method_collection: 'always',
        line_items: [{ price: stripePriceId, quantity: 1 }],
        client_reference_id: id,
        customer: stripeCustomer.id,
        metadata: { clientId: id },
        subscription_data: {
          trial_period_days: 10,
          trial_settings: { end_behavior: { missing_payment_method: 'pause' } },
          metadata: { clientId: id },
        },
        success_url: `https://jbstudio.app/success?client=${encodeURIComponent(id)}`,
        cancel_url: `https://jbstudio.app/reservas/${encodeURIComponent(id)}`,
      });

      client.stripeCustomerId = stripeCustomer.id;
      client.paymentStatus = 'awaiting_checkout';
      client.active = false;
      client.stripeCheckoutSessionId = checkoutSession.id;
      await redis.set(`client:${id}`, client);
      return res.status(201).json({ ...client, checkoutUrl: checkoutSession.url });
    } catch (err) {
      console.error('[api/clients] POST:', err.message);
      captureApiException(err, { clientId: id, feature: 'client_panel', route: '/api/clients' });
      return res.status(500).json({ error: 'Database error' });
    }
  }

  // ── PUT: update client fields ───────────────────────────────────────────
  if (req.method === 'PUT') {
    const { id, active, prompt, businessName, ownerName, ownerEmail, plan,
            color, language, whatsapp, menu, services, features,
            timezone, minNoticeHours, businessHours, capacityPerSlot, bufferMinutes, reservationIntervalMinutes, holidays, notificationEmails,
            reservationDuration } = req.body || {};
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
      // Datos que las reservas inteligentes necesitan. Sin ellos el negocio
      // queda en needsSetup y el asistente no toma citas.
      // Clientes con plantilla oficial: igual que en POST, una zona horaria
      // inválida nunca cae en silencio a UTC -- se rechaza con 400 (auditoría
      // FASE 5, requisito 8). Clientes antiguos/sin plantilla mantienen el
      // comportamiento anterior (normalizeTimezone con fallback a UTC), para
      // no romper actualizaciones existentes que no pasan timezone válido.
      if (timezone !== undefined) {
        if (client.templateId && client.templateVersion && !isValidTimezone(timezone)) {
          return res.status(400).json({ error: 'Invalid timezone', fields: ['timezone'] });
        }
        client.timezone = normalizeTimezone(timezone);
      }
      if (minNoticeHours !== undefined) client.minNoticeHours = normalizeMinNotice(minNoticeHours);
      if (capacityPerSlot !== undefined) client.capacityPerSlot = normalizeCapacity(capacityPerSlot);
      if (bufferMinutes !== undefined) client.bufferMinutes = normalizeBufferMinutes(bufferMinutes);
      if (reservationIntervalMinutes !== undefined) client.reservationIntervalMinutes = normalizeReservationInterval(reservationIntervalMinutes);
      // Igual que timezone arriba: un Restaurante con plantilla oficial nunca
      // puede quedarse sin duración de reserva válida vía PUT -- eso volvería
      // a dejarlo needsSetup:true después de haber sido creado válidamente
      // (la misma contradicción que esta fase corrige). Cualquier otra
      // plantilla/cliente legado no usa este campo, así que no se valida.
      if (reservationDuration !== undefined) {
        if (client.templateId === 'restaurant' && client.templateVersion && !isValidDurationMinutes(reservationDuration)) {
          return res.status(400).json({ error: 'Invalid reservationDuration', fields: ['reservationDuration'] });
        }
        client.reservationDuration = normalizeReservationDuration(reservationDuration);
      }
      if (holidays !== undefined) client.holidays = normalizeHolidays(holidays);
      if (notificationEmails === null) delete client.notificationEmails;
      else if (notificationEmails !== undefined) client.notificationEmails = normalizeNotificationEmails(notificationEmails);
      if (features !== undefined && typeof features === 'object') {
        client.features = sanitizeFeatures(features, client.plan || 'basic');
      }
      if (businessHours !== undefined) {
        const bh = sanitizeBusinessHours(businessHours);
        if (bh) client.businessHours = bh;
      }
      // services es la fuente de verdad; menu siempre se deriva de ella. menu
      // como entrada independiente solo existe por compatibilidad con paneles
      // viejos que todavía lo mandan sin services: se trata como si fuera
      // services (mismo saneador, gana un id estable) y se re-deriva menu
      // desde ahí, igual que el camino normal — así nunca vuelven a
      // divergir. Si llegan ambos, services manda: el menu de la petición se
      // ignora por completo.
      const deriveMenu = (svc) => svc.map(x => ({
        id: x.id, nombre: x.nombre, precio: x.precio, descripcion: x.descripcion,
        imagen: x.imagen, duracion: x.duracion,
      }));
      // Igual que timezone/reservationDuration arriba: para un cliente con
      // plantilla oficial que exige duración por servicio (Spa/Barbería, no
      // Restaurante), un PUT directo con duracion:"60abc"/"pronto"/"0" nunca
      // debe colar en silencio -- si no, una petición directa a PUT saltaba
      // por completo la validación estricta que sí corre en POST (auditoría,
      // riesgo confirmado en Barbería). Clientes legado/sin plantilla
      // conservan el comportamiento anterior, sin este chequeo.
      const requiresServiceDuration = !!(client.templateId && client.templateVersion && client.templateId !== 'restaurant');
      if (services !== undefined && Array.isArray(services)) {
        if (requiresServiceDuration && services.some((s) => !isValidDurationMinutes(s && s.duracion))) {
          return res.status(400).json({ error: 'Invalid service duration', fields: ['services'] });
        }
        client.services = sanitizeServices(services);
        client.menu = deriveMenu(client.services);
      } else if (menu !== undefined && Array.isArray(menu)) {
        if (requiresServiceDuration && menu.some((s) => !isValidDurationMinutes(s && s.duracion))) {
          return res.status(400).json({ error: 'Invalid service duration', fields: ['services'] });
        }
        client.services = sanitizeServices(menu);
        client.menu = deriveMenu(client.services);
      }

      await redis.set(`client:${id}`, client);
      return res.status(200).json(client);
    } catch (err) {
      console.error('[api/clients] PUT:', err.message);
      captureApiException(err, { clientId: id, feature: 'client_panel', route: '/api/clients' });
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
      captureApiException(err, { clientId: id, feature: 'client_panel', route: '/api/clients' });
      return res.status(500).json({ error: 'Database error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export const __test = {
  safeTokenCompare,
  verifyAdminToken,
  checkAdminFailedRateLimit,
  recordAdminFailedAttempt,
  resetAdminFailedAttempts,
  setRedisForTests(value) { redis = value; },
  setStripeForTests(value) { stripe = value; },
};
