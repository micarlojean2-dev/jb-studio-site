// Pruebas conversacionales reales (auditoría FASE 1 — reagendar/modificar):
// ejecuta el JS REAL de asistente.html (chat-core.js + su propio script) en
// un DOM simulado, con una reserva activa ya cargada, y escribe mensajes
// como lo haría un cliente real. No reimplementa la lógica de extracción ni
// del dispatcher — es el código de producción corriendo contra sí mismo.
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const chatCoreSrc = readFileSync(join(root, 'chat-core.js'), 'utf8');
const asistenteSrc = readFileSync(join(root, 'asistente.html'), 'utf8');
const scriptMatch = asistenteSrc.match(/<script>\n([\s\S]*?)\n<\/script>\n<\/body>/);
assert.ok(scriptMatch, 'no se encontró el <script> principal de asistente.html');
const asistenteScript = scriptMatch[1];

// NO incluye un <div id="a-ty"> estático: en el asistente.html real ese id
// no existe en el HTML -- showTyping() lo crea dinámicamente dentro de
// #a-msgs y hideTyping() lo quita por getElementById('a-ty'). Un elemento
// estático con el mismo id (como tenía esta prueba al principio) crea un id
// duplicado: hideTyping() puede acabar quitando el elemento equivocado y
// dejando el indicador de "escribiendo…" real atascado dentro de #a-msgs.
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

const CLIENT_CONFIG = {
  id: 'spa-test', businessName: 'Spa Prueba', templateId: 'spa', language: 'es', languages: ['es', 'en'],
  color: '#1a4a2e', style: 'Moderno',
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
  features: { reservations: true, cancellation: true },
};

function activeReservationFixture() {
  return {
    reservationId: 'r1', actionToken: 'tok-abc-123',
    nombre: 'Cliente Prueba', servicio: 'Masaje relajante',
    fecha: 'lunes', hora: '8:00 PM', estado: 'confirmada',
  };
}

async function buildDom({ onReschedule } = {}) {
  const dom = new JSDOM(HTML_SKELETON, { runScripts: 'outside-only', url: 'https://jbstudio.app/asistente/spa-test' });
  const { window } = dom;
  // sessionStorage real de jsdom -- se preinicializa ANTES de correr el
  // script, así activeReservation la lee de entrada (igual que un usuario
  // real que llega con una reserva activa de un mensaje anterior).
  window.sessionStorage.setItem('jba_spa-test_reserva', JSON.stringify(activeReservationFixture()));

  const rescheduleCalls = [];
  window.fetch = async (url, options = {}) => {
    const u = String(url);
    if (u.includes('/api/client-config')) {
      return { ok: true, json: async () => CLIENT_CONFIG };
    }
    if (u.includes('/api/reservations') && options.method === 'POST') {
      const body = JSON.parse(options.body);
      if (body.action === 'reschedule') {
        rescheduleCalls.push(body);
        if (onReschedule) return onReschedule(body);
        return {
          ok: true,
          json: async () => ({ ok: true, reservation: { fecha: body.fecha, hora: body.hora, servicio: body.servicio || 'Masaje relajante', estado: 'reprogramada' } }),
        };
      }
      throw new Error('acción inesperada: ' + body.action);
    }
    throw new Error('fetch inesperado: ' + u);
  };

  dom.window.eval(chatCoreSrc);
  dom.window.eval(asistenteScript);
  await new Promise(r => setTimeout(r, 20)); // resuelve el fetch de client-config
  return { dom, rescheduleCalls };
}

function $(dom, id) { return dom.window.document.getElementById(id); }

async function escribir(dom, texto) {
  const window = dom.window;
  $(dom, 'a-inp').value = texto;
  $(dom, 'a-snd').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
}

function ultimosMensajesBot(dom, n) {
  const bubbles = [...dom.window.document.querySelectorAll('#a-msgs > *')].map(el => el.textContent);
  return bubbles.slice(-n).join(' | ');
}

console.log('1) Cambio de fecha + hora en un solo mensaje (no debe preguntar "¿qué quieres cambiar?")');
{
  const { dom, rescheduleCalls } = await buildDom();
  await escribir(dom, 'Cámbiala mañana a las 8:30 PM');
  assert.equal(rescheduleCalls.length, 1, 'debe llamar a reschedule una sola vez, con este mismo mensaje');
  assert.equal(rescheduleCalls[0].hora, '8:30 PM', `la hora nueva debe ser 8:30 PM, fue "${rescheduleCalls[0].hora}"`);
  assert.ok(rescheduleCalls[0].fecha && rescheduleCalls[0].fecha !== 'lunes', `la fecha nueva ("mañana" resuelta) debe ir, no la vieja ("lunes"), fue "${rescheduleCalls[0].fecha}"`);
  assert.doesNotMatch(ultimosMensajesBot(dom, 3), /qué quieres cambiar/i, 'NO debe preguntar "¿qué quieres cambiar?" si ya lo dijo todo en el mismo mensaje');
  console.log('  ✓ fecha+hora en un mensaje: reschedule directo, sin preguntar de nuevo');
}

console.log('2) Cambio de solo la hora (fecha se conserva de la reserva activa)');
{
  const { dom, rescheduleCalls } = await buildDom();
  await escribir(dom, 'Quiero cambiar mi cita a las 8:30 PM');
  assert.equal(rescheduleCalls.length, 1, 'debe llamar a reschedule una sola vez');
  assert.equal(rescheduleCalls[0].hora, '8:30 PM', `hora nueva debe ser 8:30 PM, fue "${rescheduleCalls[0].hora}"`);
  assert.equal(rescheduleCalls[0].fecha, 'lunes', 'sin fecha nueva en el mensaje, se conserva la de la reserva activa (lunes)');
  assert.doesNotMatch(ultimosMensajesBot(dom, 3), /qué quieres cambiar/i, 'NO debe preguntar de nuevo si ya dio la hora');
  console.log('  ✓ solo hora: reschedule directo con la hora nueva, fecha vieja conservada');
}

