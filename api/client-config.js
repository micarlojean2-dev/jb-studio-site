import { Redis } from '@upstash/redis';
import { createHash, randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { faltaConfig, necesitaSetup } from '../lib/setup.js';
import { loadClientMedia } from '../lib/media.js';
import { findServiceByLinkedItemId } from '../lib/services.js';
import { initSentry, captureApiException } from '../lib/sentry.js';
import { hashPassword, verifyPassword } from '../lib/password.js';

initSentry();

// Este archivo aloja TRES handlers independientes para no superar el límite de
// funciones serverless del proyecto (12): el config público (GET, sin auth), la
// gestión admin de imágenes (auth por token, CORS restringido) y el health check
// (GET público, sin datos de clientes). El default export despacha a uno u otro;
// no comparten CORS ni autenticación. Las llamadas llegan reescritas desde
// /api/client-images y /api/health (ver vercel.json).
export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

// Fase 3: estaba usando KV_REST_API_URL/TOKEN, que no existen como variables
// de entorno en este proyecto Vercel (solo UPSTASH_REDIS_REST_URL/TOKEN, las
// mismas que usan todas las demás funciones) — esto hacía que este endpoint
// devolviera 500 en producción y que widget.js nunca cargara los datos
// reales del cliente. Corregido para usar el mismo par que el resto de la API.
//
// La validación de qué imagen cuenta como confirmada y pública vive en
// lib/media.js (loadClientMedia), compartida con confirmedMedia() en
// api/client-chat.js — antes cada una tenía su propio criterio y podían
// divergir (el modelo decía "hay fotos" que el widget nunca podía pintar).
const publicMedia = loadClientMedia;

export function createClientConfigHandler({ redis: store } = {}) {
  const dataStore = store || redis;
  return async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' });

  const { id } = req.query || {};
  if (!id) return res.status(400).json({ error: 'id is required' });
  if (!/^[a-z0-9-]+$/.test(id)) return res.status(400).json({ error: 'Invalid id' });

  try {
    const client = await dataStore.get(`client:${id}`);
    if (!client) return res.status(404).json({ error: 'Not found' });

    let subscriptionStatus = null;
    if (client.stripeSubscriptionId) {
      try {
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
        const sub = await stripe.subscriptions.retrieve(client.stripeSubscriptionId);
        subscriptionStatus = sub.status;
      } catch (_) {}
    }

    // Return only public-safe fields — never expose prompt, panelToken, ownerEmail
    const media = await publicMedia(dataStore, id);
    // findServiceByLinkedItemId (lib/services.js) es la única fuente de este
    // fallback id→nombre — antes vivía reimplementado aquí a mano. Se arma
    // por entrada de imagen (no por servicio) para conservar el mismo
    // comportamiento de antes ante un conflicto: si dos imágenes terminan
    // asociadas al mismo servicio, gana la última del array, igual que antes
    // con el Map.
    const clientMenu = Array.isArray(client.menu) ? client.menu : [];
    const imageByService = new Map();
    media.menu.forEach((entry) => {
      const service = findServiceByLinkedItemId(clientMenu, entry.itemId);
      if (service) imageByService.set(service, entry.imageUrl);
    });
    const menu = clientMenu.map((item) => {
      const imageUrl = imageByService.get(item);
      return imageUrl ? { ...item, imagen: imageUrl } : item;
    });
    const languages = Array.isArray(client.languages)
      ? client.languages.filter(language => ['es', 'en', 'pt', 'fr'].includes(language))
      : [];
    const language = client.language === 'en' ? 'en' : 'es';
    if (!languages.length) languages.push(language);
    const primaryLanguage = languages.includes(client.primaryLanguage) ? client.primaryLanguage : languages[0];
    const out = {
      businessName: client.businessName,
      templateId:   client.templateId || null,
      color:        client.color    || '#1a4a2e',
      language,
      // Additive for older consumers: `language` remains the legacy default.
      languages,
      primaryLanguage,
      active: (
        subscriptionStatus === 'active' ||
        subscriptionStatus === 'trialing' ||
        client.paymentStatus === 'paid'
      ),
      menu,
      // Legacy clients have neither field stored: they keep the original
      // fullscreen / bottom-right behavior.
      displayMode:    client.displayMode    === 'widget'      ? 'widget'      : 'fullscreen',
      widgetPosition: client.widgetPosition === 'bottom-left' ? 'bottom-left' : 'bottom-right',
      // El horario de apertura es información pública (está en la web del
      // negocio). El chat lo usa para resolver "a las 4" sin preguntar.
      businessHours:  client.businessHours && typeof client.businessHours === 'object' ? client.businessHours : null,
      // Se devuelve lo guardado, sin máscara: 'UTC' por defecto ocultaba si el
      // campo existía y obligaba a conjeturar durante los diagnósticos.
      timezone:       client.timezone || null,
      // El chat lo usa para no ofrecer reservas que el servidor rechazaría.
      needsSetup:     necesitaSetup(client),
      minNoticeHours: Number.isFinite(client.minNoticeHours) ? client.minNoticeHours : null,
      // Lista literal de lo que falta. No es información privada: solo dice qué
      // no está configurado, y permite diagnosticar sin el admin token.
      falta:          faltaConfig(client),
    };
    // Only present for clients created with the automatic wizard — omit the
    // key entirely for legacy clients so widget.js's "!== false" checks keep
    // defaulting to enabled (never send an empty {} that would look "set").
    if (client.features && typeof client.features === 'object') {
      out.features = client.features;
    }
    // Image references live separately from client configuration. This public
    // projection intentionally contains URLs only, never Cloudinary IDs.
    if (media.gallery.length || media.menu.length) out.media = media;
    return res.status(200).json(out);
  } catch (err) {
    console.error('[api/client-config]', err.message);
    captureApiException(err, { clientId: id, feature: 'chatbot_loader', route: '/api/client-config' });
    return res.status(500).json({ error: 'Service error' });
  }
  };
}

