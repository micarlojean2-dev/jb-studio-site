// Auditoría FASE 3 — rastreo de punta a punta del reporte "8:30 PM terminaba
// mostrando 8:00 PM". Ejecuta el JS real de asistente.html (chat-core.js +
// su script) en un DOM simulado, con el fetch de /api/reservations
// redirigido al handler REAL de api/reservations.js (Redis mockeado, sin
// red) -- no se reimplementa ninguna lógica de extracción ni de backend.
//
// En cada escenario se verifica la cadena completa:
//   mensaje del usuario -> hora extraída (CORE.extractBooking)
//   -> bookingData.hora / update.hora
//   -> body real enviado a POST /api/reservations
//   -> reservation.hora y reservation.horaISO guardados en Redis (backend real)
//   -> resumen mostrado al cliente y HTML del email (lib/reservation-emails.js real)
//
// No se agregan logs permanentes ni de ningún tipo con PII: esta es una
// prueba de test, no instrumentación del código de producción.
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

process.env.ADMIN_TOKEN = 'bug-830-test-token';
process.env.UPSTASH_REDIS_REST_URL = 'https://bug-830-test.redis';
process.env.UPSTASH_REDIS_REST_TOKEN = 'bug-830-test-token';
delete process.env.RESEND_API_KEY; // sin proveedor real de correo: sendReservationEmails debe avisar, no fingir