console.log('3) Cambio ambiguo ("a las 4") — debe preguntar AM/PM, nunca perder el dato ni mantener la hora vieja en silencio');
{
  const { dom, rescheduleCalls } = await buildDom();
  await escribir(dom, 'Cambiar a las 4');
  assert.equal(rescheduleCalls.length, 0, 'NO debe llamar a reschedule todavía: la hora es ambigua, falta preguntar');
  assert.match(ultimosMensajesBot(dom, 2), /tarde.*mañana|morning.*afternoon|afternoon.*morning/i, 'debe preguntar mañana/tarde (AM/PM)');

  await escribir(dom, 'de la tarde');
  assert.equal(rescheduleCalls.length, 1, 'tras responder "de la tarde", ahí sí debe llamar a reschedule');
  assert.equal(rescheduleCalls[0].hora, '4:00 PM', `debe resolver a 4:00 PM, fue "${rescheduleCalls[0].hora}"`);
  console.log('  ✓ hora ambigua: pregunta AM/PM, no se pierde el dato, se aplica bien tras la respuesta');
}

console.log('4) "Quiero cambiar mi cita" sin ningún dato nuevo — debe preguntar qué cambiar, no reventar ni enviar nada');
{
  const { dom, rescheduleCalls } = await buildDom();
  await escribir(dom, 'Quiero cambiar mi cita');
  assert.equal(rescheduleCalls.length, 0, 'sin dato nuevo, no debe llamar a reschedule todavía');
  assert.match(ultimosMensajesBot(dom, 2), /qué quieres cambiar|what would you like to change/i, 'debe preguntar qué quiere cambiar (comportamiento ya existente, preservado)');

  // Y ahora si en el SIGUIENTE mensaje da fecha+hora, debe aplicarse (flujo de 2 mensajes, ya soportado antes, no se rompe).
  await escribir(dom, 'el viernes a las 9:00 PM');
  assert.equal(rescheduleCalls.length, 1, 'en el segundo mensaje, con el dato ya dado, debe llamar a reschedule');
  assert.equal(rescheduleCalls[0].hora, '9:00 PM', `hora nueva 9:00 PM, fue "${rescheduleCalls[0].hora}"`);
  console.log('  ✓ "quiero cambiar mi cita" sin datos: pregunta, y el flujo de 2 mensajes sigue funcionando');
}

// widget.js requiere document.currentScript real (se auto-lee de su propio
// <script src="...?id=...">) para resolver clientId -- no se puede correr
// vía eval() como asistente.html, así que aquí se verifica por estructura
// que tiene EXACTAMENTE el mismo fix, no una reimplementación divergente.
// La lógica compartida (buildModifyUpdate/extractBooking) ya se probó de
// punta a punta arriba, contra el motor real, no reimplementado.
console.log('5) widget.js: mismo fix, sin divergencia (verificación estructural sobre el código real)');
{
  const widgetSrc = readFileSync(join(root, 'widget.js'), 'utf8');
  assert.match(widgetSrc, /var modifyHoraPendiente = null;/, 'widget.js: declara modifyHoraPendiente, separado de horaPendiente');
  assert.match(widgetSrc, /var modifyPendingUpdate = null;/, 'widget.js: declara modifyPendingUpdate');
  assert.match(widgetSrc, /function preguntarModifyHoraAmbigua\(amb, update, lang\) \{/, 'widget.js: tiene preguntarModifyHoraAmbigua');
  assert.match(widgetSrc, /function resolverModifyHoraPendiente\(t, lang\) \{/, 'widget.js: tiene resolverModifyHoraPendiente');
  // El fix del bug de esta ronda (modifyMode debe activarse al preguntar la
  // ambigüedad, o la respuesta AM/PM se pierde) está presente.
  const preguntarFnMatch = widgetSrc.match(/function preguntarModifyHoraAmbigua\(amb, update, lang\) \{([\s\S]*?)\n  \}/);
  assert.ok(preguntarFnMatch, 'se pudo extraer el cuerpo de preguntarModifyHoraAmbigua');
  assert.match(preguntarFnMatch[1], /modifyMode = true;/, 'widget.js: preguntarModifyHoraAmbigua activa modifyMode (si no, la respuesta AM/PM del mensaje directo se pierde)');
  // buildModifyUpdate ya NO debe borrar __horaAmbigua a ciegas en chat-core.js
  // (motor compartido, una sola copia -- ya verificado arriba con pruebas
  // reales, se repite aquí solo como candado de regresión rápido).
  assert.doesNotMatch(chatCoreSrc, /delete upd\.__horaAmbigua;/, 'chat-core.js: buildModifyUpdate ya no descarta __horaAmbigua');
  // El bloque MODIFY_TRIGGERS de widget.js debe intentar el update directo
  // antes de caer a handleReservationAction (mismo patrón que asistente.html).
  assert.match(widgetSrc, /if \(MODIFY_TRIGGERS\.test\(t\)\) \{\s*addMsg\('user', t\);\s*\/\/[\s\S]*?var directUpdateW = CORE\.buildModifyUpdate\(t, cfg, activeReservation\);/,
    'widget.js: el disparo de MODIFY_TRIGGERS intenta construir el update directo desde el mismo mensaje, antes de preguntar');
  console.log('  ✓ widget.js tiene el mismo fix (modifyHoraPendiente separado, modifyMode activado, sin descartar __horaAmbigua)');
}

console.log('\nTodas las pruebas conversacionales de reagendar/modificar (FASE 1) pasan');
