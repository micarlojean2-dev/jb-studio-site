// Auditoría "creador multi plantilla" — Requisito 5 (revisar creación real) y
// Tests obligatorios: crea Spa, Barbería y Restaurante ejecutando el HTML/JS
// REAL de admin.html (#spa-creator-form) en un DOM simulado (jsdom), no una
// reimplementación de su lógica. Confirma que cada plantilla produce el
// templateId correcto y nunca mezcla campos de otra plantilla (Requisito 2).
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const adminSrc = readFileSync(join(root, 'admin.html'), 'utf8');

// Se recorta el HTML del modal (#spa-creator-overlay) y su <script> propio
// (el arrow-IIFE `(() => {...})();`, distinto del wizard legacy/auto que usa
// otro patrón) directamente del archivo real — nunca se reescribe a mano.
const modalHtmlMatch = adminSrc.match(/<div id="spa-creator-overlay"[\s\S]*?<\/div>\s*\n<script>/);
assert.ok(modalHtmlMatch, 'no se encontró el markup de #spa-creator-overlay');
const modalHtml = modalHtmlMatch[0].replace(/<script>$/, '');
const scriptMatch = adminSrc.match(/<script>\s*\(\(\) => \{[\s\S]*?\}\)\(\);\s*<\/script>/);
assert.ok(scriptMatch, 'no se encontró el <script> del creador activo');
const script = scriptMatch[0].replace(/^<script>/, '').replace(/<\/script>$/, '');

const TEMPLATES = [
  { id: 'spa', name: 'Spa', version: '1.0', requiredFields: [], features: {} },
  { id: 'restaurant', name: 'Restaurante', version: '1.0', requiredFields: [], features: {} },
  { id: 'barber', name: 'Barberia', version: '1.0', requiredFields: [], features: {} },
];

async function buildDom(onPost) {
  const dom = new JSDOM(
    `<!doctype html><html><body><button id="open-spa-creator-btn">+ Crear chatbot</button>${modalHtml}</body></html>`,
    { runScripts: 'outside-only', url: 'https://jbstudio.app/admin' }
  );
  const { window } = dom;
  window.__jbAdmin = { getToken: () => 'test-token', refreshClients: () => {} };
  window.fetch = async (url, options = {}) => {
    if (String(url).includes('action=templates')) return { ok: true, json: async () => TEMPLATES };
    if (url === '/api/clients' && options.method === 'POST') {
      const body = JSON.parse(options.body);
      return onPost(body);
    }
    throw new Error('fetch inesperado: ' + url);
  };
  dom.window.eval(script);
  await new Promise(r => setTimeout(r, 20)); // deja resolver loadTemplates()
  return dom;
}

function $(dom, id) { return dom.window.document.getElementById(id); }

