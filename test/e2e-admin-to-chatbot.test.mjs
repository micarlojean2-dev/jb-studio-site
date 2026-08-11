// Test obligatorio end-to-end (auditoría "creador multi plantilla"): crea
// Spa, Barbería y Restaurante usando el JS REAL del admin (#spa-creator-form
// en jsdom) contra el handler REAL de api/clients.js (Redis mockeado, sin
// red real) y confirma la cadena completa: payload -> Redis -> prompt del
// chatbot -> teléfono -> servicios/menú -> reservas (dentro/fuera de
// horario, capacidad respetada). No es una reimplementación de la lógica:
// es el código de producción ejecutándose contra sí mismo.
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

process.env.ADMIN_TOKEN = 'e2e-admin-to-chatbot-token';
process.env.UPSTASH_REDIS_REST_URL = 'https://e2e-admin-to-chatbot.redis';
process.env.UPSTASH_REDIS_REST_TOKEN = 'e2e-admin-to-chatbot-token';
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

const { default: clientHandler, __test: clientTest } = await import('../api/clients.js');
const { useClientStripeDouble } = await import('./client-stripe-double.mjs');
useClientStripeDouble(clientTest);
const { getOfficialTemplate } = await import('../lib/assistant-templates.mjs');
const { __test: chatTest } = await import('../api/client-chat.js');
const { __test: resTest } = await import('../api/reservations.js');
const { businessInfoBlock, buildSystemPrompt } = chatTest;
const { validarReserva } = resTest;

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
  window.__jbAdmin = { getToken: () => 'e2e-admin-to-chatbot-token', refreshClients: () => {} };
  window.fetch = async (url, options = {}) => {
    if (String(url).includes('action=templates')) return { ok: true, json: async () => TEMPLATES };
    if (url === '/api/clients' && options.method === 'POST') {
      // Puente real: el fetch del navegador simulado invoca el handler REAL
      // de api/clients.js, no una respuesta fabricada a mano.
      const body = JSON.parse(options.body);
      let statusCode = 200; let responseBody = null;
      const fakeRes = { setHeader() {}, status(c) { statusCode = c; return this; }, json(b) { responseBody = b; return this; } };
      await clientHandler({ method: 'POST', query: {}, headers: { 'x-admin-token': 'e2e-admin-to-chatbot-token' }, body }, fakeRes);
      return { ok: statusCode >= 200 && statusCode < 300, status: statusCode, json: async () => responseBody };
    }
    throw new Error('fetch inesperado: ' + url);
  };
  dom.window.eval(script);
  await new Promise(r => setTimeout(r, 20));
  return dom;
}

function $(dom, id) { return dom.window.document.getElementById(id); }