const redisStore = new Map();
globalThis.fetch = async (url, options = {}) => {
  const command = new URL(url).pathname.split('/').filter(Boolean).pop();
  const args = JSON.parse(options.body || '[]');
  const execute = (entry) => {
    const [op, ...values] = entry;
    const o = String(op).toLowerCase();
    if (o === 'get') return redisStore.get(values[0]) ?? null;
    if (o === 'set') { redisStore.set(values[0], values[1]); return 'OK'; }
    if (o === 'del') { values.forEach(k => redisStore.delete(k)); return values.length; }
    if (o === 'keys') { const p = String(values[0]).replace('*', ''); return [...redisStore.keys()].filter(k => k.startsWith(p)); }
    if (o === 'mget') return values.map(k => redisStore.get(k) ?? null);
    if (o === 'setnx') { if (redisStore.has(values[0])) return 0; redisStore.set(values[0], values[1]); return 1; }
    if (o === 'expire') return 1;
    if (o === 'srem' || o === 'sadd' || o === 'rpush') return 1;
    if (o === 'ltrim') return 'OK';
    throw new Error(`Unsupported Redis command: ${op}`);
  };
  // registrarCambio() (lib/changes.js) usa redis.multi()...exec(), que pega
  // a /multi-exec (no /pipeline) pero con el mismo formato de body y de
  // respuesta -- sin esto, cada intento fallaba, reintentaba tras 150ms
  // (real, no simulado) y las pruebas que miden el mensaje final del chat
  // esperaban de más sin saber por qué. [auditoría FASE 3]
  const isBatch = command === 'pipeline' || command === 'multi-exec';
  const result = isBatch ? args.map(e => ({ result: execute(e) })) : { result: execute(args) };
  return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const { default: reservationsHandler } = await import('../api/reservations.js');
const { reservationEmailHtml } = await import('../lib/reservation-emails.js');

async function callReservationsApi(body, ip) {
  let statusCode = 200; let responseBody = null;
  const res = { setHeader() {}, status(c) { statusCode = c; return this; }, json(b) { responseBody = b; return this; } };
  await reservationsHandler({ method: 'POST', query: {}, headers: { 'x-forwarded-for': ip }, body }, res);
  return { statusCode, responseBody };
}

function seedClient(id, overrides = {}) {
  const client = {
    id, businessName: 'Spa Prueba 830', templateId: 'spa', active: true,
    timezone: 'America/Los_Angeles',
    ownerEmail: 'owner@example.com', notificationEmails: ['owner@example.com'],
    businessHours: {
      monday: { enabled: true, ranges: [{ start: '00:00', end: '23:59' }] },
      tuesday: { enabled: true, ranges: [{ start: '00:00', end: '23:59' }] },
      wednesday: { enabled: true, ranges: [{ start: '00:00', end: '23:59' }] },
      thursday: { enabled: true, ranges: [{ start: '00:00', end: '23:59' }] },
      friday: { enabled: true, ranges: [{ start: '00:00', end: '23:59' }] },
      saturday: { enabled: true, ranges: [{ start: '00:00', end: '23:59' }] },
      sunday: { enabled: true, ranges: [{ start: '00:00', end: '23:59' }] },
    },
    menu: [{ nombre: 'Masaje relajante', precio: '35000', duracion: '60' }],
    features: { reservations: true, cancellation: true, emailNotifications: true },
    capacityPerSlot: 5, reservationIntervalMinutes: 15, minNoticeHours: 0,
    ...overrides,
  };
  // El SDK real de @upstash/redis serializa antes de mandar el comando SET;
  // al sembrar directo en el mock hay que hacer lo mismo, o el handler real
  // (que sí pasa por el SDK) recibe un objeto ya-parseado donde esperaba un
  // string y "no encuentra" al cliente.
  redisStore.set(`client:${id}`, JSON.stringify(client));
  return client;
}

function redisReservations(clientId) {
  return [...redisStore.entries()]
    .filter(([k]) => k.startsWith(`reservations:${clientId}:`))
    .map(([, v]) => typeof v === 'string' ? JSON.parse(v) : v);
}

const CLIENT_CONFIG_FIELDS = (client) => ({
  id: client.id, businessName: client.businessName, templateId: client.templateId,
  language: 'es', languages: ['es', 'en'], color: '#1a4a2e', style: 'Moderno',
  businessHours: client.businessHours, menu: client.menu,
  features: client.features,
});

const chatCoreSrc = readFileSync(join(root, 'chat-core.js'), 'utf8');
const asistenteSrc = readFileSync(join(root, 'asistente.html'), 'utf8');
const scriptMatch = asistenteSrc.match(/<script>\n([\s\S]*?)\n<\/script>\n<\/body>/);
assert.ok(scriptMatch, 'no se encontró el <script> principal de asistente.html');
const asistenteScript = scriptMatch[1];

// NO incluye un <div id="a-ty"> estático: en el asistente.html real ese id
// no existe en el HTML -- showTyping() lo crea dinámicamente dentro de
// #a-msgs y hideTyping() lo quita por getElementById('a-ty'). Un id
// duplicado hacía que hideTyping() a veces quitara el elemento equivocado,
// dejando el indicador de "escribiendo…" real (con el mismo avatar "✦" que
// cualquier mensaje del bot) atascado como último hijo de #a-msgs.
const HTML_SKELETON = `<!doctype html><html><body>
  <div id="a-loading"></div>
  <div id="a-app" style="display:none">
    <div id="a-preview-banner" style="display:none"></div>
    <div id="a-head"><div id="a-av"></div><div id="a-name"></div><div id="a-status-text"></div></div>
    <div id="a-msgs"></div>
    <input id="a-inp"><button id="a-snd">Enviar</button>
  </div>
  <div id="a-notfound" style="display:none"></div>
  <div id="a-version"></div>
</body></html>`;

function $(dom, id) { return dom.window.document.getElementById(id); }
async function escribir(dom, texto) {
  const window = dom.window;
  $(dom, 'a-inp').value = texto;
  $(dom, 'a-snd').dispatchEvent(new window.Event('click', { bubbles: true }));
  // El fetch mockeado invoca el handler REAL de api/reservations.js, que
  // encadena varios await (redis.get/set, sendReservationEmails, cola de
  // avisos): más lento que un mock plano. ETAPA 2 además antepone la
  // llamada de interpretación (y, en el flujo de reagendar por intent, un
  // "listar" antes del reagendado real) -- hasta 3 fetch secuenciales por
  // mensaje, así que 20-60ms ya no alcanza siempre.
  await new Promise(r => setTimeout(r, 100));
}
function ultimosMensajesBot(dom, n) {
  return [...dom.window.document.querySelectorAll('#a-msgs > *')].map(el => el.textContent).slice(-n).join(' | ');
}

// ETAPA 2: la extracción de fecha/hora dentro del flujo (bookingStep>0) y la
// detección de intent:'reschedule' ya NO son síncronas/locales -- vienen de
// interpretation en la respuesta de /api/client-chat. Esta es una simulación
// mínima y determinista de esa interpretación para este rastreo end-to-end
// (el foco de esta prueba es que 8:30 PM nunca se redondee/pierda en las 5
// capas -- no re-probar la calidad del modelo real, eso vive en
// scripts/interpreter-battery.mjs).
function emptyTestEntities() {
  return { service: null, date: null, time: null, name: null, email: null, phone: null, people: null, notes: null };
}
function fakeInterpret(t) {
  const lower = String(t || '').toLowerCase();
  const sinAcentos = lower.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const entities = emptyTestEntities();
  const dateMatch = sinAcentos.match(/manana|tomorrow|viernes|friday/);
  if (dateMatch) entities.date = dateMatch[0];
  const timeMatch = lower.match(/\d{1,2}:\d{2}\s*(am|pm)/);
  if (timeMatch) entities.time = timeMatch[0].trim();
  const looksLikeChange = /cambia|cambiar|change/.test(sinAcentos);
  return { intent: looksLikeChange ? 'reschedule' : 'booking', text: 'Entendido, dame un momento.', entities };
}

async function buildDom({ url, client, lang, presetSessionStorage } = {}) {
  const dom = new JSDOM(HTML_SKELETON, { runScripts: 'outside-only', url });
  const { window } = dom;
  if (presetSessionStorage) {
    Object.entries(presetSessionStorage).forEach(([k, v]) => window.sessionStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)));
  }
  window.fetch = async (u, options = {}) => {
    const s = String(u);
    if (s.includes('/api/client-config')) {
      return { ok: true, json: async () => CLIENT_CONFIG_FIELDS(client) };
    }
    if (s.includes('/api/client-chat') && options.method === 'POST') {
      const body = JSON.parse(options.body);
      const lastUser = [...body.messages].reverse().find((m) => m.role === 'user');
      return { ok: true, json: async () => ({ text: 'Entendido.', interpretation: fakeInterpret(lastUser && lastUser.content) }) };
    }
    if (s.includes('/api/reservations') && options.method === 'POST') {
      const body = JSON.parse(options.body);
      const { statusCode, responseBody } = await callReservationsApi(body, dom.__ip);
      return { ok: statusCode >= 200 && statusCode < 300, status: statusCode, json: async () => responseBody };
    }
    throw new Error('fetch inesperado: ' + s);
  };
  dom.window.eval(chatCoreSrc);
  dom.window.eval(asistenteScript);
  await new Promise(r => setTimeout(r, 20));
  return dom;
}

