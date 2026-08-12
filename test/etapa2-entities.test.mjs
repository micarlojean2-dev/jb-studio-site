// MIGRACIÓN 1, ETAPA 2 — entities de la IA reemplazan a CORE.extractBooking()
// como fuente de comprensión de lenguaje dentro del flujo de reserva.
//
// Dos niveles de prueba, sin red ni llamadas al modelo real (eso vive en
// scripts/interpreter-battery.mjs):
//
//  A) UNIDAD — CORE.sanitizeBookingEntities()/mergeBookingEntities() contra
//     el motor real (chat-core.js), simulando exactamente lo que la IA
//     devolvería para cada caso pedido (servicio válido/inexistente,
//     fecha/hora válida/ambigua, email/teléfono válido/inválido, personas,
//     notas, una entity inventada con tipo raro, corrección de un solo
//     campo sin borrar los demás).
//
//  B) EXTREMO A EXTREMO — asistente.html real (chat-core.js + su script) en
//     un DOM simulado, con /api/client-chat mockeado para devolver
//     {intent, text, entities} tal como lo haría el proveedor real para
//     cada mensaje de la lista pedida (ES y EN), verificando que
//     bookingData/bookingRequirements/resumen/confirmación por botón se
//     comportan igual que antes de la migración.
//
// widget.js no se ejecuta aquí (requiere document.currentScript real, ver
// test/reagendar-mismo-mensaje.test.mjs) — su paridad byte a byte con
// asistente.html para esta misma lógica ya se verifica por estructura en
// test/message-interpreter.test.mjs.
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { __test as chatApiTest } from '../api/client-chat.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const chatCoreSrc = readFileSync(join(root, 'chat-core.js'), 'utf8');
const asistenteSrc = readFileSync(join(root, 'asistente.html'), 'utf8');
const scriptMatch = asistenteSrc.match(/<script>\n([\s\S]*?)\n<\/script>\n<\/body>/);
assert.ok(scriptMatch, 'no se encontró el <script> principal de asistente.html');
const asistenteScript = scriptMatch[1];

let failures = 0;
const ok = (cond, msg) => { if (cond) console.log('  ✓', msg); else { console.error('  ✗', msg); failures++; } };

function emptyEntities() {
  return { service: null, date: null, time: null, name: null, email: null, phone: null, people: null, notes: null };
}

const MENU = [
  { nombre: 'Manicura', precio: '250', duracion: '45' },
  { nombre: 'Masaje relajante', precio: '700', duracion: '60' },
];
const BUSINESS_HOURS = {
  monday: { enabled: true, ranges: [{ start: '10:00', end: '19:00' }] },
  tuesday: { enabled: true, ranges: [{ start: '10:00', end: '19:00' }] },
  wednesday: { enabled: true, ranges: [{ start: '10:00', end: '19:00' }] },
  thursday: { enabled: true, ranges: [{ start: '10:00', end: '19:00' }] },
  friday: { enabled: true, ranges: [{ start: '10:00', end: '19:00' }] },
  saturday: { enabled: true, ranges: [{ start: '10:00', end: '16:00' }] },
  sunday: { enabled: false, ranges: [] },
};
const CFG = { templateId: 'spa', menu: MENU, businessHours: BUSINESS_HOURS, language: 'es' };