async function createViaAdmin(type, phoneNumber, svcName) {
  const dom = await buildDom();
  const window = dom.window;
  // El click ahora es async: espera a loadTemplates() antes de abrir el
  // modal (fix del bug de producción de cargar plantillas antes del login).
  $(dom, 'open-spa-creator-btn').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
  $(dom, 'spa-type').value = type;
  $(dom, 'spa-type').dispatchEvent(new window.Event('change', { bubbles: true }));
  $(dom, 'spa-name').value = `Negocio E2E ${type}`;
  $(dom, 'spa-address').value = 'Av. Prueba 456';
  $(dom, 'spa-phone-country').value = 'CL|+56';
  $(dom, 'spa-phone-number').value = phoneNumber;
  $(dom, 'spa-email').value = 'owner@example.com';
  $(dom, 'spa-timezone').value = 'America/Santiago';
  const mon = window.document.querySelector('[data-day="monday"] .spa-day-open');
  mon.checked = true; mon.dispatchEvent(new window.Event('change', { bubbles: true }));
  window.document.querySelector('[data-day="monday"] .spa-start').value = '10:00';
  window.document.querySelector('[data-day="monday"] .spa-end').value = '19:00';
  const row = window.document.querySelector('.spa-service-row');
  row.querySelector('.spa-service-name').value = svcName;
  row.querySelector('.spa-service-price').value = '25000';
  row.querySelector('.spa-service-duration').value = type === 'restaurant' ? '' : '45';
  // capacityPerSlot va SIEMPRE (barberos/cabinas/mesas simultáneas);
  // bufferMinutes solo tiene efecto real en Spa.
  $(dom, 'spa-capacity').value = type === 'restaurant' ? '10' : '3';
  if (type === 'spa') $(dom, 'spa-buffer').value = '15';
  if (type === 'restaurant') $(dom, 'spa-reservation-duration').value = '90';
  $(dom, 'spa-creator-form').dispatchEvent(new window.Event('input', { bubbles: true }));
  $(dom, 'spa-creator-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 30));
  return dom;
}

for (const [type, phoneNumber, svcName] of [
  ['spa', '911111111', 'Masaje relajante'],
  ['barber', '922222222', 'Corte de pelo'],
  ['restaurant', '933333333', 'Menu degustacion'],
]) {
  console.log(`\n${type.toUpperCase()} — Admin real -> api/clients.js real -> Redis -> chatbot`);
  const dom = await createViaAdmin(type, phoneNumber, svcName);

  const successHtml = $(dom, 'spa-success').innerHTML;
  assert.ok(successHtml.includes('Chatbot creado'), `${type}: el admin muestra "Chatbot creado" tras el submit real`);
  const id = successHtml.match(/asistente\/([a-z0-9-]+)/)?.[1];
  assert.ok(id, `${type}: se extrae el id del cliente creado`);

  const raw = redisStore.get(`client:${id}`);
  assert.ok(raw, `${type}: client:${id} quedó guardado en Redis`);
  const client = typeof raw === 'string' ? JSON.parse(raw) : raw;

  assert.equal(client.templateId, type, `${type}: templateId guardado coincide con la plantilla elegida`);
  assert.equal(client.businessType, type, `${type}: businessType guardado coincide con templateId (nunca desalineado)`);
  const official = getOfficialTemplate(type);
  assert.ok(client.prompt.startsWith(official.promptBase), `${type}: el prompt guardado es el oficial de "${type}", no el de otra plantilla`);
  assert.equal(client.capacityPerSlot, type === 'restaurant' ? 10 : 3, `${type}: capacityPerSlot real guardado (nunca el default silencioso de 1)`);
  if (type === 'spa') assert.equal(client.bufferMinutes, 15, 'spa: bufferMinutes guardado');
  console.log(`  ✓ cliente guardado correctamente: templateId/businessType/prompt/capacidad`);

  const promptEs = await buildSystemPrompt(client.prompt, client, { gallery: 0, menuItems: [] }, 'es');
  assert.ok(promptEs.includes(client.whatsapp), `${type}: el chatbot recibe el teléfono real (${client.whatsapp})`);
  assert.ok(promptEs.includes(svcName) && promptEs.includes('25000'), `${type}: el chatbot recibe el servicio/menú real con su precio`);
  console.log('  ✓ chatbot funcional: teléfono y servicios/menú presentes en el system prompt');

  const dentro = validarReserva(client, '2026-08-10', '11:00', svcName, 0, []); // lunes, dentro de 10:00-19:00
  assert.equal(dentro.ok, true, `${type}: una reserva dentro de horario/capacidad se acepta (motivo: ${dentro.motivo || 'ok'})`);
  const fuera = validarReserva(client, '2026-08-10', '08:00', svcName, 0, []);
  assert.equal(fuera.motivo, 'fuera_de_horario', `${type}: una reserva fuera de horario se rechaza`);
  const activas = Array.from({ length: client.capacityPerSlot }, () => ({ estado: 'confirmada', fechaISO: '2026-08-10', horaISO: '11:00', servicio: svcName, duracion: 45 }));
  const lleno = validarReserva(client, '2026-08-10', '11:00', svcName, 0, activas);
  assert.equal(lleno.motivo, 'sin_disponibilidad', `${type}: al llenar la capacidad real (${client.capacityPerSlot}) la siguiente reserva se rechaza`);
  console.log(`  ✓ reservas funcionan con datos reales: horario y capacidad (${client.capacityPerSlot}) respetados`);
}

console.log('\nTodas las pruebas end-to-end Admin -> Redis -> chatbot pasan');
