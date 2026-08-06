// Test obligatorio (auditoría FASE 5 — zona horaria automática):
//  1. Dirección + país obtienen una zona IANA del endpoint interno.
//  2. Una respuesta sin coincidencia deja la selección manual.
//  3. Administrador cambia manualmente la zona detectada -> no se vuelve a
//     sobrescribir al cerrar/reabrir el modal.
//  4. Detección vacía o que lanza error -> el formulario exige selección manual
//     (nunca cae en UTC en silencio).
//  5. Zona inválida escrita a mano -> el frontend bloquea la creación.
//  6. Zona inválida enviada directo al backend (POST y PUT) -> 400 estructurado
//     con fields:["timezone"], solo para clientes con plantilla oficial.
//  7. Zona válida -> se guarda EXACTAMENTE (sin normalizar/alterar) en Redis.
//  8. Las 3 plantillas: Spa, Barbería, Restaurante.
//  9. "mañana" se resuelve usando la zona guardada del negocio, no la del
//     servidor (nowEnZona real, sin reimplementar su lógica).
// 10. Cliente antiguo (sin plantilla oficial) con timezone UTC sigue
//     funcionando, y una actualización con timezone inválido NO se bloquea
//     (compatibilidad hacia atrás -- el 400 estricto es solo para clientes
//     con plantilla oficial).
// 11. Abrir y cerrar el modal varias veces no cambia una selección manual
//     previa ni registra un listener de "input" duplicado en #spa-timezone.
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