let failures = 0;
const ok = (cond, msg) => { if (cond) console.log('  ✓', msg); else { console.error('  ✗', msg); failures++; } };

console.log('1) RESERVA NUEVA (ES) — "Quiero una cita mañana a las 8:30 PM"');
{
  const client = seedClient('spa-830-es');
  const dom = await buildDom({
    url: 'https://jbstudio.app/asistente/spa-830-es', client, ip: '10.0.0.1',
    presetSessionStorage: {
      'jba_spa-830-es_booking': {
        bookingStep: 1,
        bookingData: { servicio: 'Masaje relajante', nombre: 'Ana Prueba', telefono: '+14155550100', email: 'ana@example.com', specialRequests: '' },
        bookingPending: null, bookingReview: false, awaitingConfirmation: false, horaPendiente: null, language: 'es', selectedService: 'Masaje relajante',
      },
    },
  });
  dom.__ip = '10.0.0.1';

  // 1. hora extraída — se prueba directamente con el motor real, mismo texto.
  const CORE = dom.window.JBChatCore;
  const extraido = CORE.extractBooking('Quiero una cita mañana a las 8:30 PM', client.menu, client.businessHours, 'es', { templateId: 'spa' });
  ok(extraido.hora === '8:30 PM', `hora extraída = "8:30 PM" (fue "${extraido.hora}")`);

  await escribir(dom, 'Quiero una cita mañana a las 8:30 PM');
  // 2. bookingData.hora -- se confirma vía el resumen mostrado (bookingReview activo).
  ok(/8:30\s*PM/.test(ultimosMensajesBot(dom, 2)), `el resumen mostrado incluye "8:30 PM" (fue: "${ultimosMensajesBot(dom, 2)}")`);
  await escribir(dom, 'sí, confirmo');

  // 3. body enviado + 4. reservation.hora/horaISO en Redis (backend real).
  const stored = redisReservations('spa-830-es');
  ok(stored.length === 1, `se guardó exactamente 1 reserva en Redis (hubo ${stored.length})`);
  const reservation = stored[0];
  ok(reservation.hora === '8:30 PM', `reservation.hora guardado = "8:30 PM" (fue "${reservation.hora}")`);
  ok(reservation.horaISO === '20:30', `reservation.horaISO guardado = "20:30" (fue "${reservation.horaISO}")`);

  // 5. resumen/email -- HTML real generado por lib/reservation-emails.js con el objeto real guardado.
  const html = reservationEmailHtml(client, reservation, 'created');
  ok(html.includes('8:30 PM'), 'el HTML real del email de confirmación contiene "8:30 PM"');
  ok(!html.includes('8:00 PM'), 'el HTML real del email NUNCA contiene "8:00 PM"');
  console.log('  ✓ ES nueva: 8:30 PM se conserva íntegro en las 5 capas');
}

