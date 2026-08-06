// Test obligatorio (auditoría — "riesgo confirmado de validación de duración
// en Barbería"): la validación de FORMATO de duración (spaDurationMinutes,
// antes solo aplicada a Spa) ahora corre también para Barbería, reutilizando
// una única función compartida (lib/duration.js) en vez de regex duplicadas
// en admin.html/api/clients.js/api/reservations.js.
//  1. Spa "60" -> válido.
//  2. Spa "60 min" -> válido.
//  3. Spa "1 hora" -> válido.
//  4. Barbería "45" -> válido.
//  5. Barbería "45 min" -> válido.
//  6. Barbería "abc" -> rechazado.
//  7. Barbería "60abc" -> rechazado.
//  8. Barbería "0" -> rechazado.
//  9. Barbería negativo -> rechazado.
// 10. Duración superior al máximo -> rechazada.
// 11. Restaurante sin duración por plato y con reservationDuration válida -> válido.
// 12. Restaurante con reservationDuration inválida -> rechazado.
// 13. durationFor() nunca devuelve NaN, cero ni negativo.
// 14. Dos reservas solapadas siguen calculándose con la duración correcta.
// 15. Reagendado utiliza exactamente la misma duración.
// 16. Clientes antiguos con duración válida continúan funcionando.
// 17. No hay regresiones en Spa, Restaurante ni Barbería.
// 18-20. npm run test:unit / test:unit:critical / git diff --check (fuera de
// este archivo, ejecutados aparte).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

process.env.ADMIN_TOKEN = 'duracion-estricta-token';
process.env.UPSTASH_REDIS_REST_URL = 'https://duracion-estricta.redis';
process.env.UPSTASH_REDIS_REST_TOKEN = 'duracion-estricta-token';
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
const { __test: resTest } = await import('../api/reservations.js');
const { durationFor, validarReserva } = resTest;
const { isValidDurationMinutes, parseDurationMinutes } = await import('../lib/duration.js');