// ============================================================================
// A) UNIDAD — CORE.sanitizeBookingEntities() / mergeBookingEntities()
// ============================================================================
console.log('A) sanitizeBookingEntities() / mergeBookingEntities() — unidad, motor real');
{
  const win = {};
  new Function('window', chatCoreSrc)(win);
  const CORE = win.JBChatCore;

  console.log('\nA1. servicio');
  {
    const e1 = CORE.sanitizeBookingEntities({ ...emptyEntities(), service: 'Manicura' }, CFG, BUSINESS_HOURS, 'es');
    ok(e1.servicio === 'Manicura', 'servicio existente en el catálogo se acepta tal cual');
    const e2 = CORE.sanitizeBookingEntities({ ...emptyEntities(), service: 'Depilación láser' }, CFG, BUSINESS_HOURS, 'es');
    ok(e2.servicio === undefined, 'servicio inexistente en el catálogo -> se ignora (nunca se inventa ni se acepta "parecido")');
    const e3 = CORE.sanitizeBookingEntities({ ...emptyEntities(), service: 'manicura' }, CFG, BUSINESS_HOURS, 'es');
    ok(e3.servicio === 'Manicura', 'coincidencia insensible a mayúsculas devuelve el nombre EXACTO del catálogo');
  }

  console.log('\nA2. fecha');
  {
    const e1 = CORE.sanitizeBookingEntities({ ...emptyEntities(), date: 'viernes' }, CFG, BUSINESS_HOURS, 'es');
    ok(e1.fecha === 'viernes', 'fecha reconocible se acepta');
    const e2 = CORE.sanitizeBookingEntities({ ...emptyEntities(), date: 'blablanoesfecha' }, CFG, BUSINESS_HOURS, 'es');
    ok(e2.fecha === undefined, 'fecha no reconocible (la IA "inventó" algo raro) -> se ignora');
  }

  console.log('\nA3. hora — válida y ambigua');
  {
    const e1 = CORE.sanitizeBookingEntities({ ...emptyEntities(), time: '4 pm' }, CFG, BUSINESS_HOURS, 'es');
    ok(e1.hora === '4:00 PM', 'hora con AM/PM explícito se acepta y normaliza');
    const e2 = CORE.sanitizeBookingEntities({ ...emptyEntities(), time: '16:00' }, CFG, BUSINESS_HOURS, 'es');
    ok(e2.hora === '16:00', 'hora en formato 24h (sin ambigüedad posible) se acepta tal cual');
    const e3 = CORE.sanitizeBookingEntities({ ...emptyEntities(), time: '4' }, CFG, BUSINESS_HOURS, 'es');
    ok(e3.hora === undefined && e3.__horaAmbigua && e3.__horaAmbigua.n === 4,
      '"4" sin AM/PM -> NUNCA se guarda como definitiva, viaja como __horaAmbigua (la IA nunca decide AM/PM)');
    const e4 = CORE.sanitizeBookingEntities({ ...emptyEntities(), time: 'a las 11' }, CFG, BUSINESS_HOURS, 'es');
    ok(e4.hora === undefined && e4.__horaAmbigua, '"a las 11" (aunque el negocio abra 10-19) sigue pidiendo aclaración explícita — el código nunca adivina');
  }

  console.log('\nA4. nombre');
  {
    const e1 = CORE.sanitizeBookingEntities({ ...emptyEntities(), name: 'Ana' }, CFG, BUSINESS_HOURS, 'es');
    ok(e1.nombre === 'Ana', 'nombre razonable se acepta');
    const e2 = CORE.sanitizeBookingEntities({ ...emptyEntities(), name: '¿Ana?' }, CFG, BUSINESS_HOURS, 'es');
    ok(e2.nombre === undefined, 'nombre con signo de pregunta (la IA confundió una pregunta con un nombre) -> se rechaza');
    const e3 = CORE.sanitizeBookingEntities({ ...emptyEntities(), name: 'sí' }, CFG, BUSINESS_HOURS, 'es');
    ok(e3.nombre === undefined, '"sí" como nombre (confirmación mal extraída) -> se rechaza');
  }

  console.log('\nA5. email — válido e inválido');
  {
    const e1 = CORE.sanitizeBookingEntities({ ...emptyEntities(), email: 'ana@example.com' }, CFG, BUSINESS_HOURS, 'es');
    ok(e1.email === 'ana@example.com', 'email con formato válido se acepta');
    const e2 = CORE.sanitizeBookingEntities({ ...emptyEntities(), email: 'ana-arroba-example' }, CFG, BUSINESS_HOURS, 'es');
    ok(e2.email === undefined, 'email con formato inválido (sin @ ni dominio real) -> se rechaza, nunca se guarda tal cual');
  }

  console.log('\nA6. teléfono — válido, inválido y fallback de texto');
  {
    const e1 = CORE.sanitizeBookingEntities({ ...emptyEntities(), phone: '206-742-1261' }, CFG, BUSINESS_HOURS, 'es');
    ok(e1.telefono === '206-742-1261', 'teléfono con suficientes dígitos se acepta');
    const e2 = CORE.sanitizeBookingEntities({ ...emptyEntities(), phone: '12345' }, CFG, BUSINESS_HOURS, 'es');
    ok(e2.telefono === undefined, 'teléfono con muy pocos dígitos (<7) -> se rechaza');
    const e3 = CORE.sanitizeBookingEntities(emptyEntities(), CFG, BUSINESS_HOURS, 'es', 'Mi teléfono es +1 555-000-0004');
    ok(e3.telefono === '+1 555-000-0004', 'teléfono explícito se recupera del texto cuando la IA devuelve null');
    const e4 = CORE.sanitizeBookingEntities(emptyEntities(), CFG, BUSINESS_HOURS, 'es', 'Mi teléfono es 12345');
    ok(e4.telefono === undefined, 'fallback también rechaza teléfonos con menos de siete dígitos');
  }

  console.log('\nA7. personas — válido e inválido');
  {
    const e1 = CORE.sanitizeBookingEntities({ ...emptyEntities(), people: 3 }, CFG, BUSINESS_HOURS, 'es');
    ok(e1.personas === '3', 'entero razonable de personas se acepta (como string, mismo tipo que usaba extractBooking)');
    const e2 = CORE.sanitizeBookingEntities({ ...emptyEntities(), people: 0 }, CFG, BUSINESS_HOURS, 'es');
    ok(e2.personas === undefined, 'personas=0 (fuera de rango) -> se rechaza');
    const e3 = CORE.sanitizeBookingEntities({ ...emptyEntities(), people: 500 }, CFG, BUSINESS_HOURS, 'es');
    ok(e3.personas === undefined, 'personas=500 (fuera de rango 1-200) -> se rechaza');
  }

  console.log('\nA8. notas');
  {
    const e1 = CORE.sanitizeBookingEntities({ ...emptyEntities(), notes: 'sin cebolla' }, CFG, BUSINESS_HOURS, 'es');
    ok(e1.notes === 'sin cebolla', 'nota razonable se acepta');
    const e2 = CORE.sanitizeBookingEntities({ ...emptyEntities(), notes: 'ok' }, CFG, BUSINESS_HOURS, 'es');
    ok(e2.notes === undefined, 'nota demasiado corta/vacía de contenido -> se descarta');
  }

  console.log('\nA9. entity inventada / con tipo no válido — nunca se propaga');
  {
    const e1 = CORE.sanitizeBookingEntities({ ...emptyEntities(), service: 123, people: 'tres', extraCampoInventado: 'x' }, CFG, BUSINESS_HOURS, 'es');
    ok(e1.servicio === undefined, 'servicio con tipo numérico (no string) -> ignorado');
    ok(e1.personas === undefined, 'personas como string no numérico -> ignorado');
    ok(e1.extraCampoInventado === undefined, 'una clave fuera del contrato nunca se copia a la salida');
  }

  console.log('\nA10. mergeBookingEntities() — corrección de UN campo sin borrar los demás');
  {
    const bookingData = { servicio: 'Masaje relajante', fecha: 'viernes', nombre: 'Ana' };
    const sanitized = CORE.sanitizeBookingEntities({ ...emptyEntities(), time: '5 pm' }, CFG, BUSINESS_HOURS, 'es');
    const result = CORE.mergeBookingEntities(bookingData, sanitized, BUSINESS_HOURS);
    ok(bookingData.hora === '5:00 PM', 'mergeBookingEntities() aplica el campo nuevo (hora)');
    ok(bookingData.servicio === 'Masaje relajante', 'servicio previo INTACTO tras el merge');
    ok(bookingData.fecha === 'viernes', 'fecha previa INTACTA tras el merge');
    ok(bookingData.nombre === 'Ana', 'nombre previo INTACTO tras el merge');
    ok(result.traidos.length === 1 && result.traidos[0] === 'hora', 'traidos reporta SOLO la clave realmente actualizada en este turno');
  }
  {
    // "no, manicura" -- corrección de servicio, todo lo demás debe seguir igual.
    const bookingData = { servicio: 'Masaje relajante', fecha: 'viernes', hora: '4:00 PM', nombre: 'Ana' };
    const sanitized = CORE.sanitizeBookingEntities({ ...emptyEntities(), service: 'Manicura' }, CFG, BUSINESS_HOURS, 'es');
    CORE.mergeBookingEntities(bookingData, sanitized, BUSINESS_HOURS);
    ok(bookingData.servicio === 'Manicura', '"no, manicura": el servicio se corrige');
    ok(bookingData.fecha === 'viernes' && bookingData.hora === '4:00 PM' && bookingData.nombre === 'Ana',
      '"no, manicura": fecha/hora/nombre NO se tocan');
  }
  {
    // Hora fuera de horario: mergeBookingEntities debe señalarlo y NO aplicar esa hora.
    const bookingData = { servicio: 'Manicura', fecha: 'domingo' };
    const sanitized = CORE.sanitizeBookingEntities({ ...emptyEntities(), time: '20:00' }, CFG, BUSINESS_HOURS, 'es');
    const result = CORE.mergeBookingEntities(bookingData, sanitized, BUSINESS_HOURS);
    ok(result.fueraDeHorario === true, 'hora fuera del horario configurado se señala (fueraDeHorario)');
    ok(bookingData.hora === undefined, 'la hora fuera de horario NUNCA se guarda en bookingData');
  }
}