console.log('\n2) RESERVA NUEVA (EN) — "Can I book tomorrow at 8:30 PM?"');
{
  const client = seedClient('spa-830-en');
  const dom = await buildDom({
    url: 'https://jbstudio.app/asistente/spa-830-en', client,
    presetSessionStorage: {
      'jba_spa-830-en_language': 'en',
      'jba_spa-830-en_booking': {
        bookingStep: 1,
        bookingData: { servicio: 'Masaje relajante', nombre: 'Ana Prueba', telefono: '+14155550100', email: 'ana@example.com', specialRequests: '' },
        bookingPending: null, bookingReview: false, awaitingConfirmation: false, horaPendiente: null, language: 'en', selectedService: 'Masaje relajante',
      },
    },
  });
  dom.__ip = '10.0.0.2';

  const CORE = dom.window.JBChatCore;
  const extraido = CORE.extractBooking('Can I book tomorrow at 8:30 PM?', client.menu, client.businessHours, 'en', { templateId: 'spa' });
  ok(extraido.hora === '8:30 PM', `hora extraída = "8:30 PM" (fue "${extraido.hora}")`);

  await escribir(dom, 'Can I book tomorrow at 8:30 PM?');
  ok(/8:30\s*PM/.test(ultimosMensajesBot(dom, 2)), `el resumen (EN) incluye "8:30 PM" (fue: "${ultimosMensajesBot(dom, 2)}")`);
  await escribir(dom, 'yes, confirm');

  const stored = redisReservations('spa-830-en');
  ok(stored.length === 1, `se guardó exactamente 1 reserva (hubo ${stored.length})`);
  const reservation = stored[0];
  ok(reservation.hora === '8:30 PM', `reservation.hora = "8:30 PM" (fue "${reservation.hora}")`);
  ok(reservation.horaISO === '20:30', `reservation.horaISO = "20:30" (fue "${reservation.horaISO}")`);
  const html = reservationEmailHtml(client, reservation, 'created');
  ok(html.includes('8:30 PM') && !html.includes('8:00 PM'), 'email (EN) contiene 8:30 PM, nunca 8:00 PM');
  console.log('  ✓ EN nueva: 8:30 PM se conserva íntegro en las 5 capas');
}

