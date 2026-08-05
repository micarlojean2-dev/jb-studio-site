// Test obligatorio (auditoría — contradicción "duración Restaurante"):
//  1. Crear Restaurante desde admin.html.
//  2. Crear Restaurante mediante POST directo.
//  3. Restaurante con duración definida.
//  4. Restaurante sin duración -> rechazado (reservationDuration).
//  5. Spa sin duración -> rechazado.
//  6. Barbería sin duración -> rechazado.
//  7. Restaurante válido no queda con needsSetup:true.
//  8. Restaurante inválido recibe un error estructurado con fields.
//  9. Reserva de Restaurante dentro del horario -> aceptada.
// 10. Dos reservas solapadas con capacidad 1 -> segunda rechazada.
// 11. Capacidad mayor que 1 -> acepta hasta el límite exacto.
// 12. La duración usada para disponibilidad coincide con la persistida.
// 13. Reagendar vuelve a usar la misma duración.
// 14. Servicios antiguos de Restaurante sin duración no provocan crash.
// 15. No se modifica el comportamiento de Spa ni Barbería.
// 16. Español e inglés siguen funcionando.
// 17. Catálogo, resumen y email no muestran "undefined"/"NaN"/valores inventados.
// 18. client.services y client.menu permanecen sincronizados.
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

process.env.ADMIN_TOKEN = 'restaurante-duracion-token';
process.env.UPSTASH_REDIS_REST_URL = 'https://restaurante-duracion.redis';
process.env.UPSTASH_REDIS_REST_TOKEN = 'restaurante-duracion-token';
delete process.env.RESEND_API_KEY;

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
  const isBatch = command === 'pipeline' || command === 'multi-exec';
  const result = isBatch ? args.map(e => ({ result: execute(e) })) : { result: execute(args) };
  return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const { default: clientHandler } = await import('../api/clients.js');
const { default: reservationsHandler } = await import('../api/reservations.js');
const { __test: chatTest } = await import('../api/client-chat.js');
const { businessInfoBlock, buildSystemPrompt } = chatTest;
const { reservationEmailHtml } = await import('../lib/reservation-emails.js');
const { necesitaSetup, faltaConfig } = await import('../lib/setup.js');