// ============================================================================
// B) EXTREMO A EXTREMO — asistente.html real, /api/client-chat mockeado
// ============================================================================
const CLIENT_CONFIG = {
  id: 'spa-e2', businessName: 'Spa Prueba E2', templateId: 'spa', language: 'es', languages: ['es', 'en'],
  color: '#1a4a2e', style: 'Moderno', businessHours: BUSINESS_HOURS, menu: MENU,
  features: { reservations: true, cancellation: true },
};

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
  await new Promise((r) => setTimeout(r, 40));
}
function ultimosMensajesBot(dom, n) {
  return [...dom.window.document.querySelectorAll('#a-msgs > *')].map((el) => el.textContent).slice(-n).join(' | ');
}

// `interpretations` es una cola: cada escribir() consume la siguiente
// respuesta simulada del modelo, en el orden dado -- así cada prueba
// controla EXACTAMENTE qué "diría la IA" para su mensaje, sin reimplementar
// un NLU de juguete.
async function buildDom({ interpretations = [], presetSessionStorage, lang, reservationResult, clientConfig = CLIENT_CONFIG } = {}) {
  const dom = new JSDOM(HTML_SKELETON, { runScripts: 'outside-only', url: 'https://jbstudio.app/asistente/spa-e2' });
  const { window } = dom;
  if (lang) window.sessionStorage.setItem('jba_spa-e2_language', lang);
  if (presetSessionStorage) {
    Object.entries(presetSessionStorage).forEach(([k, v]) => window.sessionStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)));
  }
  const queue = [...interpretations];
  const clientChatCalls = [];
  const reservationCalls = [];
  window.fetch = async (u, options = {}) => {
    const s = String(u);
    if (s.includes('/api/client-config')) return { ok: true, json: async () => clientConfig };
    if (s.includes('/api/client-chat') && options.method === 'POST') {
      const body = JSON.parse(options.body);
      clientChatCalls.push(body);
      const next = queue.shift();
      if (next === undefined) throw new Error('se agotó la cola de interpretaciones simuladas');
      if (next === 'INVALID_JSON') {
        // Simula que sanitizeInterpretation() del servidor ya degradó a
        // fail-closed (JSON del modelo no validó) -- exactamente lo que
        // widget.js/asistente.html reciben en ese caso real.
        return { ok: true, json: async () => ({ text: 'Perdona, no te entendí bien 😅 ¿Me lo repites?' }) };
      }
      return { ok: true, json: async () => next };
    }
    if (s.includes('/api/reservations') && options.method === 'POST') {
      const body = JSON.parse(options.body);
      reservationCalls.push(body);
      if (body.action === 'validate') return { ok: true, json: async () => ({ ok: true }) };
      // reservationResult permite simular éxito con email real (sent true/
      // false) o un fallo de backend (ok:false / lanzar), para probar que la
      // IA solo recibe el estado que el backend REALMENTE devolvió — nunca
      // se inventa nada. Por defecto, el mismo éxito simple que ya usaban
      // los casos B1-B14 (sin tocarlos).
      const result = typeof reservationResult === 'function' ? reservationResult(body) : reservationResult;
      if (result) return { ok: true, json: async () => result };
      return { ok: true, json: async () => ({ ok: true, reservationId: 'r-e2', actionToken: 'tok-e2', status: 'confirmada' }) };
    }
    throw new Error('fetch inesperado: ' + s);
  };
  dom.window.eval(chatCoreSrc);
  dom.window.eval(asistenteScript);
  await new Promise((r) => setTimeout(r, 20));
  return { dom, clientChatCalls, reservationCalls };
}

function interp(intent, entitiesPartial, text) {
  return { text: text || 'Entendido.', interpretation: { intent, entities: { ...emptyEntities(), ...entitiesPartial } } };
}

// validarDisponibilidadTemprana() (asistente.html) manda su propio POST a
// /api/reservations con action:'validate' como chequeo de disponibilidad de
// solo lectura -- no crea nada y es legítimo que ocurra en cualquier turno de
// askBookingTurn(). Los tests de la auditoría de reservas necesitan contar
// SOLO intentos reales de creación (sin "action"), nunca esos pings.
function realBookingAttempts(reservationCalls) {
  return reservationCalls.filter((c) => !c.action);
}

console.log('\nB) Flujo real (asistente.html) con /api/client-chat mockeado');

console.log('\nB0 needsSetup bloquea la captura antes de crear una sesión de reserva');
{
  const { dom, clientChatCalls } = await buildDom({
    lang: 'es',
    clientConfig: { ...CLIENT_CONFIG, needsSetup: true },
    interpretations: [interp('booking', { service: 'Manicura' })],
  });
  await escribir(dom, 'Quiero reservar una manicura');
  ok(dom.window.sessionStorage.getItem('jba_spa-e2_booking') === null, 'needsSetup no crea BOOKING_SESS ni inicia bookingStep');
  ok(clientChatCalls.length === 1 && clientChatCalls[0].booking === undefined, 'needsSetup no llama al turno de captura de reserva');
}