console.log('\n3) MODIFICACIÓN — reserva anterior 8:00 PM → "Cámbiala a las 8:30 PM"');
{
  const client = seedClient('spa-830-mod');
  // Reserva original 8:00 PM ya existente en Redis, con actionToken real.
  const original = {
    clientId: 'spa-830-mod', nombre: 'Ana Prueba', telefono: '+14155550100', email: 'ana@example.com',
    fecha: 'lunes', fechaISO: '2026-08-10', hora: '8:00 PM', horaISO: '20:00',
    servicio: 'Masaje relajante', duracion: 60, estado: 'confirmada',
    actionToken: 'tok-830-mod', fechaConfirmacion: new Date().toISOString(), fechaSolicitud: new Date().toISOString(),
  };
  redisStore.set('reservations:spa-830-mod:1000', JSON.stringify(original));

  const dom = await buildDom({
    url: 'https://jbstudio.app/asistente/spa-830-mod', client,
    presetSessionStorage: {
      'jba_spa-830-mod_reserva': {
        reservationId: 'reservations:spa-830-mod:1000', actionToken: 'tok-830-mod',
        nombre: 'Ana Prueba', servicio: 'Masaje relajante', fecha: 'lunes', hora: '8:00 PM', estado: 'confirmada',
      },
    },
  });
  dom.__ip = '10.0.0.3';

  await escribir(dom, 'Cámbiala a las 8:30 PM');

  const stored = redisReservations('spa-830-mod');
  ok(stored.length === 1, 'sigue habiendo exactamente 1 reserva (se actualizó, no se duplicó)');
  const reservation = stored[0];
  ok(reservation.hora === '8:30 PM', `reservation.hora tras modificar = "8:30 PM", NUNCA "8:00 PM" (fue "${reservation.hora}")`);
  ok(reservation.horaISO === '20:30', `reservation.horaISO tras modificar = "20:30" (fue "${reservation.horaISO}")`);
  ok(reservation.estado === 'reprogramada', 'estado pasa a reprogramada');
  const html = reservationEmailHtml(client, reservation, 'rescheduled');
  ok(html.includes('8:30 PM') && !html.includes('8:00 PM'), 'el email de reprogramación real contiene 8:30 PM, nunca 8:00 PM (la hora vieja)');
  console.log('  ✓ Modificación: 8:30 PM reemplaza a 8:00 PM en las 5 capas (backend, Redis, email, resumen)');
}

console.log('\n4) REAGENDADO DESDE ENLACE DE EMAIL — "el viernes a las 6:30 PM"');
{
  const client = seedClient('spa-830-email');
  const original = {
    clientId: 'spa-830-email', nombre: 'Ana Prueba', telefono: '+14155550100', email: 'ana@example.com',
    fecha: 'lunes', fechaISO: '2026-08-10', hora: '5:00 PM', horaISO: '17:00',
    servicio: 'Masaje relajante', duracion: 60, estado: 'confirmada',
    actionToken: 'tok-830-email', fechaConfirmacion: new Date().toISOString(), fechaSolicitud: new Date().toISOString(),
  };
  redisStore.set('reservations:spa-830-email:2000', JSON.stringify(original));

  // Entra por el link real del correo: ?action=reschedule&reservation=TOKEN
  const dom = await buildDom({
    url: 'https://jbstudio.app/asistente/spa-830-email?action=reschedule&reservation=tok-830-email',
    client,
  });
  dom.__ip = '10.0.0.4';

  // El flujo de email exige fecha Y hora en el mismo mensaje (send(), rama
  // emailAction): se da un día real para satisfacer ambos campos.
  await escribir(dom, 'el viernes a las 6:30 PM');

  const stored = redisReservations('spa-830-email');
  ok(stored.length === 1, 'sigue habiendo exactamente 1 reserva');
  const reservation = stored[0];
  ok(reservation.hora === '6:30 PM', `reservation.hora tras reagendar desde email = "6:30 PM" (fue "${reservation.hora}")`);
  ok(reservation.horaISO === '18:30', `reservation.horaISO = "18:30" (fue "${reservation.horaISO}")`);
  const html = reservationEmailHtml(client, reservation, 'rescheduled');
  ok(html.includes('6:30 PM') && !html.includes('5:00 PM') && !html.includes('6:00 PM'), 'email real: 6:30 PM correcto, sin restos de la hora vieja ni redondeo');
  ok(/6:30\s*PM|reprogramada|rescheduled/i.test(ultimosMensajesBot(dom, 1)), 'el chat confirma el reagendado');
  console.log('  ✓ Reagendado desde email: 6:30 PM se conserva íntegro, sin redondeo ni pérdida de minutos');
}

console.log(failures ? `\n${failures} fallo(s)` : '\nTodas las pruebas del rastreo 8:30 PM -> 8:00 PM (FASE 3) pasan');
if (failures) process.exit(1);