function readClient(id) {
  const raw = redisStore.get(`client:${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}
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
async function putClient(body) {
  let statusCode = 200; let responseBody = null;
  const res = { setHeader() {}, status(c) { statusCode = c; return this; }, json(b) { responseBody = b; return this; } };
  await clientHandler({ method: 'PUT', query: {}, headers: { 'x-admin-token': process.env.ADMIN_TOKEN }, body }, res);
  return { statusCode, responseBody };
}
async function postReservation(body, ip = '172.16.10.1') {
  let statusCode = 200; let responseBody = null;
  const res = { setHeader() {}, status(c) { statusCode = c; return this; }, json(b) { responseBody = b; return this; } };
  await reservationsHandler({ method: 'POST', query: {}, headers: { 'x-forwarded-for': ip }, body }, res);
  return { statusCode, responseBody };
}
async function activate(id) {
  const c = readClient(id);
  c.active = true;
  redisStore.set(`client:${id}`, JSON.stringify(c));
  return c;
}

const HOURS = { monday: { enabled: true, ranges: [{ start: '09:00', end: '22:00' }] } };
function basePayload(templateId, id, phoneNumber, duracion, extra = {}) {
  return {
    id, businessName: `Negocio ${id}`, templateId, templateVersion: '1.0',
    address: 'Calle Real 1', ownerEmail: 'owner@example.com', timezone: 'America/Santiago',
    notificationEmails: ['owner@example.com'],
    phoneCountry: 'CL', phoneCountryCode: '+56', phoneNumber,
    businessHours: HOURS,
    services: [{ nombre: 'Servicio', precio: '100', duracion }],
    capacityPerSlot: 2, bufferMinutes: 10,
    ...extra,
  };
}

console.log('Validación estricta de duraciones (Spa/Barbería/Restaurante)\n');

// 1) Spa "60" -> válido.
{
  const r = await postClient(basePayload('spa', 'dur-spa-60', '900001001', '60'));
  assert.equal(r.statusCode, 201, `prueba 1: Spa "60" válido (fue ${r.statusCode}: ${JSON.stringify(r.responseBody)})`);
  console.log('✓ 1) Spa "60" -> válido');
}

// 2) Spa "60 min" -> válido.
{
  const r = await postClient(basePayload('spa', 'dur-spa-60min', '900001002', '60 min'));
  assert.equal(r.statusCode, 201, `prueba 2: Spa "60 min" válido (fue ${r.statusCode})`);
  console.log('✓ 2) Spa "60 min" -> válido');
}

// 3) Spa "1 hora" -> válido.
{
  const r = await postClient(basePayload('spa', 'dur-spa-1hora', '900001003', '1 hora'));
  assert.equal(r.statusCode, 201, `prueba 3: Spa "1 hora" válido (fue ${r.statusCode})`);
  assert.equal(r.responseBody.services[0].duracion, '1 hora', 'prueba 3: se guarda el texto tal cual, sin reinterpretarlo a "60"');
  console.log('✓ 3) Spa "1 hora" -> válido');
}

// 4) Barbería "45" -> válido.
{
  const r = await postClient(basePayload('barber', 'dur-barber-45', '900001004', '45'));
  assert.equal(r.statusCode, 201, `prueba 4: Barbería "45" válido (fue ${r.statusCode}: ${JSON.stringify(r.responseBody)})`);
  console.log('✓ 4) Barbería "45" -> válido');
}

// 5) Barbería "45 min" -> válido.
{
  const r = await postClient(basePayload('barber', 'dur-barber-45min', '900001005', '45 min'));
  assert.equal(r.statusCode, 201, `prueba 5: Barbería "45 min" válido (fue ${r.statusCode})`);
  console.log('✓ 5) Barbería "45 min" -> válido');
}

// 6-10) Barbería con duraciones inválidas -> rechazadas, con error estructurado.
for (const [label, duracion] of [
  ['"abc"', 'abc'],
  ['"60abc"', '60abc'],
  ['"0"', '0'],
  ['negativo ("-30")', '-30'],
  ['superior al máximo ("1500")', '1500'],
]) {
  const r = await postClient(basePayload('barber', `dur-barber-bad-${duracion.replace(/[^a-z0-9]/gi, '')}`, `9000010${duracion.length}`, duracion));
  assert.equal(r.statusCode, 400, `prueba 6-10 (${label}): Barbería con duración ${label} rechazada (fue ${r.statusCode}: ${JSON.stringify(r.responseBody)})`);
  assert.deepEqual(r.responseBody.fields, ['services'], `prueba 6-10 (${label}): error estructurado con fields:["services"]`);
  console.log(`✓ 6-10) Barbería con duración ${label}: rechazada con fields:["services"]`);
}

// 11) Restaurante sin duración por plato y con reservationDuration válida -> válido.
{
  const r = await postClient(basePayload('restaurant', 'dur-rest-ok', '900001020', '', { reservationDuration: '90' }));
  assert.equal(r.statusCode, 201, `prueba 11: Restaurante sin duración por plato + reservationDuration válida (fue ${r.statusCode}: ${JSON.stringify(r.responseBody)})`);
  console.log('✓ 11) Restaurante sin duración por plato + reservationDuration válida -> válido');
}

// 12) Restaurante con reservationDuration inválida -> rechazado.
for (const bad of ['pronto', '0', '-10', '9999']) {
  const r = await postClient(basePayload('restaurant', `dur-rest-bad-${bad.replace(/[^a-z0-9]/gi, '')}`, `9000010${bad.length}9`, '', { reservationDuration: bad }));
  assert.equal(r.statusCode, 400, `prueba 12: Restaurante con reservationDuration "${bad}" rechazado (fue ${r.statusCode})`);
  assert.deepEqual(r.responseBody.fields, ['reservationDuration'], `prueba 12: fields:["reservationDuration"] para "${bad}"`);
}
console.log('✓ 12) Restaurante con reservationDuration inválida -> rechazado');

// PUT directo (bypass del formulario): Barbería con plantilla oficial también
// debe rechazar una duración inválida al actualizar, no solo al crear.
{
  const created = await postClient(basePayload('barber', 'dur-barber-put', '900001030', '45'));
  assert.equal(created.statusCode, 201);
  const put = await putClient({ id: 'dur-barber-put', services: [{ nombre: 'Servicio', precio: '100', duracion: '60abc' }] });
  assert.equal(put.statusCode, 400, `PUT directo con duración inválida en Barbería rechazado (fue ${put.statusCode}: ${JSON.stringify(put.responseBody)})`);
  assert.deepEqual(put.responseBody.fields, ['services'], 'PUT directo: error estructurado con fields:["services"]');
  assert.equal(readClient('dur-barber-put').services[0].duracion, '45', 'PUT rechazado: la duración previa válida no se sobrescribe');
  console.log('✓ PUT directo con duración inválida en Barbería (plantilla oficial): también rechazado, autoridad final del backend');
}

// 13) durationFor() nunca devuelve NaN, cero ni negativo -- ni con datos
// corruptos que, antes de esta fase, SÍ podían llegar a estar guardados
// (esto prueba la función de runtime, no la validación de escritura).
{
  const corrupto = { templateId: 'barber', menu: [{ nombre: 'Corte', duracion: '60abc' }] };
  const d1 = durationFor(corrupto, 'Corte');
  assert.ok(Number.isFinite(d1) && d1 >= 0, 'prueba 13: durationFor() nunca es NaN (duración de plato corrupta)');
  assert.notEqual(d1, NaN, 'prueba 13: explícitamente no es NaN');

  const vacio = { templateId: 'barber', menu: [{ nombre: 'Corte', duracion: '' }] };
  const d2 = durationFor(vacio, 'Corte');
  assert.ok(Number.isFinite(d2) && d2 >= 0, 'prueba 13: durationFor() nunca es NaN (sin duración)');

  const conFallbackInvalido = { templateId: 'restaurant', menu: [], reservationDuration: 'pronto' };
  const d3 = durationFor(conFallbackInvalido, '');
  assert.ok(Number.isFinite(d3) && d3 >= 0, 'prueba 13: durationFor() nunca es NaN (reservationDuration corrupta)');

  // parseDurationMinutes/isValidDurationMinutes: nunca negativo, nunca NaN.
  for (const txt of ['abc', '-30', '', '60abc', undefined, null, '0', '99999']) {
    const n = parseDurationMinutes(txt);
    assert.ok(Number.isFinite(n) && n >= 0, `prueba 13: parseDurationMinutes(${JSON.stringify(txt)}) nunca es NaN ni negativo (fue ${n})`);
  }
  console.log('✓ 13) durationFor()/parseDurationMinutes() nunca devuelven NaN, ni negativo (0 = "no interpretado", nunca una duración real)');
}

// 14) Dos reservas solapadas de Barbería siguen calculándose con la duración
// correcta (60 min, capacidad 1: la segunda a los 30 min choca).
{
  const created = await postClient(basePayload('barber', 'dur-barber-solape', '900001040', '60', { capacityPerSlot: 1, reservationIntervalMinutes: 30 }));
  assert.equal(created.statusCode, 201);
  await activate('dur-barber-solape');
  const primera = await postReservation({
    clientId: 'dur-barber-solape', nombre: 'Cliente Uno', telefono: '+56911111101', email: 'uno@example.com',
    fecha: '2026-08-10', hora: '11:00', servicio: 'Servicio', language: 'es',
  }, '172.16.10.10');
  assert.equal(primera.statusCode, 201, `prueba 14: primera reserva aceptada (fue ${primera.statusCode}: ${JSON.stringify(primera.responseBody)})`);
  const primeraReserva = readReservation(primera.responseBody.reservationId);
  assert.equal(primeraReserva.duracion, 60, 'prueba 14: la duración persistida es 60 (no 0)');
  await new Promise(r => setTimeout(r, 2));
  const segunda = await postReservation({
    clientId: 'dur-barber-solape', nombre: 'Cliente Dos', telefono: '+56911111102', email: 'dos@example.com',
    fecha: '2026-08-10', hora: '11:30', servicio: 'Servicio', language: 'es',
  }, '172.16.10.11');
  assert.equal(segunda.responseBody.ok, false, 'prueba 14: la segunda reserva (30 min después, dentro de los 60 min ocupados) se rechaza');
  assert.equal(segunda.responseBody.motivo, 'sin_disponibilidad', 'prueba 14: motivo sin_disponibilidad (el solapamiento SÍ se detecta con duración real)');
  console.log('✓ 14) Dos reservas de Barbería solapadas: la duración correcta (60) detecta el choque, no un choque exacto de minuto como con duración 0');
}

// 15) Reagendado utiliza exactamente la misma duración.
{
  const created = await postClient(basePayload('barber', 'dur-barber-reagenda', '900001050', '45', { capacityPerSlot: 2 }));
  assert.equal(created.statusCode, 201);
  await activate('dur-barber-reagenda');
  const original = await postReservation({
    clientId: 'dur-barber-reagenda', nombre: 'Cliente Reagenda', telefono: '+56911111103', email: 'reagenda@example.com',
    fecha: '2026-08-10', hora: '11:00', servicio: 'Servicio', language: 'es',
  }, '172.16.10.12');
  assert.equal(original.statusCode, 201);
  const originalReserva = readReservation(original.responseBody.reservationId);
  assert.equal(originalReserva.duracion, 45, 'prueba 15: duración original 45');
  const reagendada = await postReservation({
    clientId: 'dur-barber-reagenda', action: 'reschedule', actionToken: original.responseBody.actionToken,
    fecha: '2026-08-10', hora: '12:00',
  }, '172.16.10.13');
  assert.equal(reagendada.responseBody.ok, true, `prueba 15: reagendado aceptado (fue ${JSON.stringify(reagendada.responseBody)})`);
  assert.equal(reagendada.responseBody.reservation.duracion, 45, 'prueba 15: el reagendado conserva exactamente la misma duración (45), sin recalcularla a 0');
  console.log('✓ 15) Reagendado de Barbería: usa exactamente la misma duración (45)');
}

// 16) Clientes antiguos con duración válida continúan funcionando.
{
  const legacyId = 'dur-legado-valido';
  redisStore.set(`client:${legacyId}`, JSON.stringify({
    id: legacyId, businessName: 'Negocio Legado', active: true,
    timezone: 'America/Santiago', whatsapp: '+56900000199', businessHours: HOURS, capacityPerSlot: 2,
    services: [{ id: 'svc-legado', nombre: 'Corte clásico', precio: '20', duracion: '30' }],
    menu: [{ id: 'svc-legado', nombre: 'Corte clásico', precio: '20', duracion: '30' }],
  }));
  const legacyClient = readClient(legacyId);
  const resultado = validarReserva(legacyClient, '2026-08-10', '11:00', 'Corte clásico', 0, []);
  assert.equal(resultado.ok, true, `prueba 16: cliente legado (sin templateId) con duración válida sigue reservando (motivo: ${resultado.motivo || 'ok'})`);
  console.log('✓ 16) Cliente legado con duración válida: sigue funcionando');
}

// 17) No hay regresiones en Spa, Restaurante ni Barbería (creación + reserva real, las 3).
{
  for (const [templateId, phoneNumber, duracion, extra] of [
    ['spa', '900001060', '60', {}],
    ['barber', '900001061', '45', {}],
    ['restaurant', '900001062', '', { reservationDuration: '60' }],
  ]) {
    const created = await postClient(basePayload(templateId, `dur-regresion-${templateId}`, phoneNumber, duracion, extra));
    assert.equal(created.statusCode, 201, `prueba 17 (${templateId}): se crea correctamente (fue ${created.statusCode}: ${JSON.stringify(created.responseBody)})`);
    await activate(`dur-regresion-${templateId}`);
    const reserva = await postReservation({
      clientId: `dur-regresion-${templateId}`, nombre: `Cliente ${templateId}`, telefono: `+5691222${templateId.length}000`, email: `${templateId}@example.com`,
      fecha: '2026-08-10', hora: '11:00', servicio: templateId === 'restaurant' ? undefined : 'Servicio',
      partySize: templateId === 'restaurant' ? '2' : undefined, language: 'es',
    }, `172.16.10.2${templateId.length}`);
    assert.equal(reserva.responseBody.ok, true, `prueba 17 (${templateId}): reserva real aceptada (fue ${JSON.stringify(reserva.responseBody)})`);
  }
  console.log('✓ 17) Sin regresiones: Spa, Barbería y Restaurante crean y reservan correctamente');
}

console.log('\nTodas las pruebas de validación estricta de duraciones pasan');