console.log('\nB1 (ES) "quiero manicura el viernes a las 4, soy Ana" — arranca booking con 3 campos de una vez, hora ambigua pendiente');
{
  const { dom } = await buildDom({
    lang: 'es',
    interpretations: [
      interp('booking', { service: 'Manicura', date: 'viernes', time: '4', name: 'Ana' }),
      // "de la tarde" no vuelve a extraer nada nuevo (resolverHoraPendiente ya
      // resolvió la hora localmente) -- este turno solo redacta "qué falta ahora".
      interp('booking', {}),
    ],
  });
  await escribir(dom, 'quiero manicura el viernes a las 4, soy Ana');
  ok(/ma(ñ|n)ana.*tarde|tarde.*ma(ñ|n)ana/i.test(ultimosMensajesBot(dom, 2)), 'hora ambigua ("4") pide aclaración AM/PM en vez de asumir');
  // NOTA: justo en este punto (pregunta de ambigüedad de hora en el turno que
  // ARRANCA la reserva) bookingData todavía no se persistió a sessionStorage
  // -- comportamiento preexistente a esta migración (ya ocurría igual con
  // CORE.extractBooking(), no es una regresión de la ETAPA 2: falta un
  // save() antes de ese "return" concreto, presente también en el código
  // anterior). Se sigue la conversación para confirmar que servicio/fecha/
  // nombre SÍ sobrevivieron en memoria hasta que se resuelve la ambigüedad.
  await escribir(dom, 'de la tarde');
  const booking = JSON.parse(dom.window.sessionStorage.getItem('jba_spa-e2_booking'));
  ok(booking.bookingData.servicio === 'Manicura', 'servicio capturado en el primer mensaje sobrevive hasta resolver la hora');
  ok(booking.bookingData.fecha === 'viernes', 'fecha capturada en el primer mensaje sobrevive hasta resolver la hora');
  ok(booking.bookingData.nombre === 'Ana', 'nombre capturado en el primer mensaje sobrevive hasta resolver la hora');
  ok(booking.bookingData.hora === '4:00 PM', 'tras "de la tarde", la hora queda resuelta a las 4:00 PM');
}

console.log('\nB2 (ES) "mejor el viernes" — corrección de fecha dentro del flujo, sin borrar servicio/nombre ya capturados');
{
  const { dom } = await buildDom({
    lang: 'es',
    presetSessionStorage: {
      jba_spa_e2_lang_marker: '1',
      'jba_spa-e2_booking': {
        bookingStep: 1,
        bookingData: { servicio: 'Masaje relajante', nombre: 'Carla', __nombreConfirmado: true, fecha: 'lunes' },
        bookingPending: 'hora', bookingReview: false, awaitingConfirmation: false, horaPendiente: null, language: 'es', selectedService: 'Masaje relajante',
      },
    },
    interpretations: [interp('booking', { date: 'viernes' })],
  });
  await escribir(dom, 'mejor el viernes');
  const booking = JSON.parse(dom.window.sessionStorage.getItem('jba_spa-e2_booking'));
  ok(booking.bookingData.fecha === 'viernes', '"mejor el viernes": la fecha se corrige');
  ok(booking.bookingData.servicio === 'Masaje relajante', '"mejor el viernes": el servicio NO se pierde');
  ok(booking.bookingData.nombre === 'Carla', '"mejor el viernes": el nombre NO se pierde');
}

console.log('\nB3 (ES) "no, manicura" — corrección de servicio dentro del flujo, sin borrar fecha/hora/nombre');
{
  const { dom } = await buildDom({
    lang: 'es',
    presetSessionStorage: {
      'jba_spa-e2_booking': {
        bookingStep: 1,
        bookingData: { servicio: 'Masaje relajante', nombre: 'Carla', __nombreConfirmado: true, fecha: 'viernes', hora: '4:00 PM' },
        bookingPending: 'telefono', bookingReview: false, awaitingConfirmation: false, horaPendiente: null, language: 'es', selectedService: 'Masaje relajante',
      },
    },
    interpretations: [interp('booking', { service: 'Manicura' })],
  });
  await escribir(dom, 'no, manicura');
  const booking = JSON.parse(dom.window.sessionStorage.getItem('jba_spa-e2_booking'));
  ok(booking.bookingData.servicio === 'Manicura', '"no, manicura": el servicio se corrige');
  ok(booking.bookingData.fecha === 'viernes' && booking.bookingData.hora === '4:00 PM' && booking.bookingData.nombre === 'Carla',
    '"no, manicura": fecha/hora/nombre NO se tocan');
}

console.log('\nB4 (ES) "somos 3" — personas dentro del flujo (plantilla que las requiere: restaurant)');
{
  const CLIENT_CONFIG_RESTAURANT = { ...CLIENT_CONFIG, id: 'rest-e2', templateId: 'restaurant', menu: [{ nombre: 'Pasta', precio: '150' }] };
  const dom0 = new JSDOM(HTML_SKELETON, { runScripts: 'outside-only', url: 'https://jbstudio.app/asistente/rest-e2' });
  dom0.window.sessionStorage.setItem('jba_rest-e2_language', 'es');
  dom0.window.sessionStorage.setItem('jba_rest-e2_booking', JSON.stringify({
    bookingStep: 1,
    bookingData: { fecha: 'viernes', hora: '8:00 PM' },
    bookingPending: 'personas', bookingReview: false, awaitingConfirmation: false, horaPendiente: null, language: 'es', selectedService: '',
  }));
  const queue = [interp('booking', { people: 3 })];
  dom0.window.fetch = async (u, options = {}) => {
    const s = String(u);
    if (s.includes('/api/client-config')) return { ok: true, json: async () => CLIENT_CONFIG_RESTAURANT };
    if (s.includes('/api/client-chat')) return { ok: true, json: async () => queue.shift() };
    if (s.includes('/api/reservations')) return { ok: true, json: async () => ({ ok: true }) };
    throw new Error('fetch inesperado: ' + s);
  };
  dom0.window.eval(chatCoreSrc);
  dom0.window.eval(asistenteScript);
  await new Promise((r) => setTimeout(r, 20));
  $(dom0, 'a-inp').value = 'somos 3';
  $(dom0, 'a-snd').dispatchEvent(new dom0.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 40));
  const booking = JSON.parse(dom0.window.sessionStorage.getItem('jba_rest-e2_booking'));
  ok(booking.bookingData.personas === '3', '"somos 3": personas capturadas correctamente vía entities.people');
}

