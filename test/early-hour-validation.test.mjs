import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const coreSource = readFileSync(join(root, 'chat-core.js'), 'utf8');
const assistantSource = readFileSync(join(root, 'asistente.html'), 'utf8');
const assistantScript = assistantSource.match(/<script>\n([\s\S]*?)\n<\/script>\n<\/body>/)[1];
const widgetSource = readFileSync(join(root, 'widget.js'), 'utf8');
const businessHours = {
  monday: { enabled: true, ranges: [{ start: '10:00', end: '21:00' }] },
  tuesday: { enabled: true, ranges: [{ start: '10:00', end: '21:00' }] },
};
const client = {
  id: 'hora-prueba', businessName: 'Negocio Prueba', templateId: 'spa', language: 'es',
  businessHours, menu: [{ nombre: 'Masaje', precio: '50', duracion: '60' }],
  features: { reservations: true }, capacityPerSlot: 1,
};
const wait = () => new Promise(resolve => setTimeout(resolve, 25));

function installFetch(window) {
  window.fetch = async url => {
    if (String(url).includes('/api/client-config')) return { ok: true, json: async () => client };
    if (String(url).includes('/api/build')) return { ok: true, json: async () => ({}) };
    throw new Error(`Unexpected fetch: ${url}`);
  };
}

async function send(window, inputId, buttonId, text) {
  window.document.getElementById(inputId).value = text;
  window.document.getElementById(buttonId).dispatchEvent(new window.Event('click', { bubbles: true }));
  await wait();
}

{
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
  dom.window.eval(coreSource);
  const extracted = dom.window.JBChatCore.extractBooking('Quiero reservar mañana a las 11 PM', client.menu, businessHours, 'es', client);
  assert.equal(extracted.hora, undefined);
  assert.equal(extracted.__horaFueraDeHorario, true);
  assert.equal(dom.window.JBChatCore.horaDentroDeHorario('9:00 PM', businessHours), true);
}

{
  const dom = new JSDOM(`<!doctype html><body><div id="a-loading"></div><div id="a-app" style="display:none"><div id="a-head"><div id="a-av"></div><div id="a-name"></div><div id="a-status-text"></div></div><div id="a-msgs"></div><input id="a-inp"><button id="a-snd"></button></div><div id="a-notfound"></div><div id="a-version"></div></body>`, { runScripts: 'outside-only', url: 'https://jbstudio.app/asistente/hora-prueba' });
  installFetch(dom.window);
  dom.window.eval(coreSource);
  dom.window.eval(assistantScript);
  await wait();
  await send(dom.window, 'a-inp', 'a-snd', 'Quiero reservar masaje mañana a las 11 PM');
  const messages = dom.window.document.getElementById('a-msgs').textContent;
  const state = JSON.parse(dom.window.sessionStorage.getItem('jba_hora-prueba_booking'));
  assert.match(messages, /En ese horario ya estamos cerrados/);
  assert.equal(state.bookingData.hora, undefined);
  assert.equal(state.bookingPending, 'hora');
  console.log('asistente.html: avisa de inmediato y mantiene hora pendiente');
}

{
  const dom = new JSDOM('<!doctype html><head></head><body></body>', { runScripts: 'outside-only', url: 'https://cliente.example' });
  installFetch(dom.window);
  dom.window.eval(coreSource);
  const script = dom.window.document.createElement('script');
  script.src = 'https://jbstudio.app/widget.js?id=hora-prueba';
  script.setAttribute('data-position', 'bottom-right');
  dom.window.document.head.appendChild(script);
  Object.defineProperty(dom.window.document, 'currentScript', { configurable: true, get: () => script });
  dom.window.eval(widgetSource);
  await wait();
  await send(dom.window, 'jbw-inp', 'jbw-snd', 'Quiero reservar masaje mañana a las 11 PM');
  const messages = dom.window.document.getElementById('jbw-msgs').textContent;
  const state = JSON.parse(dom.window.sessionStorage.getItem('jbw_hora-prueba_booking'));
  assert.match(messages, /En ese horario ya estamos cerrados/);
  assert.equal(state.bookingData.hora, undefined);
  assert.equal(state.bookingPending, 'hora');
  console.log('widget.js: avisa de inmediato y mantiene hora pendiente');
}

console.log('Validación temprana de horario pasa en ambas interfaces');