// ---------------------------------------------------------------------------
// Admin image management (antes api/client-images.js). Fusionado aquí sin
// cambios de lógica para respetar el límite de funciones serverless. Mantiene
// su propia autenticación admin y su CORS restringido, independientes del
// handler de config público de arriba.
// ---------------------------------------------------------------------------
const MAX_FILES = 8;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const IMAGE_FORMATS = new Set(['jpg', 'jpeg', 'png', 'webp']);
const CLIENT_ID_RE = /^[a-z0-9-]{1,80}$/;
const LINK_TYPE_RE = /^[a-z][a-z0-9_-]{0,31}$/;

function isAdmin(req, env) {
  const token = req.headers?.['x-admin-token'] || req.query?.adminKey;
  return Boolean(env.ADMIN_TOKEN && token === env.ADMIN_TOKEN);
}

function imageKey(clientId, publicId) {
  return `client-images:${clientId}:${publicId}`;
}

function clientFolder(clientId) {
  return `clients/${clientId}`;
}

function ownsPublicId(clientId, publicId) {
  return typeof publicId === 'string' && publicId.startsWith(`${clientFolder(clientId)}/`);
}

function cloudinaryConfig(env) {
  const cloudName = String(env.CLOUDINARY_CLOUD_NAME || '').trim();
  const apiKey = String(env.CLOUDINARY_API_KEY || '').trim();
  const apiSecret = String(env.CLOUDINARY_API_SECRET || '').trim();
  return cloudName && apiKey && apiSecret ? { cloudName, apiKey, apiSecret } : null;
}

function sign(params, apiSecret) {
  const payload = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  return createHash('sha1').update(`${payload}${apiSecret}`).digest('hex');
}