console.log('\nB5 (ES) servicio inexistente — la IA "alucina" un servicio que no está en el catálogo');
{
  const { dom } = await buildDom({
    lang: 'es',
    presetSessionStorage: {
      'jba_spa-e2_booking': {
        bookingStep: 1,
        bookingData: { nombre: 'Ana', __nombreConfirmado: true, fecha: 'viernes', hora: '4:00 PM' },
        bookingPending: 'servicio', bookingReview: false, awaitingConfirmation: false, horaPendiente: null, language: 'es', selectedService: '',
      },
    },
    interpretations: [interp('booking', { service: 'Tratamiento facial con oro de 24 quilates' })],
  });
  await escribir(dom, 'el tratamiento de oro');
  const booking = JSON.parse(dom.window.sessionStorage.getItem('jba_spa-e2_booking'));
  ok(!booking.bookingData.servicio, 'servicio inexistente en el catálogo NUNCA se guarda, aunque la IA lo "proponga"');
}

console.log('\nB6 (ES) JSON inválido del modelo (fail-closed del servidor) — no debe romper el flujo ni inventar datos');
{
  const { dom } = await buildDom({
    lang: 'es',
    presetSessionStorage: {
      'jba_spa-e2_booking': {
        bookingStep: 1,
        bookingData: { servicio: 'Manicura', nombre: 'Ana', __nombreConfirmado: true, fecha: 'viernes' },
        bookingPending: 'hora', bookingReview: false, awaitingConfirmation: false, horaPendiente: null, language: 'es', selectedService: 'Manicura',
      },
    },
    interpretations: ['INVALID_JSON'],
  });
  await escribir(dom, 'a las 4');
  const booking = JSON.parse(dom.window.sessionStorage.getItem('jba_spa-e2_booking'));
  ok(!booking.bookingData.hora, 'sin interpretación válida (JSON inválido), NUNCA se inventa una hora');
  ok(booking.bookingData.servicio === 'Manicura' && booking.bookingData.nombre === 'Ana' && booking.bookingData.fecha === 'viernes',
    'los datos ya capturados sobreviven intactos a un turno con JSON inválido');
  ok(!/undefined|error|crash/i.test(ultimosMensajesBot(dom, 1)), 'el cliente recibe una respuesta normal, no un error visible');
}

console.log('\nB7 (ES) entity inventada/no válida en el turno completo — se ignora sin romper nada');
{
  const { dom } = await buildDom({
    lang: 'es',
    presetSessionStorage: {
      'jba_spa-e2_booking': {
        bookingStep: 1,
        bookingData: { servicio: 'Manicura', nombre: 'Ana', __nombreConfirmado: true, fecha: 'viernes', hora: '4:00 PM' },
        bookingPending: 'telefono', bookingReview: false, awaitingConfirmation: false, horaPendiente: null, language: 'es', selectedService: 'Manicura',
      },
    },
    interpretations: [{ text: 'Gracias.', interpretation: { intent: 'booking', entities: { ...emptyEntities(), people: 'muchas', service: 999 } } }],
  });
  await escribir(dom, 'algo raro');
  const booking = JSON.parse(dom.window.sessionStorage.getItem('jba_spa-e2_booking'));
  ok(!booking.bookingData.personas, 'entities.people con tipo inválido -> ignorado, no rompe el flujo');
  ok(booking.bookingData.servicio === 'Manicura', 'entities.service con tipo inválido -> se conserva el servicio ya capturado, no se sobrescribe con basura');
}

console.log('\nB8 (EN) "I want a massage Friday at 4pm, my name is Ana" — arranca booking con AM/PM explícito (sin ambigüedad)');
{
  const { dom } = await buildDom({
    lang: 'en',
    interpretations: [interp('booking', { service: 'Masaje relajante', date: 'friday', time: '4pm', name: 'Ana' })],
  });
  await escribir(dom, 'I want a massage Friday at 4pm, my name is Ana');
  const booking = JSON.parse(dom.window.sessionStorage.getItem('jba_spa-e2_booking'));
  ok(booking.bookingData.servicio === 'Masaje relajante' && booking.bookingData.fecha === 'friday' &&
     booking.bookingData.hora === '4:00 PM' && booking.bookingData.nombre === 'Ana',
    'EN: servicio+fecha+hora(sin ambigüedad, con "pm")+nombre capturados en un solo mensaje');
}

console.log('\nB9 (EN) "1pm please" — corrección de hora dentro del flujo activo, sin ambigüedad (pm explícito)');
{
  const { dom } = await buildDom({
    lang: 'en',
    presetSessionStorage: {
      'jba_spa-e2_booking': {
        bookingStep: 1,
        bookingData: { servicio: 'Masaje relajante', nombre: 'Ana', __nombreConfirmado: true, fecha: 'tomorrow' },
        bookingPending: 'hora', bookingReview: false, awaitingConfirmation: false, horaPendiente: null, language: 'en', selectedService: 'Masaje relajante',
      },
    },
    interpretations: [interp('booking', { time: '1pm' })],
  });
  await escribir(dom, '1pm please');
  const booking = JSON.parse(dom.window.sessionStorage.getItem('jba_spa-e2_booking'));
  ok(booking.bookingData.hora === '1:00 PM', 'EN: "1pm please" -> hora capturada sin ambigüedad');
}