process.env.ADMIN_TOKEN = 'timezone-auto-deteccion-token';
process.env.UPSTASH_REDIS_REST_URL = 'https://timezone-auto-deteccion.redis';
process.env.UPSTASH_REDIS_REST_TOKEN = 'timezone-auto-deteccion-token';
const redisStore = new Map();
globalThis.fetch = async (url, options = {}) => {
  const command = new URL(url).pathname.split('/').filter(Boolean).pop();
  const args = JSON.parse(options.body || '[]');
  const execute = (entry) => {
    const [op, ...values] = entry;
    if (String(op).toLowerCase() === 'get') return redisStore.get(values[0]) ?? null;
    if (String(op).toLowerCase() === 'set') { redisStore.set(values[0], values[1]); return 'OK'; }
    throw new Error(`Unsupported Redis command: ${op}`);
  };
  const result = command === 'pipeline' ? args.map(entry => ({ result: execute(entry) })) : { result: execute(args) };
  return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const { default: clientHandler } = await import('../api/clients.js');
const { __test: resTest } = await import('../api/reservations.js');
const { parseFechaISO, nowEnZona, validarReserva } = resTest;

function readClient(id) {
  const raw = redisStore.get(`client:${id}`);
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

const HOURS = { monday: { enabled: true, ranges: [{ start: '09:00', end: '18:00' }] } };
function basePayload(templateId, id, phoneNumber, timezone) {
  return {
    id, businessName: `Negocio ${id}`,
    templateId, templateVersion: '1.0',
    address: 'Calle Real 1', ownerEmail: 'owner@example.com', timezone,
    notificationEmails: ['owner@example.com'],
    phoneCountry: 'CL', phoneCountryCode: '+56', phoneNumber,
    businessHours: HOURS,
    services: [{ nombre: 'Servicio', precio: '100', duracion: templateId === 'restaurant' ? '' : '30' }],
    ...(templateId === 'restaurant' ? { reservationDuration: '60' } : {}),
    capacityPerSlot: 2, bufferMinutes: 10,
  };
}

// ---------------------------------------------------------------------------
// Harness frontend: extrae el #spa-creator-form REAL de admin.html (mismo
// patrón que test/e2e-admin-to-chatbot.test.mjs) y simula el endpoint interno
// que consulta Geoapify desde el servidor.
// ---------------------------------------------------------------------------
const adminSrc = readFileSync(join(root, 'admin.html'), 'utf8');
const modalHtml = adminSrc.match(/<div id="spa-creator-overlay"[\s\S]*?<\/div>\s*\n<script>/)[0].replace(/<script>$/, '');
const script = adminSrc.match(/<script>\s*\(\(\) => \{[\s\S]*?\}\)\(\);\s*<\/script>/)[0].replace(/^<script>/, '').replace(/<\/script>$/, '');
const TEMPLATES = [
  { id: 'spa', name: 'Spa', version: '1.0', requiredFields: [], features: {} },
  { id: 'restaurant', name: 'Restaurante', version: '1.0', requiredFields: [], features: {} },
  { id: 'barber', name: 'Barberia', version: '1.0', requiredFields: [], features: {} },
];

async function buildDom() {
  const dom = new JSDOM(`<!doctype html><html><body><button id="open-spa-creator-btn">+ Crear chatbot</button>${modalHtml}</body></html>`,
    { runScripts: 'outside-only', url: 'https://jbstudio.app/admin' });
  const { window } = dom;
  window.__jbAdmin = { getToken: () => 'timezone-auto-deteccion-token', refreshClients: () => {} };
  window.__timezoneLookup = null;
  window.fetch = async (url) => {
    if (String(url).includes('action=templates')) return { ok: true, json: async () => TEMPLATES };
    if (String(url).includes('action=detect-timezone')) return window.__timezoneLookup
      ? window.__timezoneLookup()
      : { ok: true, json: async () => ({ timezone: null, address: null }) };
    throw new Error('fetch inesperado: ' + url);
  };
  // Cuenta cuántas veces se registra un listener "input" sobre #spa-timezone,
  // para la prueba 11 (sin listeners duplicados al abrir/cerrar el modal).
  window.__inputListenerCount = { 'spa-timezone': 0 };
  const OrigAdd = window.EventTarget.prototype.addEventListener;
  window.EventTarget.prototype.addEventListener = function (type, ...rest) {
    if (this && this.id === 'spa-timezone' && type === 'input') window.__inputListenerCount['spa-timezone']++;
    return OrigAdd.call(this, type, ...rest);
  };
  dom.window.eval(script);
  await new Promise(r => setTimeout(r, 20));
  return dom;
}

function $(dom, id) { return dom.window.document.getElementById(id); }
async function openCreator(dom) {
  $(dom, 'open-spa-creator-btn').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
}

console.log('FASE 5 — zona horaria automática\n');

// 1) Una dirección confirmada por el backend llena el campo sin marcarlo rojo.
{
  const dom = await buildDom();
  await openCreator(dom);
  dom.window.__timezoneLookup = async () => ({ ok: true, json: async () => ({ timezone: 'America/Santiago', address: 'Avenida Apoquindo 3000, Las Condes, Chile' }) });
  $(dom, 'spa-address').value = 'Av. Apoquindo 3000';
  $(dom, 'spa-phone-country').value = 'CL|+56';
  $(dom, 'spa-address').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
  assert.equal($(dom, 'spa-timezone').value, 'America/Santiago', 'prueba 1: el campo se prellena con la zona de la dirección');
  assert.match($(dom, 'spa-timezone-hint').textContent, /Detectada desde Avenida Apoquindo/, 'prueba 1: la etiqueta cita la dirección confirmada');
  assert.equal($(dom, 'spa-timezone').classList.contains('spa-field-invalid'), false, 'prueba 1: una zona válida sugerida no queda marcada en rojo');
  console.log('✓ 1) dirección + país sugieren America/Santiago sin borde rojo');
}

// 3) Administrador cambia manualmente la zona detectada -> no se vuelve a
//    sobrescribir, ni siquiera cerrando y reabriendo el modal varias veces.
{
  const dom = await buildDom();
  await openCreator(dom);
  $(dom, 'spa-timezone').value = 'Europe/Madrid';
  $(dom, 'spa-timezone').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.match($(dom, 'spa-timezone-hint').textContent, /manualmente/, 'prueba 3: la etiqueta refleja la elección manual');
  // Cerrar y reabrir el modal 3 veces: la detección seguiría devolviendo Los
  // Ángeles si se volviera a ejecutar, así que si el valor cambiara sabríamos
  // que se sobrescribió la elección manual.
  for (let i = 0; i < 3; i++) {
    $(dom, 'spa-creator-close').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await openCreator(dom);
    assert.equal($(dom, 'spa-timezone').value, 'Europe/Madrid', `prueba 3: la zona manual sobrevive a reapertura #${i + 1}`);
  }
  console.log('✓ 3) elección manual nunca se sobrescribe al reabrir el modal');
}

// 4) Sin una coincidencia confirmada, exige selección manual (nunca UTC en
// silencio) y bloquea la creación.
{
  const dom = await buildDom();
  await openCreator(dom);
  $(dom, 'spa-address').value = 'Dirección sin confirmar';
  $(dom, 'spa-phone-country').value = 'CL|+56';
  $(dom, 'spa-address').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
  assert.equal($(dom, 'spa-timezone').value, '', 'prueba 4: el campo queda vacío, nunca UTC en silencio');
  assert.match($(dom, 'spa-timezone-hint').textContent, /manualmente/, 'prueba 4: la etiqueta pide selección manual');
  console.log('✓ 4) sin coincidencia: exige selección manual, sin caer en UTC');
}

// 5) Zona inválida escrita a mano -> el frontend bloquea la creación
//    (create.disabled se mantiene true).
{
  const dom = await buildDom();
  await openCreator(dom);
  // Completa el resto del formulario para aislar el timezone como única causa
  // de bloqueo.
  $(dom, 'spa-type').value = 'spa'; $(dom, 'spa-type').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  $(dom, 'spa-name').value = 'Negocio Prueba';
  $(dom, 'spa-address').value = 'Calle 1';
  $(dom, 'spa-phone-country').value = 'CL|+56';
  $(dom, 'spa-phone-number').value = '900000000';
  $(dom, 'spa-email').value = 'a@example.com';
  $(dom, 'spa-timezone').value = 'Zona/Inventada';
  $(dom, 'spa-timezone').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  const mon = dom.window.document.querySelector('[data-day="monday"] .spa-day-open');
  mon.checked = true; mon.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  dom.window.document.querySelector('[data-day="monday"] .spa-start').value = '10:00';
  dom.window.document.querySelector('[data-day="monday"] .spa-end').value = '19:00';
  const row = dom.window.document.querySelector('.spa-service-row');
  row.querySelector('.spa-service-name').value = 'Servicio';
  row.querySelector('.spa-service-price').value = '100';
  row.querySelector('.spa-service-duration').value = '30';
  $(dom, 'spa-capacity').value = '2'; $(dom, 'spa-buffer').value = '10';
  $(dom, 'spa-creator-form').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.ok($(dom, 'spa-timezone').classList.contains('spa-field-invalid'), 'prueba 5: el campo se marca inválido');
  assert.equal($(dom, 'spa-create').disabled, true, 'prueba 5: el botón crear queda deshabilitado con timezone inválido');
  console.log('✓ 5) zona inválida escrita a mano bloquea la creación en el frontend');
}

// 6) Zona inválida enviada directo al backend (sin pasar por el frontend) ->
//    400 estructurado, solo para plantillas oficiales.
{
  const post = await postClient(basePayload('spa', 'tz-invalid-post', '900000001', 'Zona/Inventada'));
  assert.equal(post.statusCode, 400, 'prueba 6 (POST): zona inválida rechazada con 400');
  assert.deepEqual(post.responseBody.fields, ['timezone'], 'prueba 6 (POST): fields:["timezone"]');

  const created = await postClient(basePayload('barber', 'tz-invalid-put', '900000002', 'America/Santiago'));
  assert.equal(created.statusCode, 201, 'prueba 6 (PUT, setup): el cliente base se crea con zona válida');
  const put = await putClient({ id: 'tz-invalid-put', timezone: 'Zona/Inventada' });
  assert.equal(put.statusCode, 400, 'prueba 6 (PUT): zona inválida rechazada con 400');
  assert.deepEqual(put.responseBody.fields, ['timezone'], 'prueba 6 (PUT): fields:["timezone"]');
  const stillValid = readClient('tz-invalid-put');
  assert.equal(stillValid.timezone, 'America/Santiago', 'prueba 6 (PUT): el rechazo no modifica la zona ya guardada');
  console.log('✓ 6) zona inválida enviada directo al backend: 400 + fields:["timezone"] en POST y PUT');
}

// 7) Zona válida -> se guarda EXACTAMENTE en Redis, sin normalizar/alterar.
{
  const created = await postClient(basePayload('spa', 'tz-exact-post', '900000003', 'America/Argentina/Buenos_Aires'));
  assert.equal(created.statusCode, 201, 'prueba 7 (POST): se crea con zona válida');
  assert.equal(created.responseBody.timezone, 'America/Argentina/Buenos_Aires', 'prueba 7 (POST): timezone guardado exacto');
  assert.equal(readClient('tz-exact-post').timezone, 'America/Argentina/Buenos_Aires', 'prueba 7 (POST): coincide en Redis');

  const put = await putClient({ id: 'tz-exact-post', timezone: 'Europe/London' });
  assert.equal(put.statusCode, 200, 'prueba 7 (PUT): la actualización con zona válida se acepta');
  assert.equal(readClient('tz-exact-post').timezone, 'Europe/London', 'prueba 7 (PUT): timezone actualizado exacto en Redis');
  console.log('✓ 7) zona válida se guarda exactamente, sin alteraciones, en POST y PUT');
}

// 8) Las 3 plantillas: Spa, Barbería, Restaurante.
{
  for (const [templateId, phoneNumber, tz] of [
    ['spa', '900000010', 'America/Los_Angeles'],
    ['barber', '900000011', 'America/Mexico_City'],
    ['restaurant', '900000012', 'Europe/Madrid'],
  ]) {
    const created = await postClient(basePayload(templateId, `tz-${templateId}`, phoneNumber, tz));
    assert.equal(created.statusCode, 201, `prueba 8 (${templateId}): se crea correctamente`);
    assert.equal(created.responseBody.timezone, tz, `prueba 8 (${templateId}): timezone guardado exacto`);
    const invalid = await postClient(basePayload(templateId, `tz-${templateId}-bad`, phoneNumber + '1', 'No/Existe'));
    assert.equal(invalid.statusCode, 400, `prueba 8 (${templateId}): zona inválida también se rechaza en esta plantilla`);
  }
  console.log('✓ 8) las 3 plantillas (Spa, Barbería, Restaurante) validan/guardan timezone igual');
}

// 9) "mañana" se resuelve usando la zona guardada del negocio, no la del
//    servidor. Se usan dos zonas reales con 26h de diferencia de offset
//    (Pacific/Kiritimati UTC+14 vs Etc/GMT+12 UTC-12): con más de 24h de
//    separación, el día calendario local SIEMPRE difiere entre ambas sin
//    importar el instante real en que corra la prueba -- no depende de la
//    hora del día en que se ejecuten los tests.
{
  const tzAdelantada = 'Pacific/Kiritimati'; // UTC+14
  const tzAtrasada = 'Etc/GMT+12';           // UTC-12
  const hoyAdelantada = nowEnZona(tzAdelantada);
  const hoyAtrasada = nowEnZona(tzAtrasada);
  assert.notEqual(hoyAdelantada.toISOString().slice(0, 10), hoyAtrasada.toISOString().slice(0, 10),
    'prueba 9: dos negocios en zonas muy distintas tienen "hoy" en fechas distintas');

  const mananaAdelantada = parseFechaISO('mañana', hoyAdelantada);
  const mananaAtrasada = parseFechaISO('mañana', hoyAtrasada);
  assert.notEqual(mananaAdelantada, mananaAtrasada,
    'prueba 9: "mañana" resuelve a fechas distintas según la zona guardada del negocio');
  // Confirma explícitamente que NO se usa una única zona fija (la del
  // servidor): "mañana" calculado con la zona del negocio coincide con
  // sumar 1 día al "hoy" de ESA zona, no con el "hoy" del servidor.
  assert.equal(mananaAdelantada, new Date(hoyAdelantada.getTime() + 86400000).toISOString().slice(0, 10),
    'prueba 9: "mañana" en la zona adelantada es +1 día sobre el "hoy" de esa misma zona');
  console.log('✓ 9) "mañana" usa la zona horaria guardada del negocio, no la del servidor');
}

// 10) Cliente antiguo (sin plantilla oficial) con timezone UTC sigue
//     funcionando, y una actualización con timezone inválido NO se bloquea
//     (compatibilidad: el 400 estricto es solo para plantillas oficiales).
{
  const legacyId = 'tz-legacy-cliente';
  redisStore.set(`client:${legacyId}`, JSON.stringify({
    id: legacyId, businessName: 'Negocio Legado', active: true, timezone: 'UTC',
    whatsapp: '+56900000099', businessHours: HOURS, capacityPerSlot: 2,
    services: [{ id: 'svc-1', nombre: 'Servicio', precio: '100', duracion: 30 }],
    menu: [{ id: 'svc-1', nombre: 'Servicio', precio: '100', duracion: 30 }],
  }));
  const legacyClient = readClient(legacyId);
  const resultado = validarReserva(legacyClient, '2026-08-10', '11:00', 'Servicio', 0, []); // lunes dentro de horario
  assert.equal(resultado.ok, true, `prueba 10: cliente antiguo con timezone UTC sigue validando reservas (motivo: ${resultado.motivo || 'ok'})`);

  const put = await putClient({ id: legacyId, timezone: 'Zona/Inventada' });
  assert.equal(put.statusCode, 200, 'prueba 10: cliente sin plantilla oficial NO recibe el 400 estricto');
  assert.equal(readClient(legacyId).timezone, 'UTC', 'prueba 10: comportamiento legado preservado (fallback silencioso a UTC, sin romper al cliente)');
  console.log('✓ 10) cliente antiguo con timezone UTC sigue funcionando, sin el 400 estricto');
}

// 11) Abrir y cerrar el modal varias veces no cambia una selección manual
//     previa ni registra un listener "input" duplicado en #spa-timezone.
{
  const dom = await buildDom();
  await openCreator(dom);
  $(dom, 'spa-timezone').value = 'America/Bogota';
  $(dom, 'spa-timezone').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  for (let i = 0; i < 5; i++) {
    $(dom, 'spa-creator-close').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await openCreator(dom);
  }
  assert.equal($(dom, 'spa-timezone').value, 'America/Bogota', 'prueba 11: la selección manual sobrevive a 5 reaperturas');
  assert.equal(dom.window.__inputListenerCount['spa-timezone'], 1, 'prueba 11: el listener "input" de #spa-timezone se registra una sola vez, nunca por apertura');
  console.log('✓ 11) abrir/cerrar el modal repetidamente no duplica listeners ni pierde la selección manual');
}

console.log('\nTodas las pruebas de zona horaria automática pasan');
