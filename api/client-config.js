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

// Qué le falta a un negocio para poder tomar reservas con criterio.
// Se calcula, no se guarda: un flag almacenado se queda obsoleto en cuanto
// alguien edita el cliente, y entonces miente. Esto siempre dice la verdad.
function faltaConfig(client) {
  const f = [];
  if (!client || typeof client !== 'object') return ['datos del negocio'];

  if (!client.timezone) f.push('zona horaria');

  const bh = client.businessHours;
  let diasAbiertos = 0;
  if (bh && typeof bh === 'object') {
    Object.keys(bh).forEach(d => {
      const dia = bh[d];
      if (dia && dia.enabled !== false && !dia.unknown && Array.isArray(dia.ranges) && dia.ranges.length) diasAbiertos++;
    });
  }
  if (!bh) f.push('horario del negocio');
  else if (!diasAbiertos) f.push('días abiertos con horario');

  if (!Number.isFinite(client.minNoticeHours)) f.push('anticipación mínima');

  const menu = Array.isArray(client.menu) ? client.menu : [];
  if (!menu.length) f.push('servicios');
  else if (menu.some(m => !m.duracion)) f.push('duración de los servicios');

  return f;
}

// Solo importa si el negocio realmente toma reservas. Un Básico no las tiene,
// así que no tiene sentido bloquearlo por no configurarlas.
//
// El criterio debe ser el MISMO que featureOn() en el chat (!features ||
// features[k] !== false). Con el criterio estricto (=== true) los clientes
// legacy, que no tienen features, quedaban fuera del bloqueo mientras el
// chat sí les ofrecía reservar: justo el agujero que esto viene a cerrar.
function necesitaSetup(client) {
  if (!client) return false;
  const reservas = !client.features || client.features.reservations !== false;
  if (!reservas) return false;
  return faltaConfig(client).length > 0;
}

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
      // Legacy clients have neither field stored: they keep the original
      // fullscreen / bottom-right behavior.
      displayMode:    client.displayMode    === 'widget'      ? 'widget'      : 'fullscreen',
      widgetPosition: client.widgetPosition === 'bottom-left' ? 'bottom-left' : 'bottom-right',
      // El horario de apertura es información pública (está en la web del
      // negocio). El chat lo usa para resolver "a las 4" sin preguntar.
      businessHours:  client.businessHours && typeof client.businessHours === 'object' ? client.businessHours : null,
      timezone:       client.timezone || 'UTC',
      // El chat lo usa para no ofrecer reservas que el servidor rechazaría.
      needsSetup:     necesitaSetup(client),
      minNoticeHours: Number.isFinite(client.minNoticeHours) ? client.minNoticeHours : 0,
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