console.log('\nB10 (EN) "actually saturday" — corrección de fecha, resto intacto');
{
  const { dom } = await buildDom({
    lang: 'en',
    presetSessionStorage: {
      'jba_spa-e2_booking': {
        bookingStep: 1,
        bookingData: { servicio: 'Masaje relajante', nombre: 'Ana', __nombreConfirmado: true, fecha: 'friday', hora: '1:00 PM' },
        bookingPending: 'telefono', bookingReview: false, awaitingConfirmation: false, horaPendiente: null, language: 'en', selectedService: 'Masaje relajante',
      },
    },
    interpretations: [interp('booking', { date: 'saturday' })],
  });
  await escribir(dom, 'actually saturday');
  const booking = JSON.parse(dom.window.sessionStorage.getItem('jba_spa-e2_booking'));
  ok(booking.bookingData.fecha === 'saturday', 'EN: "actually saturday" -> la fecha se corrige');
  ok(booking.bookingData.servicio === 'Masaje relajante' && booking.bookingData.hora === '1:00 PM' && booking.bookingData.nombre === 'Ana',
    'EN: "actually saturday" -> servicio/hora/nombre NO se tocan');
}

console.log('\nB11 (EN) "we are 3" — personas (restaurant)');
{
  const CLIENT_CONFIG_RESTAURANT_EN = { ...CLIENT_CONFIG, id: 'rest-e2-en', templateId: 'restaurant', menu: [{ nombre: 'Pasta', precio: '150' }] };
  const dom0 = new JSDOM(HTML_SKELETON, { runScripts: 'outside-only', url: 'https://jbstudio.app/asistente/rest-e2-en' });
  dom0.window.sessionStorage.setItem('jba_rest-e2-en_language', 'en');
  dom0.window.sessionStorage.setItem('jba_rest-e2-en_booking', JSON.stringify({
    bookingStep: 1,
    bookingData: { fecha: 'friday', hora: '8:00 PM' },
    bookingPending: 'personas', bookingReview: false, awaitingConfirmation: false, horaPendiente: null, language: 'en', selectedService: '',
  }));
  const queue = [interp('booking', { people: 3 })];
  dom0.window.fetch = async (u, options = {}) => {
    const s = String(u);
    if (s.includes('/api/client-config')) return { ok: true, json: async () => CLIENT_CONFIG_RESTAURANT_EN };
    if (s.includes('/api/client-chat')) return { ok: true, json: async () => queue.shift() };
    if (s.includes('/api/reservations')) return { ok: true, json: async () => ({ ok: true }) };
    throw new Error('fetch inesperado: ' + s);
  };
  dom0.window.eval(chatCoreSrc);
  dom0.window.eval(asistenteScript);
  await new Promise((r) => setTimeout(r, 20));
  $(dom0, 'a-inp').value = 'we are 3';
  $(dom0, 'a-snd').dispatchEvent(new dom0.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 40));
  const booking = JSON.parse(dom0.window.sessionStorage.getItem('jba_rest-e2-en_booking'));
  ok(booking.bookingData.personas === '3', 'EN: "we are 3" -> personas capturadas correctamente');
}

console.log('\nB12 (EN) email/phone dentro del flujo — válido e inválido');
{
  const { dom } = await buildDom({
    lang: 'en',
    presetSessionStorage: {
      'jba_spa-e2_booking': {
        bookingStep: 1,
        bookingData: { servicio: 'Masaje relajante', nombre: 'Ana', __nombreConfirmado: true, fecha: 'friday', hora: '1:00 PM' },
        bookingPending: 'email', bookingReview: false, awaitingConfirmation: false, horaPendiente: null, language: 'en', selectedService: 'Masaje relajante',
      },
    },
    interpretations: [interp('booking', { email: 'not-an-email' }), interp('booking', { email: 'ana@example.com' })],
  });
  await escribir(dom, 'not-an-email');
  let booking = JSON.parse(dom.window.sessionStorage.getItem('jba_spa-e2_booking'));
  ok(!booking.bookingData.email, 'EN: email con formato inválido -> se rechaza, sigue pidiéndolo');
  await escribir(dom, 'ana@example.com');
  booking = JSON.parse(dom.window.sessionStorage.getItem('jba_spa-e2_booking'));
  ok(booking.bookingData.email === 'ana@example.com', 'EN: email válido en el segundo intento -> se acepta');
}

console.log('\nB13 (EN) ambiguous time — "at 4" nunca se guarda como definitivo');
{
  const { dom } = await buildDom({
    lang: 'en',
    presetSessionStorage: {
      'jba_spa-e2_booking': {
        bookingStep: 1,
        bookingData: { servicio: 'Masaje relajante', nombre: 'Ana', __nombreConfirmado: true, fecha: 'friday' },
        bookingPending: 'hora', bookingReview: false, awaitingConfirmation: false, horaPendiente: null, language: 'en', selectedService: 'Masaje relajante',
      },
    },
    interpretations: [interp('booking', { time: '4' })],
  });
  await escribir(dom, 'at 4');
  ok(/morning.*afternoon|afternoon.*morning/i.test(ultimosMensajesBot(dom, 2)), 'EN: hora ambigua pide aclaración morning/afternoon, nunca asume');
  const booking = JSON.parse(dom.window.sessionStorage.getItem('jba_spa-e2_booking'));
  ok(!booking.bookingData.hora, 'EN: hora ambigua NUNCA se guarda como definitiva');
}

console.log('\nB14 bookingRequirements()/resumen/confirmación por botón — sin cambios de comportamiento');
{
  const { dom, reservationCalls } = await buildDom({
    lang: 'es',
    presetSessionStorage: {
      'jba_spa-e2_booking': {
        bookingStep: 1,
        bookingData: { servicio: 'Manicura', nombre: 'Ana', __nombreConfirmado: true, fecha: 'viernes', hora: '4:00 PM', telefono: '2067421261', email: 'ana@example.com', specialRequests: '' },
        bookingPending: null, bookingReview: false, awaitingConfirmation: false, horaPendiente: null, language: 'es', selectedService: 'Manicura',
      },
    },
    interpretations: [interp('booking', {})],
  });
  await escribir(dom, 'eso es todo');
  ok(/revisemos que todo est.* correcto|Sí, confirmar cita/i.test(ultimosMensajesBot(dom, 2)),
    'con todos los campos requeridos ya completos, se muestra el resumen (bookingRequirements sigue funcionando)');
  ok(/Sí, confirmar cita/.test(ultimosMensajesBot(dom, 1)), 'la confirmación sigue ofreciéndose SOLO como botón, nunca por texto libre');
  // Escribir "sí" en texto libre NO debe confirmar la reserva (mismo candado que antes de la ETAPA 2).
  // [auditoría de reservas — BUG-CONFIRMACION-TEXTO] Antes esta aserción solo
  // miraba el TEXTO mostrado, que podía "pasar" aunque submitBooking() sí se
  // hubiera llamado (el mock de /api/reservations nunca se revisaba). Ahora
  // se comprueba la ACCIÓN real: cero llamadas al backend de reservas.
  await escribir(dom, 'sí');
  ok(!/Reserva creada|reservationId/i.test(ultimosMensajesBot(dom, 1)), 'un "sí" escrito NUNCA confirma la reserva por su cuenta — se requiere el botón');
  ok(realBookingAttempts(reservationCalls).length === 0, 'un "sí" escrito NO llama a /api/reservations (verificación de la ACCIÓN, no solo del texto)');
}