async function fillAndSubmit(dom, type, { duration = '30' } = {}) {
  const window = dom.window;
  $(dom, 'spa-type').value = type;
  $(dom, 'spa-type').dispatchEvent(new window.Event('change', { bubbles: true }));
  $(dom, 'spa-name').value = `Negocio ${type}`;
  $(dom, 'spa-address').value = 'Calle Real 123';
  $(dom, 'spa-phone-country').value = 'CL|+56';
  $(dom, 'spa-phone-number').value = '912345678';
  $(dom, 'spa-email').value = 'owner@example.com';
  $(dom, 'spa-timezone').value = 'America/Santiago';
  const mondayCheckbox = window.document.querySelector('[data-day="monday"] .spa-day-open');
  mondayCheckbox.checked = true;
  mondayCheckbox.dispatchEvent(new window.Event('change', { bubbles: true }));
  window.document.querySelector('[data-day="monday"] .spa-start').value = '09:00';
  window.document.querySelector('[data-day="monday"] .spa-end').value = '18:00';
  const row = window.document.querySelector('.spa-service-row');
  row.querySelector('.spa-service-name').value = 'Servicio Uno';
  row.querySelector('.spa-service-price').value = '100';
  row.querySelector('.spa-service-duration').value = duration;
  // capacityPerSlot es obligatorio para las 3 plantillas (barberos/cabinas/
  // mesas simultáneas); bufferMinutes solo tiene efecto en Spa.
  $(dom, 'spa-capacity').value = '5';
  if (type === 'spa') {
    $(dom, 'spa-buffer').value = '10';
  }
  $(dom, 'spa-creator-form').dispatchEvent(new window.Event('input', { bubbles: true }));
  $(dom, 'spa-creator-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 20));
}

console.log('Creación real vía admin.html: Spa, Restaurante, Barbería (DOM simulado, JS real)');
{
  for (const type of ['spa', 'restaurant', 'barber']) {
    let posted = null;
    const dom = await buildDom(body => {
      posted = body;
      return { ok: true, status: 201, json: async () => ({ id: body.id, panelToken: 'p'.repeat(36), assistantUrl: 'https://x', ...body }) };
    });
    // El click ahora es async: espera a loadTemplates() antes de abrir el
    // modal (fix del bug de producción: cargar al abrir, no al iniciar la
    // página sin sesión). Se espera un tick antes de tocar el formulario.
    $(dom, 'open-spa-creator-btn').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 20));
    await fillAndSubmit(dom, type, { duration: type === 'restaurant' ? '' : '30' });

    assert.equal(posted?.templateId, type, `${type}: templateId enviado es el elegido, no otro`);
    assert.equal(posted?.templateVersion, '1.0', `${type}: templateVersion presente`);
    assert.ok(!('prompt' in (posted || {})), `${type}: el navegador NUNCA manda prompt (lo deriva el backend)`);
    assert.ok(!('businessType' in (posted || {})), `${type}: el navegador NUNCA manda businessType (lo fija el backend desde templateId)`);
    // capacityPerSlot SIEMPRE va (api/reservations.js lo usa para las 3
    // plantillas: "cuántas citas simultáneas admite el negocio: barberos,
    // cabinas, mesas"). bufferMinutes es exclusivo de Spa.
    assert.equal(posted.capacityPerSlot, 5, `${type}: incluye capacityPerSlot aunque no sea Spa`);
    if (type === 'spa') {
      assert.equal(posted.bufferMinutes, 10, 'spa: incluye bufferMinutes');
    } else {
      assert.ok(!('bufferMinutes' in posted), `${type}: no manda bufferMinutes (sin efecto fuera de Spa)`);
    }
    console.log(`  ✓ ${type}: creación real vía admin.html produce templateId/payload correctos, sin mezclar con otra plantilla`);
  }
}

console.log('XSS: importar un nombre de servicio con HTML no ejecuta ni queda como markup');
{
  const dom = await buildDom(() => ({ ok: true, status: 201, json: async () => ({}) }));
  $(dom, 'open-spa-creator-btn').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
  $(dom, 'spa-import-toggle').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  $(dom, 'spa-import').value = '"><img src=x onerror=alert(1)> | 100 | 30';
  $(dom, 'spa-import-run').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  assert.equal(dom.window.document.querySelectorAll('.spa-service-row img').length, 0, 'no se crea un <img> real en el DOM');
  assert.ok(dom.window.document.querySelector('.spa-service-name').value.includes('<img'), 'el texto queda como valor de input, no como HTML insertado');
  console.log('  ✓ importar un nombre de servicio con HTML no produce un elemento inyectado');
}

console.log('Errores del backend: fields se muestra al usuario, no solo el mensaje genérico');
{
  const dom = await buildDom(() => ({ ok: false, status: 400, json: async () => ({ error: 'Missing required template fields', fields: ['capacityPerSlot'] }) }));
  $(dom, 'open-spa-creator-btn').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
  await fillAndSubmit(dom, 'spa');
  const summary = $(dom, 'spa-creator-summary').textContent;
  assert.ok(summary.includes('capacityPerSlot'), `el resumen de error debe mencionar el campo específico, fue: "${summary}"`);
  console.log('  ✓ el error del backend con fields aparece en el resumen mostrado al admin');
}

console.log('Todas las pruebas de creación multi-plantilla (admin.html real) pasan');