function publicUrls(cloudName, publicId) {
  const encodedId = publicId.split('/').map(encodeURIComponent).join('/');
  const base = `https://res.cloudinary.com/${encodeURIComponent(cloudName)}/image/upload`;
  return {
    imageUrl: `${base}/c_limit,w_1600/f_auto,q_auto:good,fl_strip_profile/${encodedId}`,
    thumbnailUrl: `${base}/c_fill,g_auto,w_320,h_240/f_auto,q_auto:low,fl_strip_profile/${encodedId}`,
  };
}

function validUploadDescriptors(files) {
  if (!Array.isArray(files) || files.length < 1 || files.length > MAX_FILES) return false;
  return files.every((file) => {
    const mime = String(file?.type || '').toLowerCase();
    const size = Number(file?.size);
    return ['image/jpeg', 'image/png', 'image/webp'].includes(mime)
      && Number.isSafeInteger(size) && size > 0 && size <= MAX_FILE_SIZE;
  });
}

function validAssociation(value) {
  if (!value || typeof value !== 'object' || !LINK_TYPE_RE.test(String(value.linkedType || ''))) return false;
  return value.linkedItemId === null || value.linkedItemId === undefined
    || (typeof value.linkedItemId === 'string' && value.linkedItemId.length <= 120);
}

async function cloudinaryResource(fetchImpl, cloud, publicId) {
  const url = `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloud.cloudName)}/resources/image/upload/${publicId.split('/').map(encodeURIComponent).join('%2F')}`;
  const response = await fetchImpl(url, {
    headers: { Authorization: `Basic ${Buffer.from(`${cloud.apiKey}:${cloud.apiSecret}`).toString('base64')}` },
  });
  if (!response.ok) return null;
  return response.json();
}