// ============================================================================
// C) AUDITORÍA DE RESERVAS — dos bugs críticos corregidos:
//    1) solo el botón "✅ Sí, confirmar cita" puede llamar submitBooking();
//    2) DeepSeek nunca puede afirmar el resultado de una reserva sin estado
//       real (CORE.buildReservationContext + reservationContext en el body).
// ============================================================================
console.log('\nC) Auditoría de reservas — solo el botón confirma + estado real, no narrativa de IA');

console.log('\nC-unidad) CORE.buildReservationContext() — proyección mínima, nunca inventa');
{
  const winC = {};
  new Function('window', chatCoreSrc)(winC);
  const CORE = winC.JBChatCore;
  ok(CORE.buildReservationContext(null) === null, 'sin activeReservation -> null');
  ok(CORE.buildReservationContext({}) === null, 'activeReservation sin estado -> null (nunca asume "confirmada")');
  const ctx = CORE.buildReservationContext({ estado: 'confirmada', servicio: 'Manicura', fecha: 'viernes', hora: '4:00 PM', emailSent: true });
  assert.deepEqual(ctx, { status: 'confirmada', service: 'Manicura', date: 'viernes', time: '4:00 PM', emailSent: true }, 'proyecta exactamente status/service/date/time/emailSent');
  ok(CORE.buildReservationContext({ estado: 'confirmada' }).emailSent === false, 'sin dato de email -> emailSent:false (nunca asume que se envió)');
}

console.log('\nC-unidad) api/client-chat.js — sanitizeReservationContext()/reservationTruthBlock() (fail-closed, sin duplicar la regla)');
{
  ok(chatApiTest.sanitizeReservationContext(null) === null, 'null -> null');
  ok(chatApiTest.sanitizeReservationContext('confirmada') === null, 'tipo inesperado (string suelto) -> null, fail-closed');
  ok(chatApiTest.sanitizeReservationContext({}) === null, 'sin "status" -> null');
  const clean = chatApiTest.sanitizeReservationContext({ status: 'confirmada', service: 'Manicura', date: 'viernes', time: '4:00 PM', emailSent: true, extra: 'x'.repeat(999) });
  assert.deepEqual(clean, { status: 'confirmada', service: 'Manicura', date: 'viernes', time: '4:00 PM', emailSent: true }, 'sanea forma exacta, descarta claves no declaradas');
  const sinCtx = chatApiTest.reservationTruthBlock(true, null);
  ok(/never say a reservation.*was created, confirmed, submitted, or sent/i.test(sinCtx), 'EN sin contexto: regla explícita de no inventar');
  ok(/cannot confirm that from here/i.test(sinCtx), 'EN sin contexto: instruye a decir que no puede confirmarlo');
  const conCtx = chatApiTest.reservationTruthBlock(true, { status: 'confirmada', service: 'Manicura', date: 'viernes', time: '4:00 PM', emailSent: false });
  ok(/status "confirmada"/.test(conCtx) && /Confirmation email sent: no/.test(conCtx), 'EN con contexto: incluye el estado real y el envío de correo real (false)');
  const esSinCtx = chatApiTest.reservationTruthBlock(false, null);
  ok(/nunca digas que una reserva o cita fue creada, confirmada, enviada/i.test(esSinCtx), 'ES sin contexto: misma regla en español');
}

const PRESET_COMPLETO_REVIEW = {
  bookingStep: 1,
  bookingData: { servicio: 'Manicura', nombre: 'Ana', __nombreConfirmado: true, fecha: 'viernes', hora: '4:00 PM', telefono: '2067421261', email: 'ana@example.com', specialRequests: '' },
  bookingPending: null, bookingReview: true, awaitingConfirmation: true, horaPendiente: null, language: 'es', selectedService: 'Manicura',
};

function getConfirmButton(dom) {
  // asistente.html usa la clase "a-quick-btn" (widget.js, no evaluado en este
  // arnés, usaría "jbw-quick-btn") — se aceptan ambas por si el helper se
  // reutiliza más adelante.
  const btn = [...dom.window.document.querySelectorAll('.a-quick-btn, .jbw-quick-btn')].find((b) => /confirmar cita|confirm it/i.test(b.textContent));
  assert.ok(btn, 'no se encontró el botón "✅ Sí, confirmar cita" en el DOM');
  return btn;
}

console.log('\nC1 (BUG-CONFIRMACION-TEXTO) — con el resumen visible, ningún texto libre crea la reserva ni llega al modelo');
{
  const { dom, reservationCalls, clientChatCalls } = await buildDom({
    lang: 'es',
    presetSessionStorage: { 'jba_spa-e2_booking': PRESET_COMPLETO_REVIEW },
  });
  for (const t of ['sí', 'ok', 'confirm', 'yes', 'looks good']) {
    await escribir(dom, t);
  }
  ok(realBookingAttempts(reservationCalls).length === 0, `ninguno de "sí/ok/confirm/yes/looks good" llamó a /api/reservations (fueron ${realBookingAttempts(reservationCalls).length})`);
  ok(clientChatCalls.length === 0, 'con el resumen visible, ese texto ni siquiera llega a /api/client-chat — la decisión es 100% determinista');
}