function readClient(id) {
  const raw = redisStore.get(`client:${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}
// POST /api/reservations (creación) NO devuelve el objeto reservation
// completo -- solo reservationId/actionToken/status (ver api/reservations.js,
// respuesta 201). Para inspeccionar duracion/language/etc. se lee el registro
// real ya guardado en Redis, con la misma clave que el handler reporta.
function readReservation(reservationId) {
  const raw = redisStore.get(reservationId);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

async function postClient(body) {
  let statusCode = 200; let responseBody = null;
  const res = { setHeader() {}, status(c) { statusCode = c; return this; }, json(b) { responseBody = b; return this; } };
  await clientHandler({ method: 'POST', query: {}, headers: { 'x-admin-token': process.env.ADMIN_TOKEN }, body }, res);
  return { statusCode, responseBody };
}
async function postReservation(body, ip = '172.16.9.1') {
  let statusCode = 200; let responseBody = null;
  const res = { setHeader() {}, status(c) { statusCode = c; return this; }, json(b) { responseBody = b; return this; } };
  await reservationsHandler({ method: 'POST', query: {}, headers: { 'x-forwarded-for': ip }, body }, res);
  return { statusCode, responseBody };
}

const HOURS = { monday: { enabled: true, ranges: [{ start: '09:00', end: '22:00' }] } };
function basePayload(templateId, id, phoneNumber, extra = {}) {
  return {
    id, businessName: `Negocio ${id}`, templateId, templateVersion: '1.0',
    address: 'Calle Real 1', ownerEmail: 'owner@example.com', timezone: 'America/Santiago',
    notificationEmails: ['owner@example.com'],
    phoneCountry: 'CL', phoneCountryCode: '+56', phoneNumber,
    businessHours: HOURS,
    services: [{ nombre: 'Mesa', precio: '0', duracion: templateId === 'restaurant' ? '' : '30' }],
    capacityPerSlot: 2, bufferMinutes: 10,
    ...extra,
  };
}
async function activate(id) {
  const c = readClient(id);
  c.active = true;
  redisStore.set(`client:${id}`, JSON.stringify(c));
  return c;
}

console.log('Restaurante: contrato de duración de reserva\n');

// 1) Crear Restaurante desde admin.html (JS real del creador, en jsdom).
{
  const adminSrc = readFileSync(join(root, 'admin.html'), 'utf8');
  const modalHtml = adminSrc.match(/<div id="spa-creator-overlay"[\s\S]*?<\/div>\s*\n<script>/)[0].replace(/<script>$/, '');
  const script = adminSrc.match(/<script>\s*\(\(\) => \{[\s\S]*?\}\)\(\);\s*<\/script>/)[0].replace(/^<script>/, '').replace(/<\/script>$/, '');
  const TEMPLATES = [{ id: 'restaurant', name: 'Restaurante', version: '1.0', requiredFields: [], features: {} }];
  const dom = new JSDOM(`<!doctype html><html><body><button id="open-spa-creator-btn">+ Crear chatbot</button>${modalHtml}</body></html>`,
    { runScripts: 'outside-only', url: 'https://jbstudio.app/admin' });
  const { window } = dom;
  window.__jbAdmin = { getToken: () => process.env.ADMIN_TOKEN, refreshClients: () => {} };
  window.fetch = async (url, options = {}) => {
    if (String(url).includes('action=templates')) return { ok: true, json: async () => TEMPLATES };
    if (url === '/api/clients' && options.method === 'POST') {
      const body = JSON.parse(options.body);
      let statusCode = 200; let responseBody = null;
      const fakeRes = { setHeader() {}, status(c) { statusCode = c; return this; }, json(b) { responseBody = b; return this; } };
      await clientHandler({ method: 'POST', query: {}, headers: { 'x-admin-token': process.env.ADMIN_TOKEN }, body }, fakeRes);
      return { ok: statusCode >= 200 && statusCode < 300, status: statusCode, json: async () => responseBody };
    }
    throw new Error('fetch inesperado: ' + url);
  };
  dom.window.eval(script);
  await new Promise(r => setTimeout(r, 20));
  const $ = id => dom.window.document.getElementById(id);
  $('open-spa-creator-btn').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
  $('spa-type').value = 'restaurant'; $('spa-type').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  $('spa-name').value = 'Restaurante Admin Real';
  $('spa-address').value = 'Av. Real 1';
  $('spa-phone-country').value = 'CL|+56';
  $('spa-phone-number').value = '900000101';
  $('spa-email').value = 'owner@example.com';
  $('spa-timezone').value = 'America/Santiago';
  const mon = dom.window.document.querySelector('[data-day="monday"] .spa-day-open');
  mon.checked = true; mon.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  dom.window.document.querySelector('[data-day="monday"] .spa-start').value = '10:00';
  dom.window.document.querySelector('[data-day="monday"] .spa-end').value = '22:00';
  const row = dom.window.document.querySelector('.spa-service-row');
  row.querySelector('.spa-service-name').value = 'Menu degustacion';
  row.querySelector('.spa-service-price').value = '25000';
  // Duración por plato deliberadamente vacía: opcional para Restaurante.
  row.querySelector('.spa-service-duration').value = '';
  $('spa-capacity').value = '4';
  assert.equal($('spa-reservation-duration-group').hidden, false, 'prueba 1: el campo de duración de reserva es visible para Restaurante');
  $('spa-reservation-duration').value = '75';
  $('spa-creator-form').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  $('spa-creator-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 30));
  const successHtml = $('spa-success').innerHTML;
  assert.ok(successHtml.includes('Chatbot creado'), 'prueba 1: el admin confirma la creación real');
  const id = successHtml.match(/asistente\/([a-z0-9-]+)/)?.[1];
  const client = readClient(id);
  assert.equal(client.reservationDuration, '75', 'prueba 1: reservationDuration del creador llega intacto a Redis');
  console.log('✓ 1) crear Restaurante desde admin.html (JS real) persiste reservationDuration');
}

// 2) Crear Restaurante mediante POST directo.
{
  const created = await postClient(basePayload('restaurant', 'rest-post-directo', '900000102', { reservationDuration: '60' }));
  assert.equal(created.statusCode, 201, 'prueba 2: POST directo crea el restaurante');
  assert.equal(created.responseBody.reservationDuration, '60', 'prueba 2: reservationDuration guardado tal cual');
  console.log('✓ 2) crear Restaurante mediante POST directo');
}

// 3) Restaurante con duración definida -> se guarda y es la que usa disponibilidad.
{
  const created = await postClient(basePayload('restaurant', 'rest-con-duracion', '900000103', { reservationDuration: '90' }));
  assert.equal(created.statusCode, 201);
  assert.equal(created.responseBody.reservationDuration, '90', 'prueba 3: duración definida persistida exacta');
  console.log('✓ 3) Restaurante con duración definida se guarda exacta');
}

// 4) Restaurante sin duración -> rechazado.
{
  const created = await postClient(basePayload('restaurant', 'rest-sin-duracion', '900000104'));
  assert.equal(created.statusCode, 400, 'prueba 4: sin reservationDuration se rechaza');
  assert.deepEqual(created.responseBody.fields, ['reservationDuration'], 'prueba 4: fields:["reservationDuration"]');
  console.log('✓ 4) Restaurante sin duración de reserva: rechazado');
}

// 5) Spa sin duración -> rechazado (sin cambios de comportamiento).
{
  const created = await postClient(basePayload('spa', 'spa-sin-duracion', '900000105', {
    services: [{ nombre: 'Facial', precio: '100', duracion: '' }],
  }));
  assert.equal(created.statusCode, 400, 'prueba 5: Spa sin duración por servicio se rechaza');
  assert.ok(created.responseBody.fields.includes('services'), 'prueba 5: fields incluye services');
  console.log('✓ 5) Spa sin duración: rechazado (sin cambios)');
}

// 6) Barbería sin duración -> rechazado (sin cambios de comportamiento).
{
  const created = await postClient(basePayload('barber', 'barber-sin-duracion', '900000106', {
    services: [{ nombre: 'Corte', precio: '100', duracion: '' }],
  }));
  assert.equal(created.statusCode, 400, 'prueba 6: Barbería sin duración por servicio se rechaza');
  assert.ok(created.responseBody.fields.includes('services'), 'prueba 6: fields incluye services');
  console.log('✓ 6) Barbería sin duración: rechazado (sin cambios)');
}

// 7) Restaurante válido no queda con needsSetup:true.
{
  const created = await postClient(basePayload('restaurant', 'rest-needs-setup-ok', '900000107', { reservationDuration: '60' }));
  assert.equal(created.statusCode, 201);
  assert.equal(necesitaSetup(created.responseBody), false,
    `prueba 7: needsSetup es false para un Restaurante creado válidamente (falta: ${JSON.stringify(faltaConfig(created.responseBody))})`);
  console.log('✓ 7) Restaurante válido nunca queda con needsSetup:true');
}

// 8) Restaurante inválido recibe un error estructurado con fields.
{
  const created = await postClient(basePayload('restaurant', 'rest-invalido-fields', '900000108', { reservationDuration: 'pronto' }));
  assert.equal(created.statusCode, 400, 'prueba 8: reservationDuration ilegible se rechaza');
  assert.deepEqual(created.responseBody.fields, ['reservationDuration'], 'prueba 8: error estructurado con fields');
  console.log('✓ 8) Restaurante inválido: error estructurado con fields');
}

// 9-13) Reservas reales: dentro de horario, solapamiento, capacidad,
// duración consistente y reagendado.
{
  const created = await postClient(basePayload('restaurant', 'rest-reservas', '900000109', {
    reservationDuration: '60', capacityPerSlot: 1, reservationIntervalMinutes: 30,
  }));
  assert.equal(created.statusCode, 201);
  await activate('rest-reservas');

  // 9) dentro del horario -> aceptada.
  const primera = await postReservation({
    clientId: 'rest-reservas', nombre: 'Cliente Uno', telefono: '+56911111111', email: 'uno@example.com',
    fecha: '2026-08-10', hora: '19:00', partySize: '2', language: 'es',
  }, '172.16.9.10');
  assert.equal(primera.statusCode, 201, `prueba 9: reserva dentro de horario aceptada (fue ${primera.statusCode}: ${JSON.stringify(primera.responseBody)})`);
  assert.equal(primera.responseBody.ok, true, 'prueba 9: reserva confirmada');
  const primeraReserva = readReservation(primera.responseBody.reservationId);

  // 12) la duración usada para disponibilidad coincide con la persistida
  // (reservationDuration:'60' -> reservation.duracion === 60).
  assert.equal(primeraReserva.duracion, 60,
    'prueba 12: reservation.duracion coincide con reservationDuration persistido (60)');

  // 10) capacidad 1: una segunda reserva solapada (30 min después, dentro de
  // los 60 min ocupados) se rechaza.
  const segunda = await postReservation({
    clientId: 'rest-reservas', nombre: 'Cliente Dos', telefono: '+56922222222', email: 'dos@example.com',
    fecha: '2026-08-10', hora: '19:30', partySize: '2', language: 'es',
  }, '172.16.9.11');
  assert.equal(segunda.responseBody.ok, false, 'prueba 10: segunda reserva solapada rechazada con capacidad 1');
  assert.equal(segunda.responseBody.motivo, 'sin_disponibilidad', 'prueba 10: motivo sin_disponibilidad');

  // Una reserva NO solapada (a partir de las 20:00, cuando la primera ya
  // liberó su mesa a las 20:00 exacto) sí se acepta.
  const tercera = await postReservation({
    clientId: 'rest-reservas', nombre: 'Cliente Tres', telefono: '+56933333333', email: 'tres@example.com',
    fecha: '2026-08-10', hora: '20:00', partySize: '2', language: 'es',
  }, '172.16.9.12');
  assert.equal(tercera.responseBody.ok, true, 'la mesa liberada a las 20:00 permite una nueva reserva a esa hora');

  // 13) reagendar sin volver a mandar "servicio": debe conservar la misma
  // duración (60), no perderla ni recalcularla a 0.
  const actionToken = primeraReserva.actionToken;
  const reagendada = await postReservation({
    clientId: 'rest-reservas', action: 'reschedule', actionToken,
    fecha: '2026-08-11', hora: '19:00',
  }, '172.16.9.13');
  assert.equal(reagendada.responseBody.ok, true, `prueba 13: el reagendado se acepta (fue ${JSON.stringify(reagendada.responseBody)})`);
  assert.equal(reagendada.responseBody.reservation.duracion, 60, 'prueba 13: el reagendado conserva la misma duración (60), sin volver a pedir servicio');
  console.log('✓ 9-10, 12-13) reservas dentro de horario, solapamiento con capacidad 1, duración consistente y reagendado preservan la misma duración');
}

// 11) Capacidad mayor que 1 -> acepta hasta el límite exacto.
{
  const created = await postClient(basePayload('restaurant', 'rest-capacidad-3', '900000110', {
    reservationDuration: '60', capacityPerSlot: 3, reservationIntervalMinutes: 30,
  }));
  assert.equal(created.statusCode, 201);
  await activate('rest-capacidad-3');
  const resultados = [];
  for (let i = 0; i < 4; i++) {
    // Pequeña espera entre cada POST: la clave de la reserva en Redis es
    // `reservations:{clientId}:{Date.now()}` (api/reservations.js) -- sin
    // esto, 4 POSTs seguidos en el mismo milisegundo colisionan de clave en
    // el mock y una reserva pisa a otra, dando un falso positivo/negativo
    // ajeno a la lógica de capacidad que esta prueba quiere verificar.
    if (i > 0) await new Promise(r => setTimeout(r, 2));
    resultados.push(await postReservation({
      clientId: 'rest-capacidad-3', nombre: `Mesa ${i}`, telefono: `+5691${i}00000${i}`, email: `mesa${i}@example.com`,
      fecha: '2026-08-10', hora: '19:00', partySize: '2', language: 'es',
    }, `172.16.9.2${i}`));
  }
  assert.ok(resultados.slice(0, 3).every(r => r.responseBody.ok === true), 'prueba 11: las primeras 3 reservas simultáneas (capacidad 3) se aceptan');
  assert.equal(resultados[3].responseBody.ok, false, 'prueba 11: la cuarta reserva simultánea excede la capacidad y se rechaza');
  assert.equal(resultados[3].responseBody.motivo, 'sin_disponibilidad', 'prueba 11: motivo sin_disponibilidad al llenar la capacidad');
  console.log('✓ 11) capacidad 3: acepta exactamente hasta el límite y rechaza la siguiente');
}

// 14) Servicios antiguos de Restaurante sin duración no provocan crash.
{
  // Cliente legado: templateId restaurant, PERO sin reservationDuration Y sin
  // duracion en ningún plato (estado anterior a esta fase). Debe seguir
  // needing setup (correcto), nunca lanzar una excepción.
  const legacyId = 'rest-legado-sin-duracion';
  redisStore.set(`client:${legacyId}`, JSON.stringify({
    id: legacyId, businessName: 'Restaurante Legado', active: true, templateId: 'restaurant',
    timezone: 'America/Santiago', whatsapp: '+56900000199', businessHours: HOURS, capacityPerSlot: 2,
    services: [{ id: 'svc-legado', nombre: 'Plato del día', precio: '10', duracion: '' }],
    menu: [{ id: 'svc-legado', nombre: 'Plato del día', precio: '10', duracion: '' }],
  }));
  let threw = false;
  let resultado;
  try {
    resultado = await postReservation({
      clientId: legacyId, nombre: 'Cliente Legado', telefono: '+56944444444', email: 'legado@example.com',
      fecha: '2026-08-10', hora: '19:00', partySize: '2', language: 'es',
    }, '172.16.9.30');
  } catch (e) { threw = true; }
  assert.equal(threw, false, 'prueba 14: un Restaurante legado sin ninguna duración no lanza una excepción');
  assert.equal(resultado.responseBody.motivo, 'needs_setup', 'prueba 14: sigue pidiendo needs_setup (correcto: de verdad falta configurar), no un crash');
  console.log('✓ 14) Restaurante legado sin ninguna duración: needs_setup limpio, sin crash');
}

// 15) No se modifica el comportamiento de Spa ni Barbería (reservas reales).
{
  const spa = await postClient(basePayload('spa', 'spa-regresion', '900000120', {
    services: [{ nombre: 'Facial', precio: '100', duracion: '60' }],
  }));
  assert.equal(spa.statusCode, 201);
  await activate('spa-regresion');
  const spaRes = await postReservation({
    clientId: 'spa-regresion', nombre: 'Cliente Spa', telefono: '+56955555555', email: 'spa@example.com',
    fecha: '2026-08-10', hora: '11:00', servicio: 'Facial', language: 'es',
  }, '172.16.9.40');
  assert.equal(spaRes.responseBody.ok, true, `prueba 15: Spa sigue reservando igual (fue ${JSON.stringify(spaRes.responseBody)})`);
  assert.equal(readReservation(spaRes.responseBody.reservationId).duracion, 60, 'prueba 15: Spa usa la duración del servicio, sin tocar reservationDuration');

  const barber = await postClient(basePayload('barber', 'barber-regresion', '900000121', {
    services: [{ nombre: 'Corte', precio: '20', duracion: '45' }],
  }));
  assert.equal(barber.statusCode, 201);
  await activate('barber-regresion');
  const barberRes = await postReservation({
    clientId: 'barber-regresion', nombre: 'Cliente Barber', telefono: '+56966666666', email: 'barber@example.com',
    fecha: '2026-08-10', hora: '11:00', servicio: 'Corte', language: 'es',
  }, '172.16.9.41');
  assert.equal(barberRes.responseBody.ok, true, `prueba 15: Barbería sigue reservando igual (fue ${JSON.stringify(barberRes.responseBody)})`);
  assert.equal(readReservation(barberRes.responseBody.reservationId).duracion, 45, 'prueba 15: Barbería usa la duración del servicio, sin tocar reservationDuration');
  console.log('✓ 15) Spa y Barbería: comportamiento de reservas sin cambios');
}

// 16) Español e inglés siguen funcionando para Restaurante.
{
  const created = await postClient(basePayload('restaurant', 'rest-idiomas', '900000130', { reservationDuration: '60' }));
  assert.equal(created.statusCode, 201);
  await activate('rest-idiomas');
  const es = await postReservation({
    clientId: 'rest-idiomas', nombre: 'Cliente ES', telefono: '+56977777771', email: 'es@example.com',
    fecha: '2026-08-10', hora: '19:00', partySize: '2', language: 'es',
  }, '172.16.9.50');
  // Espera breve: evita que ambas reservas caigan en el mismo milisegundo y
  // colisionen de clave en Redis (`reservations:{clientId}:{Date.now()}`).
  await new Promise(r => setTimeout(r, 2));
  const en = await postReservation({
    clientId: 'rest-idiomas', nombre: 'Cliente EN', telefono: '+56977777772', email: 'en@example.com',
    fecha: '2026-08-10', hora: '19:00', partySize: '2', language: 'en',
  }, '172.16.9.51');
  const esReserva = readReservation(es.responseBody.reservationId);
  const enReserva = readReservation(en.responseBody.reservationId);
  assert.equal(es.responseBody.ok, true, 'prueba 16: reserva ES aceptada');
  assert.equal(esReserva.language, 'es', 'prueba 16: reservation.language = es');
  assert.equal(en.responseBody.ok, true, 'prueba 16: reserva EN aceptada');
  assert.equal(enReserva.language, 'en', 'prueba 16: reservation.language = en');
  const client = readClient('rest-idiomas');
  const htmlEs = reservationEmailHtml(client, esReserva, 'created');
  const htmlEn = reservationEmailHtml(client, enReserva, 'created');
  assert.ok(/confirm|reserva|cita/i.test(htmlEs), 'prueba 16: email ES en español');
  assert.ok(/confirm|reservation/i.test(htmlEn), 'prueba 16: email EN en inglés');
  console.log('✓ 16) Español e inglés siguen funcionando para Restaurante');
}

// 17) Catálogo, resumen y email no muestran "undefined"/"NaN"/valores inventados.
{
  const created = await postClient(basePayload('restaurant', 'rest-sin-nan', '900000140', {
    reservationDuration: '60',
    services: [{ nombre: 'Taco', precio: '10', duracion: '' }, { nombre: 'Ensalada', precio: '8', duracion: '' }],
  }));
  assert.equal(created.statusCode, 201);
  await activate('rest-sin-nan');
  const client = readClient('rest-sin-nan');
  const infoEs = businessInfoBlock(client, 'es');
  const infoEn = businessInfoBlock(client, 'en');
  assert.ok(!/undefined|NaN/.test(infoEs), 'prueba 17: el catálogo ES no muestra "undefined"/"NaN" para platos sin duración');
  assert.ok(!/undefined|NaN/.test(infoEn), 'prueba 17: el catálogo EN no muestra "undefined"/"NaN" para platos sin duración');
  const promptEs = await buildSystemPrompt(client.prompt, client, { gallery: 0, menuItems: [] }, 'es');
  assert.ok(!/undefined|NaN/.test(promptEs), 'prueba 17: el system prompt completo tampoco muestra "undefined"/"NaN"');
  const reserva = await postReservation({
    clientId: 'rest-sin-nan', nombre: 'Cliente NaN', telefono: '+56988888888', email: 'nan@example.com',
    fecha: '2026-08-10', hora: '19:00', partySize: '2', language: 'es',
  }, '172.16.9.60');
  const html = reservationEmailHtml(client, readReservation(reserva.responseBody.reservationId), 'created');
  assert.ok(!/undefined|NaN/.test(html), 'prueba 17: el email de confirmación no muestra "undefined"/"NaN"');
  console.log('✓ 17) Catálogo, prompt y email: sin "undefined"/"NaN" para platos sin duración');
}

// 18) client.services y client.menu permanecen sincronizados.
{
  const created = await postClient(basePayload('restaurant', 'rest-sync', '900000150', {
    reservationDuration: '60',
    services: [{ nombre: 'Sopa', precio: '5', duracion: '' }, { nombre: 'Postre', precio: '4', duracion: '' }],
  }));
  assert.equal(created.statusCode, 201);
  const client = created.responseBody;
  assert.equal(client.services.length, client.menu.length, 'prueba 18: services y menu tienen la misma cantidad de items');
  client.services.forEach((s, i) => {
    assert.equal(client.menu[i].id, s.id, `prueba 18: menu[${i}].id coincide con services[${i}].id`);
    assert.equal(client.menu[i].nombre, s.nombre, `prueba 18: menu[${i}].nombre coincide con services[${i}].nombre`);
    assert.equal(client.menu[i].duracion, s.duracion, `prueba 18: menu[${i}].duracion coincide con services[${i}].duracion (ambos vacíos, sin inventar)`);
  });
  console.log('✓ 18) client.services y client.menu permanecen sincronizados');
}

console.log('\nTodas las pruebas de duración de reserva en Restaurante pasan');