async function destroyCloudinaryImage(fetchImpl, cloud, publicId) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = sign({ invalidate: 'true', public_id: publicId, timestamp }, cloud.apiSecret);
  const body = new URLSearchParams({ public_id: publicId, timestamp: String(timestamp), invalidate: 'true', api_key: cloud.apiKey, signature });
  const response = await fetchImpl(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloud.cloudName)}/image/destroy`, {
    method: 'POST', body,
  });
  return response.ok;
}

export function createClientImagesHandler({ redis: store, fetchImpl = fetch, env = process.env } = {}) {
  if (!store) {
    store = new Redis({
      url: env.UPSTASH_REDIS_REST_URL,
      token: env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', 'https://jbstudio.app');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (!isAdmin(req, env)) return res.status(401).json({ error: 'Unauthorized' });

    const clientId = req.query?.clientId || req.body?.clientId;
    if (!CLIENT_ID_RE.test(String(clientId || ''))) return res.status(400).json({ error: 'Invalid clientId' });

    const cloud = cloudinaryConfig(env);
    if (!cloud) return res.status(503).json({ error: 'Image service is not configured' });

    try {
      if (!await store.get(`client:${clientId}`)) return res.status(404).json({ error: 'Client not found' });

      if (req.method === 'GET') {
        const keys = await store.keys(`client-images:${clientId}:*`);
        const records = keys.length === 0 ? [] : (keys.length === 1 ? [await store.get(keys[0])] : await store.mget(...keys));
        return res.status(200).json(records.filter(Boolean));
      }

      if (req.method === 'POST' && req.query?.action === 'upload') {
        const files = req.body?.files;
        if (!validUploadDescriptors(files)) return res.status(400).json({ error: `Provide 1-${MAX_FILES} JPG, PNG, or WebP files up to 10MB each` });
        const timestamp = Math.floor(Date.now() / 1000);
        const folder = clientFolder(clientId);
        const transformation = 'c_limit,w_1600/f_auto,q_auto:good,fl_strip_profile';
        const uploads = files.map(() => {
          const publicId = `${folder}/${randomUUID()}`;
          const params = { allowed_formats: 'jpg,jpeg,png,webp', folder, overwrite: 'false', public_id: publicId.slice(folder.length + 1), timestamp, transformation };
          return { publicId, folder, timestamp, apiKey: cloud.apiKey, signature: sign(params, cloud.apiSecret), uploadUrl: `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloud.cloudName)}/image/upload`, params };
        });
        // These are short-lived upload instructions, never files or credentials.
        return res.status(200).json({ uploads, maxFileSize: MAX_FILE_SIZE });
      }

      if (req.method === 'POST' && req.query?.action === 'confirm') {
        const publicIds = req.body?.publicIds;
        if (!Array.isArray(publicIds) || publicIds.length < 1 || publicIds.length > MAX_FILES || !publicIds.every(id => ownsPublicId(clientId, id))) {
          return res.status(400).json({ error: 'Invalid uploaded image references' });
        }
        const confirmed = [];
        for (const publicId of [...new Set(publicIds)]) {
          const resource = await cloudinaryResource(fetchImpl, cloud, publicId);
          if (!resource || resource.public_id !== publicId || !IMAGE_FORMATS.has(String(resource.format || '').toLowerCase()) || resource.bytes > MAX_FILE_SIZE) {
            // A direct upload may have passed Cloudinary but failed our app limits.
            // Remove it so invalid content is never retained as an orphaned asset.
            if (resource && resource.public_id === publicId) await destroyCloudinaryImage(fetchImpl, cloud, publicId);
            return res.status(400).json({ error: 'Upload could not be verified' });
          }
          const record = { ...publicUrls(cloud.cloudName, publicId), publicId, linkedType: null, linkedItemId: null, confirmed: true };
          await store.set(imageKey(clientId, publicId), record);
          confirmed.push(record);
        }
        return res.status(201).json(confirmed);
      }

      if (req.method === 'PUT') {
        const images = req.body?.images;
        if (!Array.isArray(images) || images.length < 1 || images.length > MAX_FILES || !images.every(image => ownsPublicId(clientId, image?.publicId) && validAssociation(image))) {
          return res.status(400).json({ error: 'Invalid image associations' });
        }
        const saved = [];
        for (const image of images) {
          const record = await store.get(imageKey(clientId, image.publicId));
          if (!record || record.confirmed !== true) return res.status(404).json({ error: 'Confirmed image not found' });
          record.linkedType = image.linkedType;
          record.linkedItemId = image.linkedItemId ?? null;
          await store.set(imageKey(clientId, image.publicId), record);
          saved.push(record);
        }
        return res.status(200).json(saved);
      }

      if (req.method === 'DELETE') {
        const publicId = req.query?.publicId || req.body?.publicId;
        if (!ownsPublicId(clientId, publicId)) return res.status(400).json({ error: 'Invalid publicId' });
        const key = imageKey(clientId, publicId);
        if (!await store.get(key)) return res.status(404).json({ error: 'Image not found' });
        if (!await destroyCloudinaryImage(fetchImpl, cloud, publicId)) return res.status(502).json({ error: 'Image deletion failed' });
        await store.del(key);
        return res.status(200).json({ deleted: true });
      }

      return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
      console.error('[api/client-images]', err.message);
      captureApiException(err, { clientId, feature: 'client_panel', route: '/api/client-images' });
      return res.status(500).json({ error: 'Image service error' });
    }
  };
}

const HEALTH_TIMEOUT_MS = 1500;

// Reuses this serverless function because the project is at Vercel's function
// limit. Prefer Vercel's deployment ID so Preview builds made from local
// changes are never mislabeled with an older Git commit.
export function createBuildHandler(env = process.env) {
  return function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).json({ error: 'Method not allowed' });

    var version = String(env.VERCEL_DEPLOYMENT_ID || env.VERCEL_GIT_COMMIT_SHA || env.GIT_COMMIT_SHA || '').trim();
    if (!/^(?:dpl_[a-z0-9]+|[a-f0-9]{7,64})$/i.test(version)) version = 'local';
    if (req.method === 'HEAD') return res.status(200).end();
    return res.status(200).json({ version });
  };
}

function createHealthHandler({ redis } = {}) {
  const store = redis || new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).json({ error: 'Method not allowed' });

    let redisUp = false;
    try {
      await Promise.race([
        store.ping(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Redis ping timeout')), HEALTH_TIMEOUT_MS)),
      ]);
      redisUp = true;
    } catch (err) {
      captureApiException(err, { feature: 'redis', route: '/api/health' });
    }

    const timestamp = new Date().toISOString();
    if (req.method === 'HEAD') return res.status(200).end();
    if (redisUp) {
      return res.status(200).json({ status: 'ok', timestamp });
    } else {
      return res.status(200).json({ status: 'degraded', timestamp });
    }
  };
}

let productionHandler;
let imagesHandler;
let healthHandler;
let buildHandler;
let clientStatusHandler;
let portalHandler;
let reservationsHandler;

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

function authorized(token, client) {
  if (!token) return false;
  if (client.panelToken && token === client.panelToken) return true;
  if (process.env.ADMIN_TOKEN && token === process.env.ADMIN_TOKEN) return true;
  const testBypassSecret = process.env.TEST_BYPASS_SECRET || '';
  if (testBypassSecret !== '' && token === testBypassSecret) return true;
  if (client.passwordHash && verifyPassword(token, client.passwordHash)) return true;
  return false;
}

export function createReservationsListApiHandler({ redis: store } = {}) {
  const dataStore = store || redis;
  return async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin',  '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(204).end();

    const clientId = req.query?.clientId;
    const token    = req.query?.token || req.body?.token;

    if (!clientId || !/^[a-z0-9-]+$/.test(clientId))
      return res.status(400).json({ error: 'Invalid clientId' });

    try {
      const client = await dataStore.get(`client:${clientId}`);
      if (!client) return res.status(404).json({ error: 'Client not found' });
      if (!authorized(token, client)) return res.status(401).json({ error: 'Unauthorized' });

      if ((req.method === 'POST' || req.method === 'PUT') && (req.query?.scope === 'set_password' || req.body?.action === 'set_password')) {
        const { newPassword } = req.body || {};
        if (!newPassword || typeof newPassword !== 'string' || newPassword.trim().length < 6) {
          return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
        }
        client.passwordHash = hashPassword(newPassword.trim());
        await dataStore.set(`client:${clientId}`, client);
        return res.status(200).json({ ok: true, hasPassword: true, message: 'Contraseña guardada correctamente' });
      }

      if (req.method === 'GET' && req.query?.scope === 'activity') {
        const raw = await dataStore.lrange(`activity:${clientId}`, 0, -1);
        const activities = (raw || []).map((value) => {
          try { return typeof value === 'string' ? JSON.parse(value) : value; } catch (_) { return null; }
        }).filter(Boolean).reverse();
        return res.status(200).json({ activities });
      }

      if (req.method === 'GET') {
        const keys = await dataStore.keys(`reservations:${clientId}:*`);
        const items = keys.length ? (keys.length === 1 ? [await dataStore.get(keys[0])] : await dataStore.mget(...keys)) : [];

        const reservations = items
          .filter(Boolean)
          .map((r, i) => ({ ...r, _key: keys[i] }))
          .sort((a, b) => (b.fechaSolicitud || '').localeCompare(a.fechaSolicitud || ''));

        const trialEnd = client.trial_end
          ? new Date(Number(client.trial_end) * 1000).toISOString()
          : null;

        return res.status(200).json({
          reservations,
          hasPassword:         !!client.passwordHash,
          plan:                client.plan               || null,
          active:              client.active             || false,
          paymentStatus:       client.paymentStatus      || 'none',
          trial_end:           trialEnd,
          paidUntil:           client.paidUntil          || null,
          gracePeriodEndsAt:   client.gracePeriodEndsAt  || null,
          stripeCustomerId:    client.stripeCustomerId   || null,
          stripeSubscriptionId: client.stripeSubscriptionId || null,
          cancelAtPeriodEnd:   client.cancelAtPeriodEnd  || false,
          cancelledAt:         client.cancelledAt        || null,
        });
      }

      if (req.method === 'PUT') {
        const { key, estado } = req.body || {};
        const VALID_ESTADOS = ['pendiente', 'confirmada', 'rechazada', 'cancelada'];
        if (!key || !VALID_ESTADOS.includes(estado))
          return res.status(400).json({ error: 'key and valid estado are required' });
        if (!key.startsWith(`reservations:${clientId}:`))
          return res.status(403).json({ error: 'Key does not belong to this client' });

        const reservation = await dataStore.get(key);
        if (!reservation) return res.status(404).json({ error: 'Reservation not found' });

        reservation.estado = estado;
        if (estado === 'cancelada')   reservation.fechaCancelacion  = new Date().toISOString();
        if (estado === 'confirmada')  reservation.fechaConfirmacion = new Date().toISOString();
        if (estado === 'rechazada')   reservation.fechaRechazo      = new Date().toISOString();

        await dataStore.set(key, reservation);
        return res.status(200).json({ ok: true, reservation });
      }

      return res.status(405).json({ error: 'Method not allowed' });

    } catch (err) {
      console.error('[api/client-config/__scope=reservations]', err.message);
      captureApiException(err, { clientId, feature: 'client_panel', route: '/api/client-config?__scope=reservations' });
      return res.status(500).json({ error: 'Database error' });
    }
  };
}

function createClientStatusHandler({ redis: store, stripe: stripeInstance } = {}) {
  const dataStore = store || redis;
  const stripe = stripeInstance || new Stripe(process.env.STRIPE_SECRET_KEY);
  return async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin',  '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const clientId = req.query?.clientId;
    const token    = req.query?.token;

    if (!clientId || !/^[a-z0-9-]+$/.test(clientId))
      return res.status(400).json({ error: 'Invalid clientId' });

    try {
      const client = await dataStore.get(`client:${clientId}`);
      if (!client) return res.status(404).json({ error: 'Client not found' });

      if (!token) return res.status(401).json({ error: 'Unauthorized' });
      if (!authorized(token, client)) return res.status(401).json({ error: 'Unauthorized' });

      const trialEnd = client.trial_end
        ? new Date(Number(client.trial_end) * 1000).toISOString()
        : null;

      let subscriptionStatus = null;
      if (client.stripeSubscriptionId) {
        try {
          const sub = await stripe.subscriptions.retrieve(client.stripeSubscriptionId);
          subscriptionStatus = sub.status;
        } catch (_) {
          subscriptionStatus = null;
        }
      }

      const hasRealSubscription = Boolean(
        client.stripeSubscriptionId &&
        subscriptionStatus &&
        (subscriptionStatus === 'active' || subscriptionStatus === 'trialing')
      );

      let checkoutUrl = null;
      if (!hasRealSubscription && client.stripeCustomerId) {
        if (client.stripeCheckoutSessionId) {
          try {
            const existing = await stripe.checkout.sessions.retrieve(client.stripeCheckoutSessionId);
            if (existing.status === 'open') {
              checkoutUrl = existing.url;
            }
          } catch (err) {
            console.error('[client-status] retrieve session error:', err.message);
            checkoutUrl = null;
          }
        }
        if (!checkoutUrl) {
          try {
            const PRICE_IDS = {
              basic: process.env.STRIPE_PRICE_BASIC,
              pro:   process.env.STRIPE_PRICE_PRO,
            };
            const priceId = PRICE_IDS[client.plan];
            if (!priceId) {
              console.error('[client-status] no priceId — plan:', client.plan, '| STRIPE_PRICE_PRO:', process.env.STRIPE_PRICE_PRO, '| STRIPE_PRICE_BASIC:', process.env.STRIPE_PRICE_BASIC);
            }
            if (priceId) {
              const session = await stripe.checkout.sessions.create({
                mode:                 'subscription',
                payment_method_types: ['card'],
                payment_method_collection: 'always',
                line_items:           [{ price: priceId, quantity: 1 }],
                client_reference_id:  clientId,
                customer:             client.stripeCustomerId,
                customer_email:       client.ownerEmail || undefined,
                metadata:             { clientId },
                subscription_data:    { metadata: { clientId }, trial_period_days: 10 },
                success_url: `https://jbstudio.app/success?client=${encodeURIComponent(clientId)}`,
                cancel_url:  `https://jbstudio.app/reservas/${encodeURIComponent(clientId)}`,
              });
              checkoutUrl = session.url;
              await dataStore.set(`client:${clientId}`, Object.assign({}, client, {
                stripeCheckoutSessionId: session.id,
              }));
            }
          } catch (err) {
            console.error('[client-status] create session error:', err.message);
            checkoutUrl = null;
          }
        }
      }

      return res.status(200).json({
        hasPassword:        !!client.passwordHash,
        plan:               client.plan               || null,
        active:             client.active             || false,
        paymentStatus:      client.paymentStatus      || 'none',
        trial_end:          trialEnd,
        paidUntil:          client.paidUntil          || null,
        gracePeriodEndsAt:  client.gracePeriodEndsAt  || null,
        stripeCustomerId:   client.stripeCustomerId   || null,
        stripeSubscriptionId: client.stripeSubscriptionId || null,
        subscriptionStatus,
        cancelAtPeriodEnd:  client.cancelAtPeriodEnd  || false,
        cancelledAt:        client.cancelledAt        || null,
        checkoutUrl,
      });
    } catch (err) {
      console.error('[api/client-config/__scope=status]', err.message);
      captureApiException(err, { clientId, feature: 'client_panel', route: '/api/client-config' });
      return res.status(500).json({ error: 'Database error' });
    }
  };
}