console.log('\nC2 — "did you confirm?" con el resumen visible: NO afirma éxito, reafirma el botón real');
{
  const { dom, reservationCalls } = await buildDom({
    lang: 'es',
    presetSessionStorage: { 'jba_spa-e2_booking': PRESET_COMPLETO_REVIEW },
  });
  await escribir(dom, 'did you confirm?');
  ok(realBookingAttempts(reservationCalls).length === 0, '"did you confirm?" no llama a /api/reservations');
  ok(!/confirmed|confirmada|enviad|sent over/i.test(ultimosMensajesBot(dom, 1)), 'no afirma que la reserva fue confirmada/enviada');
  ok(/Sí, confirmar cita/.test(ultimosMensajesBot(dom, 1)), 'vuelve a mostrar el resumen con el botón real (CASO A de la auditoría)');
}

console.log('\nC3 — el botón real SÍ crea la reserva, y un doble click no duplica (idempotencia frontend existente)');
{
  const { dom, reservationCalls } = await buildDom({
    lang: 'es',
    presetSessionStorage: { 'jba_spa-e2_booking': { ...PRESET_COMPLETO_REVIEW, bookingReview: false, awaitingConfirmation: false } },
    interpretations: [interp('booking', {})],
  });
  await escribir(dom, 'eso es todo');   // completa el flujo -> showBookingSummary() real, botones reales en el DOM
  const btn = getConfirmButton(dom);
  btn.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  btn.dispatchEvent(new dom.window.Event('click', { bubbles: true }));   // doble click antes de que resuelva el fetch
  await new Promise((r) => setTimeout(r, 40));
  ok(realBookingAttempts(reservationCalls).length === 1, `el botón (con doble click) llama exactamente 1 vez a /api/reservations (fueron ${realBookingAttempts(reservationCalls).length})`);
  ok(/quedó confirmada/i.test(ultimosMensajesBot(dom, 1)), 'CASO B: tras éxito real, el mensaje de éxito viene del backend (mensajeReservaGuardada), no de la IA');
}

console.log('\nC4 (CASO B de la auditoría) — tras reserva real, la siguiente pregunta manda el estado REAL a /api/client-chat');
{
  const { dom, clientChatCalls } = await buildDom({
    lang: 'es',
    presetSessionStorage: { 'jba_spa-e2_booking': { ...PRESET_COMPLETO_REVIEW, bookingReview: false, awaitingConfirmation: false } },
    interpretations: [interp('booking', {}), interp('general_question', {}, 'Sí, tu cita quedó confirmada.')],
    reservationResult: { ok: true, reservationId: 'r-caso-b', actionToken: 'tok-b', status: 'confirmada', email: { customer: { sent: true } } },
  });
  await escribir(dom, 'eso es todo');
  getConfirmButton(dom).dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 40));
  await escribir(dom, '¿ya quedó reservada?');
  const ultimaLlamada = clientChatCalls[clientChatCalls.length - 1];
  let coincide = true;
  try {
    assert.deepEqual(ultimaLlamada.reservationContext, { status: 'confirmada', service: 'Manicura', date: 'viernes', time: '4:00 PM', emailSent: true });
  } catch (e) { coincide = false; }
  ok(coincide, 'la pregunta de seguimiento manda el estado REAL devuelto por el backend (status/servicio/fecha/hora/emailSent), no una suposición del frontend');
}

console.log('\nC5 (CASO C de la auditoría) — si /api/reservations falla, NUNCA se manda un estado de éxito inventado');
{
  const { dom, reservationCalls, clientChatCalls } = await buildDom({
    lang: 'es',
    presetSessionStorage: { 'jba_spa-e2_booking': { ...PRESET_COMPLETO_REVIEW, bookingReview: false, awaitingConfirmation: false } },
    interpretations: [interp('booking', {}), interp('general_question', {}, 'Está bien, avísame si necesitas algo más.')],
    reservationResult: { ok: false, motivo: 'fuera_de_horario', mensaje: 'Ese horario ya no está disponible.' },
  });
  await escribir(dom, 'eso es todo');
  getConfirmButton(dom).dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 40));
  ok(realBookingAttempts(reservationCalls).length === 1, 'el intento sí llegó a /api/reservations');
  ok(!/quedó confirmada/i.test(ultimosMensajesBot(dom, 1)), 'el fallo real NUNCA se muestra como éxito');
  await escribir(dom, 'did it book?');
  const ultimaLlamada = clientChatCalls[clientChatCalls.length - 1];
  ok(ultimaLlamada.reservationContext === null || ultimaLlamada.reservationContext === undefined,
    'tras un fallo de backend, NO se manda ningún reservationContext de éxito — nada que inventar');
}

console.log('\nC6 (CASO D de la auditoría) — reserva confirmada pero el correo del cliente falló: el estado real lo dice');
{
  const { dom, clientChatCalls } = await buildDom({
    lang: 'es',
    presetSessionStorage: { 'jba_spa-e2_booking': { ...PRESET_COMPLETO_REVIEW, bookingReview: false, awaitingConfirmation: false } },
    interpretations: [interp('booking', {}), interp('general_question', {}, 'Tu cita sigue confirmada; no pudimos enviar el correo.')],
    reservationResult: { ok: true, reservationId: 'r-caso-d', actionToken: 'tok-d', status: 'confirmada', email: { customer: { sent: false } } },
  });
  await escribir(dom, 'eso es todo');
  getConfirmButton(dom).dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 40));
  ok(/No pudimos enviar el correo/i.test(ultimosMensajesBot(dom, 1)), 'el mensaje de éxito del backend ya admite el fallo real de email');
  await escribir(dom, '¿me confirmaron la cita?');
  const ultimaLlamada = clientChatCalls[clientChatCalls.length - 1];
  ok(ultimaLlamada.reservationContext && ultimaLlamada.reservationContext.status === 'confirmada', 'el estado de la reserva sigue siendo "confirmada"');
  ok(ultimaLlamada.reservationContext && ultimaLlamada.reservationContext.emailSent === false, 'emailSent viaja como false real — la IA nunca podrá afirmar que el correo se envió');
}

console.log(failures ? `\n❌ ${failures} verificación(es) fallaron` : '\n✅ ETAPA 2 (entities) + auditoría de reservas: unidad + extremo a extremo verificados, ES/EN, sin llamadas al modelo real');
process.exit(failures ? 1 : 0);