function createPortalHandler({ redis: store } = {}) {
  const dataStore = store || redis;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  return async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin',  'https://jbstudio.app');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const token     = req.headers['x-admin-token'];
    const { clientId } = req.body || {};

    if (!clientId || !/^[a-z0-9-]+$/.test(clientId))
      return res.status(400).json({ error: 'Invalid clientId' });

    try {
      const client = await dataStore.get(`client:${clientId}`);
      if (!client) return res.status(404).json({ error: 'Client not found' });

      if (!authorized(token, client))
        return res.status(401).json({ error: 'Unauthorized' });

      if (!client.stripeCustomerId)
        return res.status(400).json({ error: 'No Stripe customer found for this client' });

      const session = await stripe.billingPortal.sessions.create({
        customer:  client.stripeCustomerId,
        return_url: `https://jbstudio.app/reservas/${encodeURIComponent(clientId)}`,
      });

      return res.status(200).json({ url: session.url });
    } catch (err) {
      console.error('[api/client-config/__scope=portal]', err.message);
      captureApiException(err, { clientId, feature: 'billing', route: '/api/client-config' });
      return res.status(500).json({ error: err.message });
    }
  };
}

export default async function handler(req, res) {
  const urlObj = new URL(req.url || '', 'https://jbstudio.app');
  const scope = req.query?.__scope || urlObj.searchParams.get('__scope');
  if (scope === 'images') {
    if (!imagesHandler) imagesHandler = createClientImagesHandler();
    return imagesHandler(req, res);
  }
  if (scope === 'health') {
    if (!healthHandler) healthHandler = createHealthHandler();
    return healthHandler(req, res);
  }
  if (scope === 'build') {
    if (!buildHandler) buildHandler = createBuildHandler();
    return buildHandler(req, res);
  }
  if (scope === 'status') {
    if (!clientStatusHandler) clientStatusHandler = createClientStatusHandler();
    return clientStatusHandler(req, res);
  }
  if (scope === 'portal') {
    if (!portalHandler) portalHandler = createPortalHandler();
    return portalHandler(req, res);
  }
  if (scope === 'reservations') {
    if (!reservationsHandler) reservationsHandler = createReservationsListApiHandler();
    return reservationsHandler(req, res);
  }
  if (!productionHandler) productionHandler = createClientConfigHandler();
  return productionHandler(req, res);
}
